/**
 * Dev-time: parse the original league workbook into the app's bundled seed data.
 * Usage: npm run import:xlsx [path-to-xlsx]
 */
import { readFileSync, writeFileSync } from 'fs'
import { resolve } from 'path'
import { importWorkbook } from '../src/shared/importXlsx'
import { computeSeason } from '../src/shared/engine'
import type { LeagueData } from '../src/shared/types'

const src = process.argv[2] ?? 'C:/Users/jazzs/Downloads/W40K_ELO_League_v2.xlsx'
const out = resolve(__dirname, '../src/main/seed.json')

const { season, report } = importWorkbook(new Uint8Array(readFileSync(src)))

const data: LeagueData & { importReport?: typeof report } = {
  version: 1,
  settings: { leagueName: 'PKH W40K ELO League' },
  activeSeasonId: season.id,
  seasons: [season],
  importReport: report
}

writeFileSync(out, JSON.stringify(data, null, 2), 'utf-8')

console.log(`Imported: ${report.matches} matches, ${report.tournamentEntries} tournament entries, ${report.guestGames} guest games, ${report.players} players`)
console.log(`Seed written to ${out}`)
if (report.notes.length) {
  console.log('\nNotes:')
  for (const n of report.notes) console.log('  -', n)
}
if (report.diffs.length) {
  console.log('\nReconciliation vs old spreadsheet table (differences are the fixed data-entry bugs):')
  for (const d of report.diffs) console.log(`  ${d.name} ${d.field}: ${d.old} -> ${d.new}`)
} else {
  console.log('\nNo differences vs old spreadsheet table.')
}

console.log('\nNew league table:')
const { table } = computeSeason(season)
for (const p of table) {
  console.log(
    `  ${String(p.rank).padStart(2)} ${p.name.padEnd(8)} ELO ${p.elo} (peak ${p.peakElo})  ${p.games}G ${p.wins}W ${p.draws}D ${p.losses}L  BP ${p.bp}`
  )
}
