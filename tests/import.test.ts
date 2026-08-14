import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { importWorkbook, parseDate } from '../src/shared/importXlsx'
import { computeSeason } from '../src/shared/engine'

const wb = new Uint8Array(readFileSync(resolve(__dirname, 'fixtures/W40K_ELO_League_v2.xlsx')))

describe('xlsx import round-trip', () => {
  const { season, report } = importWorkbook(wb)

  it('imports every raw log row', () => {
    expect(report.matches).toBe(26)
    expect(report.tournamentEntries).toBe(3)
    expect(report.guestGames).toBe(1)
    expect(report.players).toBe(10) // trailing-space "Andrew  " merged, guest not a player
  })

  it('repairs the text-date guest row and notes it', () => {
    expect(season.guestGames[0].date).toBe('2026-08-13')
    expect(report.notes.some((n) => n.includes('08/13/2026'))).toBe(true)
  })

  it('produces the corrected league table', () => {
    const { table } = computeSeason(season)
    const byName = Object.fromEntries(table.map((p) => [p.name, p]))
    expect(byName['John'].rank).toBe(1)
    expect(byName['John'].elo).toBe(1071)
    expect(byName['Allan'].elo).toBe(1032)
    expect(byName['Andrew'].elo).toBe(982)
    expect(byName['Andrew'].games).toBe(15)
    expect(byName['Colin'].bp).toBe(1339)
  })

  it('reports the diffs caused by the two fixed data bugs', () => {
    const who = new Set(report.diffs.map((d) => d.name))
    expect(who.has('Andrew')).toBe(true) // trailing-space merge
    expect(who.has('Allan')).toBe(true) // guest game restored
  })
})

describe('parseDate', () => {
  it('handles serials, ISO, US and UK text dates', () => {
    expect(parseDate(46190)).toBe('2026-06-17')
    expect(parseDate('2026-08-13')).toBe('2026-08-13')
    expect(parseDate('08/13/2026')).toBe('2026-08-13') // month position forced by 13
    expect(parseDate('13/08/2026')).toBe('2026-08-13')
    expect(parseDate('01/02/2026')).toBe('2026-02-01') // ambiguous -> UK dd/mm
    expect(parseDate('not a date')).toBe(null)
  })
})
