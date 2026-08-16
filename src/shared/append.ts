/**
 * The append operation: validate a member-submitted entry against a league
 * document and apply it in place. Runs in the Cloudflare Worker for real, and
 * in the browser's dev-mode local backend — one implementation, so `npm run dev`
 * exercises exactly the validation production enforces.
 *
 * Entries are REBUILT field-by-field rather than spread from the request: the
 * shared member code is deliberately low-trust, so numbers get bounds (no
 * 999999-ELO guests), strings get length caps, and unknown junk fields never
 * reach the data file.
 */
import type { GameResult, GuestGame, LeagueData, MatchGame, Player, Season, TournamentEntry } from './types'
import type { AppendRequest } from './protocol'
import { ApiError } from './protocol'
import { nextSeq, normName } from './data'

export const clean = (s: unknown): string => (typeof s === 'string' ? s.trim().replace(/\s+/g, ' ') : '')

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
export function applyAppend(doc: LeagueData, req: AppendRequest, enteredBy: string): string {
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
