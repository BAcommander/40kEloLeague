/**
 * Dev-only in-memory backend, used when `npm run dev` runs without a worker
 * (no VITE_WORKER_URL). Seeded from devSeed.json; codes are "member"/"admin".
 * Appends run through the SAME applyAppend the worker uses, so dev exercises
 * production validation. Never bundled in production builds.
 */
import type { LeagueData } from '@shared/types'
import type { AppendRequest, LeagueSnapshot, Role } from '@shared/protocol'
import { ApiError } from '@shared/protocol'
import { applyAppend } from '@shared/append'
import seedJson from './devSeed.json'

let doc = structuredClone(seedJson) as unknown as LeagueData
let rev = 1

const snap = (): LeagueSnapshot => ({ data: structuredClone(doc), sha: `local-${rev}` })

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
    const next = structuredClone(doc)
    applyAppend(next, req, req.enteredBy ?? '')
    doc = next
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
