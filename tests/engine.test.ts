import { describe, it, expect } from 'vitest'
import { computeSeason, serialToIso, dateToSerial } from '../src/shared/engine'
import type { Season, MatchGame, TournamentEntry, GuestGame, Player } from '../src/shared/types'
import rawMatches from './fixtures/raw-matches.json'
import rawTournaments from './fixtures/raw-tournaments.json'
import rawGuests from './fixtures/raw-guests.json'
import engineExpected from './fixtures/engine-expected.json'
import playersExpected from './fixtures/players-expected.json'

/**
 * Ground truth = the spreadsheet's own computed values.
 * The "bugged" season reproduces the spreadsheet's quirks verbatim:
 *  - player names NOT trimmed ("Andrew  " is a separate phantom player)
 *  - the guest game excluded from the ELO replay (its text date broke the sheet)
 *    but INCLUDED in games/BP aggregates (the sheet counted it via COUNTIF).
 */

function toMatch(r: (typeof rawMatches)[number]): MatchGame {
  return {
    id: `m${r.row}`,
    date: serialToIso(r.dateSerial as number),
    p1: r.p1 as string,
    p2: r.p2 as string,
    result: r.result as MatchGame['result'],
    bp1: r.bp1 ?? undefined,
    bp2: r.bp2 ?? undefined,
    faction1: r.f1 ?? undefined,
    faction2: r.f2 ?? undefined,
    seq: r.row
  }
}

function toTournament(r: (typeof rawTournaments)[number]): TournamentEntry {
  return {
    id: `t${r.row}`,
    date: serialToIso(r.dateSerial as number),
    tournament: r.tournament as string,
    player: r.player as string,
    rounds: r.rounds as number,
    wins: r.wins as number,
    draws: r.draws as number,
    losses: r.losses as number,
    vp: r.vp ?? undefined,
    sos: r.sos as number,
    faction: r.faction ?? undefined,
    seq: r.row
  }
}

/** Parse the guest log's US-format text date ("08/13/2026"). */
function guestDate(raw: string): string {
  const [mm, dd, yyyy] = raw.split('/')
  return `${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`
}

function toGuest(r: (typeof rawGuests)[number]): GuestGame {
  return {
    id: `g${r.row}`,
    date: guestDate(r.dateRaw as string),
    player: r.player as string,
    result: r.result as GuestGame['result'],
    playerBP: r.playerBP ?? undefined,
    oppBP: r.oppBP ?? undefined,
    playerFaction: r.playerFaction ?? undefined,
    oppFaction: r.oppFaction ?? undefined,
    guestName: r.guestName as string,
    guestElo: r.guestElo ?? undefined,
    seq: r.row
  }
}

function playersFrom(names: Iterable<string>): Player[] {
  return [...new Set(names)].map((n) => ({ id: n, name: n }))
}

const canonicalNames = playersExpected.map((p) => p.name)

function makeSeason(opts: { normalize: boolean; includeGuest: boolean }): Season {
  const norm = (s: string): string => (opts.normalize ? s.trim() : s)
  const matches = rawMatches.map(toMatch).map((m) => ({
    ...m,
    p1: norm(m.p1),
    p2: norm(m.p2),
    faction1: m.faction1?.trim(),
    faction2: m.faction2?.trim()
  }))
  const tournamentEntries = rawTournaments.map(toTournament).map((t) => ({
    ...t,
    player: norm(t.player)
  }))
  const guestGames = opts.includeGuest
    ? rawGuests.map(toGuest).map((g) => ({ ...g, player: norm(g.player) }))
    : []
  const names = new Set<string>(canonicalNames)
  for (const m of matches) {
    names.add(m.p1)
    names.add(m.p2)
  }
  for (const t of tournamentEntries) names.add(t.player)
  for (const g of guestGames) names.add(g.player)
  return {
    id: 's1',
    name: 'Test season',
    players: playersFrom(names),
    matches,
    tournamentEntries,
    guestGames
  }
}

describe('ELO replay vs spreadsheet ELO Engine (bugs preserved)', () => {
  const { timeline } = computeSeason(makeSeason({ normalize: false, includeGuest: false }))

  it('replays the same number of events in the same order', () => {
    expect(timeline.length).toBe(engineExpected.length)
    for (let i = 0; i < engineExpected.length; i++) {
      expect(timeline[i].type, `event ${i} type`).toBe(engineExpected[i].type)
      expect(timeline[i].playerName, `event ${i} player`).toBe(engineExpected[i].p1)
      expect(dateToSerial(timeline[i].date), `event ${i} date`).toBe(engineExpected[i].dateSerial)
    }
  })

  it('matches every ELO before/after, K, delta exactly', () => {
    for (let i = 0; i < engineExpected.length; i++) {
      const got = timeline[i]
      const exp = engineExpected[i]
      expect(got.eloBefore, `event ${i} eloBefore`).toBe(exp.eloBefore)
      expect(got.opponentElo, `event ${i} oppElo`).toBe(exp.oppElo)
      expect(got.kFactor, `event ${i} K`).toBe(exp.kFactor)
      expect(got.delta, `event ${i} delta`).toBe(exp.delta)
      expect(got.eloAfter, `event ${i} eloAfter`).toBe(exp.eloAfterP1)
      expect(got.expected, `event ${i} expected`).toBeCloseTo(exp.expected as number, 9)
      expect(got.actual, `event ${i} actual`).toBeCloseTo(exp.actual as number, 9)
      if (exp.eloAfterP2 != null) {
        expect(got.opponentEloAfter, `event ${i} eloAfterP2`).toBe(exp.eloAfterP2)
      }
    }
  })

  it('reproduces each player’s current and peak ELO', () => {
    const { table } = computeSeason(makeSeason({ normalize: false, includeGuest: false }))
    for (const exp of playersExpected) {
      const got = table.find((p) => p.name === exp.name)!
      expect(got.elo, `${exp.name} elo`).toBe(exp.elo)
      expect(got.peakElo, `${exp.name} peak`).toBe(exp.peak)
    }
  })
})

describe('Aggregates vs spreadsheet Player Data (guest counted, as the sheet did)', () => {
  const { table } = computeSeason(makeSeason({ normalize: false, includeGuest: true }))

  it('matches games, W/D/L, BP and win% for every player', () => {
    for (const exp of playersExpected) {
      const got = table.find((p) => p.name === exp.name)!
      expect(got.games, `${exp.name} games`).toBe(exp.games)
      expect(got.wins, `${exp.name} wins`).toBe(exp.wins)
      expect(got.draws, `${exp.name} draws`).toBe(exp.draws)
      expect(got.losses, `${exp.name} losses`).toBe(exp.losses)
      expect(got.bp, `${exp.name} bp`).toBe(exp.bp)
      expect(got.winPct, `${exp.name} win%`).toBeCloseTo(exp.winPct as number, 9)
    }
  })
})

describe('Fixed data (normalized names + guest game restored)', () => {
  const season = makeSeason({ normalize: true, includeGuest: true })
  const { timeline, table } = computeSeason(season)

  it('has no phantom trailing-space players', () => {
    expect(season.players.some((p) => p.name !== p.name.trim())).toBe(false)
    expect(timeline.length).toBe(engineExpected.length + 1) // guest game restored
  })

  it('slots the guest game into the timeline chronologically', () => {
    const guest = timeline.find((e) => e.type === 'Guest')!
    expect(guest.date).toBe('2026-08-13')
    const idx = timeline.indexOf(guest)
    expect(dateToSerial(timeline[idx - 1].date)).toBeLessThanOrEqual(dateToSerial(guest.date))
    expect(dateToSerial(timeline[idx + 1].date)).toBeGreaterThanOrEqual(dateToSerial(guest.date))
  })

  it('credits Allan with the guest win: 1017 + 15 = 1032', () => {
    const allan = table.find((p) => p.name === 'Allan')!
    expect(allan.elo).toBe(1032)
    expect(allan.games).toBe(2)
    expect(allan.wins).toBe(2)
  })

  it('merges Andrew’s trailing-space games: 15 games, 6W 0D 9L', () => {
    const andrew = table.find((p) => p.name === 'Andrew')!
    expect(andrew.games).toBe(15)
    expect(andrew.wins).toBe(6)
    expect(andrew.draws).toBe(0)
    expect(andrew.losses).toBe(9)
  })
})

describe('Ranking eligibility (minimum games) and disposition stats', () => {
  const mini: Season = {
    id: 's-mini',
    name: 'Mini',
    players: [
      { id: 'a', name: 'A' },
      { id: 'b', name: 'B' },
      { id: 'c', name: 'C' }
    ],
    matches: [
      { id: 'm1', date: '2026-01-01', p1: 'a', p2: 'b', result: 'Win', seq: 1, disposition1: 'Gladius', disposition2: 'Bully Boyz' },
      { id: 'm2', date: '2026-01-02', p1: 'a', p2: 'b', result: 'Loss', seq: 2, disposition1: 'Gladius' },
      { id: 'm3', date: '2026-01-03', p1: 'c', p2: 'a', result: 'Win', seq: 3, disposition1: 'Bully Boyz' }
    ],
    tournamentEntries: [],
    guestGames: []
  }

  it('players under the default 3-game minimum are provisional and unranked', () => {
    const { table } = computeSeason(mini)
    const c = table.find((p) => p.name === 'C')!
    expect(c.games).toBe(1)
    expect(c.provisional).toBe(true)
    expect(c.rank).toBe(0)
    // Despite winning their only game (ELO 1016), C claims no table position.
    expect(c.elo).toBe(1016)
    // B has 2 games — once or twice still isn't enough.
    expect(table.find((p) => p.name === 'B')!.provisional).toBe(true)
  })

  it('qualified players get consecutive ranks with no gaps', () => {
    const { table } = computeSeason(mini)
    const ranked = table.filter((p) => !p.provisional)
    expect(ranked.map((p) => p.name)).toEqual(['A'])
    expect(ranked.map((p) => p.rank)).toEqual([1])
    expect(ranked.every((p) => p.games >= 3)).toBe(true)
  })

  it('respects a per-season minRankedGames override', () => {
    const { table } = computeSeason({ ...mini, minRankedGames: 1 })
    expect(table.every((p) => !p.provisional)).toBe(true)
    expect(table.map((p) => p.rank)).toEqual([1, 2, 3])
  })

  it('aggregates disposition W/D/L player-agnostically across both sides', () => {
    const { dispositionStats } = computeSeason(mini)
    const byName = Object.fromEntries(dispositionStats.map((d) => [d.disposition, d]))
    // Gladius: A won m1 and lost m2 with it.
    expect(byName['Gladius']).toMatchObject({ games: 2, wins: 1, draws: 0, losses: 1 })
    // Bully Boyz: B lost m1 with it, C won m3 with it — two different players, one stat.
    expect(byName['Bully Boyz']).toMatchObject({ games: 2, wins: 1, draws: 0, losses: 1 })
    expect(byName['Bully Boyz'].players.sort()).toEqual(['B', 'C'])
  })
})
