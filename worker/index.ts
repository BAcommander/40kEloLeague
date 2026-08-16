/**
 * PKH League API â€” a thin write gate in front of the GitHub repo.
 *
 * The league data file lives on the `data` branch of the repo; this worker is
 * the only thing holding a token that can commit to it. Reads are public.
 * Appends (member code) are applied server-side against the latest data, so
 * concurrent uploads from different devices can never lose each other's games.
 * Full-document saves (admin code) carry the SHA the client loaded and are
 * rejected as stale if someone else committed first.
 */
import type { LeagueData } from '../src/shared/types'
import type { AppendRequest, Role } from '../src/shared/protocol'
import { ApiError } from '../src/shared/protocol'
import { activeSeason } from '../src/shared/data'
import { applyAppend, clean } from '../src/shared/append'
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

// btoa/atob alone corrupt non-ASCII (player names, notes) â€” go through raw bytes.
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
    throw new ApiError(503, `League data not found â€” has ${env.DATA_PATH} been committed to the ${env.DATA_BRANCH} branch?`)
  }
  if (!res.ok) throw new ApiError(502, `GitHub read failed (${res.status})`)
  const body = (await res.json()) as { content: string; sha: string }
  try {
    return { doc: JSON.parse(b64decode(body.content)) as LeagueData, sha: body.sha }
  } catch {
    // The file at HEAD is unreadable (hand-edited to invalid JSON, or past the
    // Contents API's 1MB inline limit). The league must never be repairable only
    // by git surgery â€” same rule the old desktop app's backup recovery enforced â€”
    // so serve the newest parseable prior version instead. The returned sha stays
    // the BROKEN blob's sha, so the next successful write commits the recovered
    // document right over the corruption.
    return { doc: await recoverFromHistory(env), sha: body.sha }
  }
}

async function recoverFromHistory(env: Env): Promise<LeagueData> {
  const res = await fetch(
    `https://api.github.com/repos/${env.GH_REPO}/commits?path=${env.DATA_PATH}&sha=${env.DATA_BRANCH}&per_page=10`,
    { headers: ghHeaders(env) }
  )
  if (res.ok) {
    const commits = (await res.json()) as { sha: string }[]
    for (const c of commits.slice(1)) {
      const r = await fetch(`${contentsUrl(env)}?ref=${c.sha}`, { headers: ghHeaders(env) })
      if (!r.ok) continue
      try {
        return JSON.parse(b64decode(((await r.json()) as { content: string }).content)) as LeagueData
      } catch {
        continue
      }
    }
  }
  throw new ApiError(500, 'League data file is unreadable and no recoverable version was found in its last 10 commits')
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
    // GitHub reports SHA conflicts as 422 "â€¦does not matchâ€¦" as well as 409.
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

    // The computed league table (engine output, not raw data) â€” for overlays and
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
        // Same ceiling as admin PUTs â€” appends alone must not be able to grow the
        // file toward the Contents API's 1MB limit either.
        if (JSON.stringify(doc).length > 600_000) {
          throw new ApiError(413, 'League data would exceed the safe size limit â€” archive a season first')
        }
        try {
          const committed = await ghPut(env, doc, sha, message)
          return json(200, { data: committed.doc, sha: committed.sha }, cors)
        } catch (e) {
          if (e instanceof ApiError && e.status === 409) continue
          throw e
        }
      }
      // Three consecutive sha conflicts â€” a raw "stale" would otherwise surface in a toast.
      throw new ApiError(409, 'The league is being updated by several people right now â€” try again in a moment')
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
        throw new ApiError(413, 'League data would exceed the safe size limit â€” archive a season first')
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
