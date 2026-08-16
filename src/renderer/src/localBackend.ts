/**
 * Dev-only in-memory backend, used when `npm run dev` runs without a worker
 * (no VITE_WORKER_URL). Seeded from devSeed.json; codes are "member"/"admin".
 * Never bundled in production builds.
 */
import type { LeagueData, Player, Season } from '@shared/types'
import type { AppendRequest, LeagueSnapshot, Role } from '@shared/protocol'
import { nextSeq } from '@shared/data'
import { ApiError } from './remote'
import seedJson from './devSeed.json'

let doc = structuredClone(seedJson) as unknown as LeagueData
let rev = 1

const snap = (): LeagueSnapshot => ({ data: structuredClone(doc), sha: `local-${rev}` })

function seasonOf(id: string): Season {
  const s = doc.seasons.find((x) => x.id === id)
  if (!s) throw new ApiError(400, 'Unknown season')
  return s
}

export const localBackend = {
  async getLeague(): Promise<LeagueSnapshot> {
    return snap()
  },
  async auth(code: string): Promise<Role> {
    if (code === 'admin') return 'admin'
    if (code === 'member') return 'member'
    throw new ApiError(401, 'Wrong league code (dev codes: "member" / "admin")')
  },
  async append(req: AppendRequest): Promise<LeagueSnapshot> {
    const season = seasonOf(req.seasonId)
    const insert = (p: Player): void => {
      if (!season.players.some((x) => x.id === p.id)) season.players.push({ ...p })
    }
    if (req.kind === 'player') {
      insert(req.entry as Player)
    } else {
      for (const p of req.newPlayers ?? []) insert(p)
      const entry = { ...req.entry, enteredBy: req.enteredBy || undefined, seq: nextSeq(season) }
      if (req.kind === 'match') season.matches.push(entry as Season['matches'][number])
      else if (req.kind === 'tournament') season.tournamentEntries.push(entry as Season['tournamentEntries'][number])
      else season.guestGames.push(entry as Season['guestGames'][number])
    }
    rev++
    return snap()
  },
  async putLeague(data: LeagueData, baseSha: string): Promise<LeagueSnapshot> {
    if (baseSha !== `local-${rev}`) throw new ApiError(409, 'stale')
    doc = structuredClone(data)
    rev++
    return snap()
  }
}
