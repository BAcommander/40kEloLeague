export type GameResult = 'Win' | 'Draw' | 'Loss'

export interface Player {
  id: string
  name: string
}

/** A singles game between two league players. `result` is from P1's perspective. */
export interface MatchGame {
  id: string
  date: string // ISO yyyy-mm-dd
  p1: string // player id
  p2: string // player id
  result: GameResult
  bp1?: number
  bp2?: number
  faction1?: string
  faction2?: string
  disposition1?: string
  disposition2?: string
  notes?: string
  /** Who submitted this result (web app; informational only). */
  enteredBy?: string
  /** Stable entry order; replicates the spreadsheet's row-based tie-break within a day. */
  seq: number
}

/** One row per player per tournament. ELO is applied vs a "phantom" opponent. */
export interface TournamentEntry {
  id: string
  date: string
  tournament: string
  player: string // player id
  rounds: number
  wins: number
  draws: number
  losses: number
  vp?: number
  /** Strength of schedule, 0..1. Phantom opponent ELO = round(800 + sos*400). */
  sos: number
  faction?: string
  disposition?: string
  notes?: string
  /** Who submitted this result (web app; informational only). */
  enteredBy?: string
  seq: number
}

/** A game vs a one-off, unregistered opponent. Only the league player's ELO moves. */
export interface GuestGame {
  id: string
  date: string
  player: string // player id
  result: GameResult
  playerBP?: number
  oppBP?: number
  playerFaction?: string
  oppFaction?: string
  playerDisposition?: string
  guestName: string
  guestElo?: number // defaults to 1000
  notes?: string
  /** Who submitted this result (web app; informational only). */
  enteredBy?: string
  seq: number
}

export interface Season {
  id: string
  name: string
  archived?: boolean
  /** Per-player starting ELO overrides (e.g. carry-over from a previous season). */
  startingElos?: Record<string, number>
  /** Games needed to appear in the ranked league table (default 2); fewer = provisional. */
  minRankedGames?: number
  players: Player[]
  matches: MatchGame[]
  tournamentEntries: TournamentEntry[]
  guestGames: GuestGame[]
}

export interface ImportDiff {
  name: string
  field: string
  old: number | string
  new: number | string
}

export interface ImportReport {
  importedAt: string
  matches: number
  tournamentEntries: number
  guestGames: number
  players: number
  /** Differences between the workbook's own League Table and our recomputation. */
  diffs: ImportDiff[]
  notes: string[]
}

export interface LeagueData {
  version: 1
  settings: {
    leagueName: string
  }
  activeSeasonId: string
  seasons: Season[]
  /** Present when the data came from an Excel import — the reconciliation record. */
  importReport?: ImportReport
}

// ---- Computed output ----

export type EventType = 'Match' | 'Tournament' | 'Guest'

/** One replayed step in the chronological ELO timeline. */
export interface TimelineEvent {
  type: EventType
  sourceId: string // id of the MatchGame / TournamentEntry / GuestGame
  date: string
  sortKey: number
  /** Primary player (P1 for matches). */
  playerId: string
  playerName: string
  /** Opponent display label: player name, "<tournament> (Phantom)" or "<guest> (Guest)". */
  opponentLabel: string
  opponentId?: string // set for matches only
  eloBefore: number
  opponentElo: number
  expected: number
  actual: number
  kFactor: number
  delta: number
  eloAfter: number
  /** Matches only: the opponent's mirrored numbers. */
  opponentEloBefore?: number
  opponentEloAfter?: number
  result?: GameResult
  faction?: string
  opponentFaction?: string
  disposition?: string
}

export interface PlayerStats {
  playerId: string
  name: string
  /** 0 while provisional (below the season's minimum ranked games). */
  rank: number
  provisional: boolean
  elo: number
  peakElo: number
  games: number
  wins: number
  draws: number
  losses: number
  winPct: number
  bp: number
  avgBp: number
  tournamentsPlayed: number
}

export interface FactionStats {
  faction: string
  games: number
  wins: number
  draws: number
  losses: number
  winPct: number
  players: string[] // player names who fielded it
}

/** Player-agnostic W/D/L record of an army disposition across all recorded games. */
export interface DispositionStats {
  disposition: string
  games: number
  wins: number
  draws: number
  losses: number
  winPct: number
  players: string[] // player names who ran it
}

export interface HeadToHeadCell {
  wins: number
  draws: number
  losses: number
}

export interface SeasonComputation {
  timeline: TimelineEvent[]
  table: PlayerStats[]
  /** playerId -> [{date, elo}] starting with the initial rating. */
  eloHistory: Record<string, { date: string; elo: number; label: string }[]>
  factionStats: FactionStats[]
  dispositionStats: DispositionStats[]
  /** headToHead[playerIdA][playerIdB] = A's record vs B (matches only). */
  headToHead: Record<string, Record<string, HeadToHeadCell>>
}
