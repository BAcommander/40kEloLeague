import type { LeagueData, Season } from './types'

export function activeSeason(data: LeagueData): Season {
  return data.seasons.find((s) => s.id === data.activeSeasonId) ?? data.seasons[0]
}

export function updateSeason(data: LeagueData, seasonId: string, fn: (s: Season) => Season): LeagueData {
  return {
    ...data,
    seasons: data.seasons.map((s) => (s.id === seasonId ? fn(s) : s))
  }
}

export function nextSeq(season: Season): number {
  let max = 0
  for (const m of season.matches) max = Math.max(max, m.seq)
  for (const t of season.tournamentEntries) max = Math.max(max, t.seq)
  for (const g of season.guestGames) max = Math.max(max, g.seq)
  return max + 1
}

/** Whitespace-collapsed, case-insensitive key — same matching rule the xlsx importer uses. */
export function normName(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLowerCase()
}
