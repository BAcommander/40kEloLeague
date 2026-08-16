/** Request/response shapes shared by the web client and the Cloudflare Worker API. */
import type { GuestGame, LeagueData, MatchGame, Player, TournamentEntry } from './types'

export type Role = 'member' | 'admin'

export type AppendKind = 'match' | 'tournament' | 'guest' | 'player'

/**
 * A member-level write: append one new entry (and any players created inline
 * with it) to a season. The worker fetches the latest data, assigns `seq`,
 * validates, and commits — so a stale client can never lose anyone's games.
 */
export interface AppendRequest {
  seasonId: string
  kind: AppendKind
  entry: Omit<MatchGame, 'seq'> | Omit<TournamentEntry, 'seq'> | Omit<GuestGame, 'seq'> | Player
  /** Players created inline while entering this result (kind 'player' puts the player in `entry`). */
  newPlayers?: Player[]
  enteredBy?: string
}

export interface LeagueSnapshot {
  data: LeagueData
  /** Git blob SHA of league-data.json at this state — the concurrency token for admin saves. */
  sha: string
}
