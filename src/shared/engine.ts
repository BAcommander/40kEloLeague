import type {
  Season,
  SeasonComputation,
  TimelineEvent,
  PlayerStats,
  FactionStats,
  HeadToHeadCell,
  GameResult
} from './types'

/**
 * Pure ELO calculation engine. Replicates the spreadsheet's "ELO Engine" sheet
 * exactly so imported history produces identical numbers.
 */

export const DEFAULT_START_ELO = 1000
export const MATCH_K = 32
export const TOURNAMENT_K_CAP = 96

/** Excel's ROUND: half away from zero (JS Math.round rounds -16.5 to -16, Excel to -17). */
export function excelRound(x: number, dp = 0): number {
  const f = Math.pow(10, dp)
  return (Math.sign(x) * Math.round(Math.abs(x) * f)) / f
}

/** Days since 1899-12-30 (Excel date serial, 1900 system). */
export function dateToSerial(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number)
  return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 86400000)
}

export function serialToIso(serial: number): string {
  const ms = Date.UTC(1899, 11, 30) + Math.round(serial) * 86400000
  return new Date(ms).toISOString().slice(0, 10)
}

export function expectedScore(mine: number, opp: number): number {
  return 1 / (1 + Math.pow(10, (opp - mine) / 400))
}

export function actualScore(result: GameResult): number {
  return result === 'Win' ? 1 : result === 'Draw' ? 0.5 : 0
}

export function phantomElo(sos: number): number {
  return excelRound(800 + sos * 400, 0)
}

export function compositeScore(wins: number, draws: number, rounds: number): number {
  return excelRound((wins + 0.5 * draws) / rounds, 4)
}

export function tournamentK(rounds: number): number {
  return Math.min(MATCH_K * rounds, TOURNAMENT_K_CAP)
}

// Same-day ordering offsets, matching the spreadsheet's sort keys:
// matches first, then guests (+0.0003), then tournaments (+0.0005).
const TYPE_OFFSET = { Match: 0, Guest: 0.0003, Tournament: 0.0005 } as const

export function computeSeason(season: Season): SeasonComputation {
  const nameOf = new Map(season.players.map((p) => [p.id, p.name]))
  const startOf = (id: string): number => season.startingElos?.[id] ?? DEFAULT_START_ELO

  // Build the unified chronological timeline
  type Pending =
    | { type: 'Match'; sortKey: number; m: Season['matches'][number] }
    | { type: 'Tournament'; sortKey: number; t: Season['tournamentEntries'][number] }
    | { type: 'Guest'; sortKey: number; g: Season['guestGames'][number] }

  const pending: Pending[] = [
    ...season.matches.map((m) => ({
      type: 'Match' as const,
      sortKey: dateToSerial(m.date) + TYPE_OFFSET.Match + m.seq / 1e7,
      m
    })),
    ...season.tournamentEntries.map((t) => ({
      type: 'Tournament' as const,
      sortKey: dateToSerial(t.date) + TYPE_OFFSET.Tournament + t.seq / 1e7,
      t
    })),
    ...season.guestGames.map((g) => ({
      type: 'Guest' as const,
      sortKey: dateToSerial(g.date) + TYPE_OFFSET.Guest + g.seq / 1e7,
      g
    }))
  ]
  pending.sort((a, b) => a.sortKey - b.sortKey)

  const elo = new Map<string, number>() // playerId -> current ELO
  const current = (id: string): number => elo.get(id) ?? startOf(id)

  const timeline: TimelineEvent[] = []

  for (const ev of pending) {
    if (ev.type === 'Match') {
      const { m } = ev
      const before = current(m.p1)
      const oppBefore = current(m.p2)
      const e = expectedScore(before, oppBefore)
      const a = actualScore(m.result)
      const delta = excelRound(MATCH_K * (a - e), 0)
      const after = before + delta
      const oppAfter = oppBefore - delta
      elo.set(m.p1, after)
      elo.set(m.p2, oppAfter)
      timeline.push({
        type: 'Match',
        sourceId: m.id,
        date: m.date,
        sortKey: ev.sortKey,
        playerId: m.p1,
        playerName: nameOf.get(m.p1) ?? m.p1,
        opponentLabel: nameOf.get(m.p2) ?? m.p2,
        opponentId: m.p2,
        eloBefore: before,
        opponentElo: oppBefore,
        expected: e,
        actual: a,
        kFactor: MATCH_K,
        delta,
        eloAfter: after,
        opponentEloBefore: oppBefore,
        opponentEloAfter: oppAfter,
        result: m.result,
        faction: m.faction1,
        opponentFaction: m.faction2
      })
    } else if (ev.type === 'Tournament') {
      const { t } = ev
      const before = current(t.player)
      const opp = phantomElo(t.sos)
      const e = expectedScore(before, opp)
      const a = compositeScore(t.wins, t.draws, t.rounds)
      const k = tournamentK(t.rounds)
      const delta = excelRound(k * (a - e), 0)
      const after = before + delta
      elo.set(t.player, after)
      timeline.push({
        type: 'Tournament',
        sourceId: t.id,
        date: t.date,
        sortKey: ev.sortKey,
        playerId: t.player,
        playerName: nameOf.get(t.player) ?? t.player,
        opponentLabel: `${t.tournament} (Phantom)`,
        eloBefore: before,
        opponentElo: opp,
        expected: e,
        actual: a,
        kFactor: k,
        delta,
        eloAfter: after,
        faction: t.faction
      })
    } else {
      const { g } = ev
      const before = current(g.player)
      const opp = g.guestElo ?? DEFAULT_START_ELO
      const e = expectedScore(before, opp)
      const a = actualScore(g.result)
      const delta = excelRound(MATCH_K * (a - e), 0)
      const after = before + delta
      elo.set(g.player, after)
      timeline.push({
        type: 'Guest',
        sourceId: g.id,
        date: g.date,
        sortKey: ev.sortKey,
        playerId: g.player,
        playerName: nameOf.get(g.player) ?? g.player,
        opponentLabel: `${g.guestName} (Guest)`,
        eloBefore: before,
        opponentElo: opp,
        expected: e,
        actual: a,
        kFactor: MATCH_K,
        delta,
        eloAfter: after,
        result: g.result,
        faction: g.playerFaction,
        opponentFaction: g.oppFaction
      })
    }
  }

  // ---- Per-player aggregates ----
  const table: PlayerStats[] = season.players.map((p) => {
    let wins = 0
    let draws = 0
    let losses = 0
    let games = 0
    let bp = 0
    for (const m of season.matches) {
      if (m.p1 === p.id) {
        games++
        bp += m.bp1 ?? 0
        if (m.result === 'Win') wins++
        else if (m.result === 'Draw') draws++
        else losses++
      }
      if (m.p2 === p.id) {
        games++
        bp += m.bp2 ?? 0
        if (m.result === 'Loss') wins++
        else if (m.result === 'Draw') draws++
        else losses++
      }
    }
    for (const t of season.tournamentEntries) {
      if (t.player === p.id) {
        games += t.rounds
        wins += t.wins
        draws += t.draws
        losses += t.losses
        bp += t.vp ?? 0
      }
    }
    for (const g of season.guestGames) {
      if (g.player === p.id) {
        games++
        bp += g.playerBP ?? 0
        if (g.result === 'Win') wins++
        else if (g.result === 'Draw') draws++
        else losses++
      }
    }
    const start = startOf(p.id)
    let peak = Math.max(DEFAULT_START_ELO, start)
    for (const ev of timeline) {
      if (ev.playerId === p.id) peak = Math.max(peak, ev.eloAfter)
      if (ev.opponentId === p.id && ev.opponentEloAfter !== undefined)
        peak = Math.max(peak, ev.opponentEloAfter)
    }
    return {
      playerId: p.id,
      name: p.name,
      rank: 0,
      elo: current(p.id),
      peakElo: peak,
      games,
      wins,
      draws,
      losses,
      winPct: games === 0 ? 0 : wins / games,
      bp,
      avgBp: games === 0 ? 0 : bp / games,
      tournamentsPlayed: season.tournamentEntries.filter((t) => t.player === p.id).length
    }
  })

  // League sort: ELO desc, then average BP desc (spreadsheet tie-break), then name.
  table.sort(
    (a, b) => b.elo - a.elo || b.avgBp - a.avgBp || a.name.localeCompare(b.name)
  )
  table.forEach((s, i) => (s.rank = i + 1))

  // ---- ELO history per player ----
  const eloHistory: SeasonComputation['eloHistory'] = {}
  const firstDate = timeline.length > 0 ? timeline[0].date : ''
  for (const p of season.players) {
    eloHistory[p.id] = [{ date: firstDate, elo: startOf(p.id), label: 'Start' }]
  }
  for (const ev of timeline) {
    eloHistory[ev.playerId]?.push({
      date: ev.date,
      elo: ev.eloAfter,
      label: `vs ${ev.opponentLabel}`
    })
    if (ev.opponentId && ev.opponentEloAfter !== undefined) {
      eloHistory[ev.opponentId]?.push({
        date: ev.date,
        elo: ev.opponentEloAfter,
        label: `vs ${ev.playerName}`
      })
    }
  }

  // ---- Faction stats (league players' factions only) ----
  const factions = new Map<string, FactionStats>()
  const bump = (
    faction: string | undefined,
    playerName: string,
    w: number,
    d: number,
    l: number
  ): void => {
    const name = faction?.trim()
    if (!name) return
    let f = factions.get(name)
    if (!f) {
      f = { faction: name, games: 0, wins: 0, draws: 0, losses: 0, winPct: 0, players: [] }
      factions.set(name, f)
    }
    f.games += w + d + l
    f.wins += w
    f.draws += d
    f.losses += l
    if (!f.players.includes(playerName)) f.players.push(playerName)
  }
  for (const m of season.matches) {
    const p1 = nameOf.get(m.p1) ?? m.p1
    const p2 = nameOf.get(m.p2) ?? m.p2
    bump(m.faction1, p1, m.result === 'Win' ? 1 : 0, m.result === 'Draw' ? 1 : 0, m.result === 'Loss' ? 1 : 0)
    bump(m.faction2, p2, m.result === 'Loss' ? 1 : 0, m.result === 'Draw' ? 1 : 0, m.result === 'Win' ? 1 : 0)
  }
  for (const t of season.tournamentEntries) {
    bump(t.faction, nameOf.get(t.player) ?? t.player, t.wins, t.draws, t.losses)
  }
  for (const g of season.guestGames) {
    const p = nameOf.get(g.player) ?? g.player
    bump(g.playerFaction, p, g.result === 'Win' ? 1 : 0, g.result === 'Draw' ? 1 : 0, g.result === 'Loss' ? 1 : 0)
  }
  const factionStats = [...factions.values()]
  for (const f of factionStats) f.winPct = f.games === 0 ? 0 : f.wins / f.games
  factionStats.sort((a, b) => b.games - a.games || a.faction.localeCompare(b.faction))

  // ---- Head-to-head (matches only) ----
  const headToHead: Record<string, Record<string, HeadToHeadCell>> = {}
  const cell = (a: string, b: string): HeadToHeadCell => {
    headToHead[a] ??= {}
    headToHead[a][b] ??= { wins: 0, draws: 0, losses: 0 }
    return headToHead[a][b]
  }
  for (const m of season.matches) {
    if (m.result === 'Win') {
      cell(m.p1, m.p2).wins++
      cell(m.p2, m.p1).losses++
    } else if (m.result === 'Loss') {
      cell(m.p1, m.p2).losses++
      cell(m.p2, m.p1).wins++
    } else {
      cell(m.p1, m.p2).draws++
      cell(m.p2, m.p1).draws++
    }
  }

  return { timeline, table, eloHistory, factionStats, headToHead }
}
