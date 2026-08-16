/**
 * PKH League API — a thin write gate in front of the GitHub repo.
 *
 * The league data file lives on the `data` branch of the repo; this worker is
 * the only thing holding a token that can commit to it. Reads are public.
 * Appends (member code) are applied server-side against the latest data, so
 * concurrent uploads from different devices can never lose each other's games.
 * Full-document saves (admin code) carry the SHA the client loaded and are
 * rejected as stale if someone else committed first.
 */
import type { GameResult, GuestGame, LeagueData, MatchGame, Player, Season, TournamentEntry } from '../src/shared/types'
import type { AppendRequest, Role } from '../src/shared/protocol'
import { activeSeason, nextSeq, normName } from '../src/shared/data'
import { computeSeason } from '../src/shared/engine'

export interface Env {
  GH_REPO: string
  DATA_BRANCH: string
  DATA_PATH: string
  ALLOWED_ORIGINS: string
  GITHUB_TOKEN: string
  MEMBER_CODE: string
  ADMIN_CODE: string
}

/** Thrown for anything that should surface to the client as a clean {error} response. */
class ApiError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message)
  }
}

// ---- GitHub Contents API ----

interface GhFile {
  doc: LeagueData
  sha: string
}

function ghHeaders(env: Env): Record<string, string> {
  return {
    Authorization: `Bearer ${env.GITHUB_TOKEN}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'pkh-league-worker'
  }
}

function contentsUrl(env: Env): string {
  return `https://api.github.com/repos/${env.GH_REPO}/contents/${env.DATA_PATH}`
}

// btoa/atob alone corrupt non-ASCII (player names, notes) — go through raw bytes.
function b64encode(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return btoa(bin)
}

function b64decode(b64: string): string {
  const bin = atob(b64.replace(/\s/g, ''))
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)))
}

async function ghGet(env: Env): Promise<GhFile> {
  const res = await fetch(`${contentsUrl(env)}?ref=${env.DATA_BRANCH}`, { headers: ghHeaders(env) })
  if (res.status === 404) {
    throw new ApiError(503, `League data not found — has ${env.DATA_PATH} been committed to the ${env.DATA_BRANCH} branch?`)
  }
  if (!res.ok) throw new ApiError(502, `GitHub read failed (${res.status})`)
  const body = (await res.json()) as { content: string; sha: string }
  let doc: LeagueData
  try {
    doc = JSON.parse(b64decode(body.content)) as LeagueData
  } catch {
    throw new ApiError(500, 'League data file is not valid JSON')
  }
  return { doc, sha: body.sha }
}

/** Commit the document. Throws ApiError(409) on a SHA conflict (someone committed in between). */
async function ghPut(env: Env, doc: LeagueData, sha: string, message: string): Promise<GhFile> {
  const res = await fetch(contentsUrl(env), {
    method: 'PUT',
    headers: { ...ghHeaders(env), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message,
      content: b64encode(JSON.stringify(doc, null, 2) + '\n'),
      sha,
      branch: env.DATA_BRANCH,
      committer: { name: 'PKH League Bot', email: 'pkh-league-bot@users.noreply.github.com' }
    })
  })
  if (res.status === 409) throw new ApiError(409, 'stale')
  if (res.status === 422) {
    // GitHub reports SHA conflicts as 422 "…does not match…" as well as 409.
    const body = (await res.json().catch(() => ({}))) as { message?: string }
    if (body.message?.includes('does not match')) throw new ApiError(409, 'stale')
    throw new ApiError(502, `GitHub write rejected: ${body.message ?? res.status}`)
  }
  if (!res.ok) throw new ApiError(502, `GitHub write failed (${res.status})`)
  const body = (await res.json()) as { content: { sha: string } }
  return { doc, sha: body.content.sha }
}

// ---- auth ----

async function sha256(text: string): Promise<ArrayBuffer> {
  return crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
}

/** Constant-time code comparison via fixed-length digests. */
async function codeMatches(code: string, expected: string): Promise<boolean> {
  if (!expected) return false
  const [a, b] = await Promise.all([sha256(code), sha256(expected)])
  return crypto.subtle.timingSafeEqual(a, b)
}

async function roleFor(env: Env, code: string | null): Promise<Role | null> {
  if (!code) return null
  if (await codeMatches(code, env.ADMIN_CODE)) return 'admin'
  if (await codeMatches(code, env.MEMBER_CODE)) return 'member'
  return null
}

async function requireRole(env: Env, req: Request, needed: Role): Promise<Role> {
  const role = await roleFor(env, req.headers.get('X-League-Code'))
  if (!role) throw new ApiError(401, 'Wrong or missing league code')
  if (needed === 'admin' && role !== 'admin') throw new ApiError(403, 'Admin code required')
  return role
}

// ---- append validation + apply ----

const clean = (s: unknown): string => (typeof s === 'string' ? s.trim().replace(/\s+/g, ' ') : '')

// Entries are REBUILT field-by-field rather than spread from the request: the shared
// member code is deliberately low-trust, so numbers get bounds (no 999999-ELO guests),
// strings get length caps, and unknown junk fields never reach the data file.
const optNum = (v: unknown, lo: number, hi: number, what: string): number | undefined => {
  if (v === undefined || v === null) return undefined
  if (typeof v !== 'number' || !Number.isFinite(v) || v < lo || v > hi) {
    throw new ApiError(400, `${what} must be a number between ${lo} and ${hi}`)
  }
  return v
}
const optStr = (v: unknown, max: number): string | undefined => {
  const s = clean(v)
  return s ? s.slice(0, max) : undefined
}
const reqStr = (v: unknown, max: number, what: string): string => {
  const s = clean(v)
  if (!s) throw new ApiError(400, `${what} is required`)
  return s.slice(0, max)
}

function isValidDate(date: unknown): boolean {
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return false
  // Not in the future (a future date is a day/month mix-up) — one day of slack for timezones.
  const tomorrow = new Date(Date.now() + 24 * 3600 * 1000).toISOString().slice(0, 10)
  return date <= tomorrow
}

const isResult = (r: unknown): r is GameResult => r === 'Win' || r === 'Draw' || r === 'Loss'

/** Add players to the season, rejecting a duplicate name under a different id. */
function insertPlayers(season: Season, players: Player[]): void {
  for (const p of players) {
    const name = clean(p.name).slice(0, 40)
    if (!name || typeof p.id !== 'string' || !p.id) throw new ApiError(400, 'Invalid new player')
    if (season.players.some((x) => x.id === p.id)) continue
    const clash = season.players.find((x) => normName(x.name) === normName(name))
    if (clash) throw new ApiError(409, `Player "${clash.name}" already exists — reload and pick them from the list`)
    season.players.push({ id: p.id.slice(0, 60), name })
  }
}

const playerExists = (season: Season, id: unknown): boolean =>
  typeof id === 'string' && season.players.some((p) => p.id === id)

/** Validate the append against the latest document and apply it in place. Returns the commit message. */
function applyAppend(doc: LeagueData, req: AppendRequest, enteredBy: string): string {
  const season = doc.seasons.find((s) => s.id === req.seasonId)
  if (!season) throw new ApiError(400, 'Unknown season — reload the app')
  const by = enteredBy ? ` (by ${enteredBy})` : ''

  if (req.kind === 'player') {
    const p = req.entry as Player
    insertPlayers(season, [p])
    return `Add player ${clean(p.name)}${by}`
  }

  insertPlayers(season, req.newPlayers ?? [])
  const entry = req.entry as Omit<MatchGame, 'seq'> & Omit<TournamentEntry, 'seq'> & Omit<GuestGame, 'seq'>
  if (!isValidDate(entry.date)) throw new ApiError(400, 'Date is missing, malformed, or in the future')
  const nameOf = (id: string): string => season.players.find((p) => p.id === id)?.name ?? '?'
  const seq = nextSeq(season)

  const stamped = enteredBy || undefined
  const id = reqStr(entry.id, 60, 'id')

  if (req.kind === 'match') {
    if (!playerExists(season, entry.p1) || !playerExists(season, entry.p2) || entry.p1 === entry.p2) {
      throw new ApiError(400, 'A match needs two different registered players')
    }
    if (!isResult(entry.result)) throw new ApiError(400, 'Invalid result')
    season.matches.push({
      id,
      date: entry.date,
      p1: entry.p1,
      p2: entry.p2,
      result: entry.result,
      bp1: optNum(entry.bp1, 0, 1000, 'Battle points'),
      bp2: optNum(entry.bp2, 0, 1000, 'Battle points'),
      faction1: optStr(entry.faction1, 60),
      faction2: optStr(entry.faction2, 60),
      disposition1: optStr(entry.disposition1, 60),
      disposition2: optStr(entry.disposition2, 60),
      notes: optStr(entry.notes, 300),
      enteredBy: stamped,
      seq
    })
    return `Add match ${entry.date}: ${nameOf(entry.p1)} vs ${nameOf(entry.p2)}${by}`
  }

  if (req.kind === 'tournament') {
    if (!playerExists(season, entry.player)) throw new ApiError(400, 'Unknown player')
    const { rounds, wins, draws, losses, sos } = entry
    const ints = [rounds, wins, draws, losses]
    if (!ints.every((n) => Number.isInteger(n) && n >= 0) || rounds < 1 || rounds > 20) {
      throw new ApiError(400, 'Invalid rounds/W/D/L')
    }
    if (wins + draws + losses !== rounds) throw new ApiError(400, 'W+D+L must equal rounds played')
    if (typeof sos !== 'number' || sos < 0 || sos > 1) throw new ApiError(400, 'SoS must be between 0 and 1')
    const tournament = optStr(entry.tournament, 80) ?? 'Tournament'
    season.tournamentEntries.push({
      id,
      date: entry.date,
      tournament,
      player: entry.player,
      rounds,
      wins,
      draws,
      losses,
      vp: optNum(entry.vp, 0, 99999, 'VP'),
      sos,
      faction: optStr(entry.faction, 60),
      disposition: optStr(entry.disposition, 60),
      notes: optStr(entry.notes, 300),
      enteredBy: stamped,
      seq
    })
    return `Add tournament ${entry.date}: ${nameOf(entry.player)} at ${tournament}${by}`
  }

  if (req.kind === 'guest') {
    if (!playerExists(season, entry.player)) throw new ApiError(400, 'Unknown player')
    if (!isResult(entry.result)) throw new ApiError(400, 'Invalid result')
    const guestName = reqStr(entry.guestName, 60, 'Guest name')
    season.guestGames.push({
      id,
      date: entry.date,
      player: entry.player,
      result: entry.result,
      playerBP: optNum(entry.playerBP, 0, 1000, 'Battle points'),
      oppBP: optNum(entry.oppBP, 0, 1000, 'Battle points'),
      playerFaction: optStr(entry.playerFaction, 60),
      oppFaction: optStr(entry.oppFaction, 60),
      playerDisposition: optStr(entry.playerDisposition, 60),
      guestName,
      guestElo: optNum(entry.guestElo, 100, 3000, 'Guest ELO'),
      notes: optStr(entry.notes, 300),
      enteredBy: stamped,
      seq
    })
    return `Add guest game ${entry.date}: ${nameOf(entry.player)} vs ${guestName}${by}`
  }

  throw new ApiError(400, `Unknown append kind`)
}

// ---- request handling ----

function corsHeaders(env: Env, req: Request): Record<string, string> {
  const h: Record<string, string> = {
    'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-League-Code',
    'Access-Control-Max-Age': '86400'
  }
  const origin = req.headers.get('Origin')
  if (origin && env.ALLOWED_ORIGINS.split(',').some((o) => o.trim() === origin)) {
    h['Access-Control-Allow-Origin'] = origin
  }
  return h
}

function json(status: number, body: unknown, cors: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...cors }
  })
}

async function handle(req: Request, env: Env): Promise<Response> {
  const cors = corsHeaders(env, req)
  // Preflight deliberately stays allowlist-only: the public GETs are simple requests
  // that never preflight, and an open preflight would let any website fire member
  // writes cross-origin (CORS is the only thing stopping a drive-by page that has
  // somehow learned a code from committing from a visitor's browser).
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })
  const path = new URL(req.url).pathname

  // Public read endpoints are CORS-open: the data is world-readable anyway, and
  // consumers include OBS overlay pages served from arbitrary localhost origins.
  const publicCors = { ...cors, 'Access-Control-Allow-Origin': '*' }

  try {
    if (path === '/league' && req.method === 'GET') {
      const { doc, sha } = await ghGet(env)
      return json(200, { data: doc, sha }, publicCors)
    }

    // The computed league table (engine output, not raw data) — for overlays and
    // other read-only consumers that shouldn't have to reimplement the ELO replay.
    if (path === '/table' && req.method === 'GET') {
      const { doc } = await ghGet(env)
      const season = activeSeason(doc)
      const comp = computeSeason(season)
      const lastEvent = comp.timeline[comp.timeline.length - 1]
      return json(
        200,
        {
          leagueName: doc.settings.leagueName,
          seasonName: season.name,
          updated: lastEvent?.date ?? null,
          table: comp.table
        },
        publicCors
      )
    }

    if (path === '/auth' && req.method === 'POST') {
      const { code } = (await req.json()) as { code?: string }
      const role = await roleFor(env, code ?? null)
      if (!role) throw new ApiError(401, 'Wrong league code')
      return json(200, { role }, cors)
    }

    if (path === '/append' && req.method === 'POST') {
      await requireRole(env, req, 'member')
      const body = (await req.json()) as AppendRequest
      const enteredBy = clean(body.enteredBy).slice(0, 60)
      // Apply against HEAD; on a concurrent commit, re-read and re-apply.
      for (let attempt = 0; attempt < 3; attempt++) {
        const { doc, sha } = await ghGet(env)
        const message = applyAppend(doc, body, enteredBy)
        try {
          const committed = await ghPut(env, doc, sha, message)
          return json(200, { data: committed.doc, sha: committed.sha }, cors)
        } catch (e) {
          if (e instanceof ApiError && e.status === 409) continue
          throw e
        }
      }
      // Three consecutive sha conflicts — a raw "stale" would otherwise surface in a toast.
      throw new ApiError(409, 'The league is being updated by several people right now — try again in a moment')
    }

    if (path === '/league' && req.method === 'PUT') {
      await requireRole(env, req, 'admin')
      const body = (await req.json()) as { data?: LeagueData; baseSha?: string; enteredBy?: string }
      const doc = body.data
      if (!doc || doc.version !== 1 || !Array.isArray(doc.seasons) || doc.seasons.length === 0) {
        throw new ApiError(400, 'Not a valid league data document')
      }
      if (!body.baseSha) throw new ApiError(400, 'baseSha is required')
      // The Contents API stops returning file content at 1MB; refuse to grow the
      // document anywhere near that rather than brick every endpoint at once.
      if (JSON.stringify(body.data).length > 600_000) {
        throw new ApiError(413, 'League data would exceed the safe size limit — archive a season first')
      }
      const by = clean(body.enteredBy)
      const committed = await ghPut(env, doc, body.baseSha, `Admin save${by ? ` (by ${by})` : ''}`)
      return json(200, { data: committed.doc, sha: committed.sha }, cors)
    }

    throw new ApiError(404, 'Not found')
  } catch (e) {
    if (e instanceof ApiError) return json(e.status, { error: e.message }, cors)
    return json(500, { error: e instanceof Error ? e.message : 'Internal error' }, cors)
  }
}

export default {
  fetch: (req: Request, env: Env): Promise<Response> => handle(req, env)
}
