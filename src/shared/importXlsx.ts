import * as XLSX from 'xlsx'
import { computeSeason, serialToIso } from './engine'
import type {
  Season,
  Player,
  MatchGame,
  TournamentEntry,
  GuestGame,
  GameResult,
  ImportDiff,
  ImportReport
} from './types'

/**
 * Parses the original W40K_ELO_League Excel workbook into a Season.
 * Reads only the raw input columns of the three log sheets (all formula/derived
 * columns are ignored — the app recomputes everything itself).
 *
 * Data-entry quirks handled:
 *  - player/faction names are trimmed and whitespace-collapsed (the sheet had a
 *    phantom "Andrew  " player from trailing spaces)
 *  - dates entered as text (e.g. "08/13/2026") are parsed; numeric Excel serials too
 *  - dates were typed US-style (mm/dd) but UK-locale Excel read some as dd/mm and
 *    stored the wrong serial; any imported date in the future gets its day/month
 *    swapped back when that lands in the past, and is flagged for confirmation
 */

export type { ImportDiff, ImportReport }

export interface ImportResult {
  season: Season
  report: ImportReport
}

const normalize = (s: unknown): string => String(s ?? '').replace(/\s+/g, ' ').trim()

function parseResult(v: unknown): GameResult | null {
  const s = normalize(v).toLowerCase()
  if (s === 'win') return 'Win'
  if (s === 'draw') return 'Draw'
  if (s === 'loss') return 'Loss'
  return null
}

function parseNum(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  const s = normalize(v)
  if (s === '') return undefined
  const n = Number(s)
  return Number.isFinite(n) ? n : undefined
}

/**
 * Accepts an Excel serial number, an ISO string, or a slash-format text date.
 * Slash dates: unambiguous month position wins; ambiguous ones assume mm/dd/yyyy —
 * the league's dates were typed US-style (confirmed against the real workbook).
 */
export function parseDate(v: unknown): string | null {
  if (typeof v === 'number' && Number.isFinite(v) && v > 20000 && v < 80000) {
    return serialToIso(v)
  }
  const s = normalize(v)
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
  const m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/)
  if (m) {
    const a = Number(m[1])
    const b = Number(m[2])
    const year = Number(m[3])
    let day: number, month: number
    if (a > 12 && b <= 12) {
      day = a
      month = b // e.g. "13/08/2026" — must be UK dd/mm
    } else {
      month = a
      day = b // US default (covers unambiguous "08/13/2026" and ambiguous dates)
    }
    if (month < 1 || month > 12 || day < 1 || day > 31) return null
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  }
  return null
}

type Row = unknown[]

function sheetRows(wb: XLSX.WorkBook, name: string): Row[] {
  const ws = wb.Sheets[name]
  if (!ws) return []
  return XLSX.utils.sheet_to_json<Row>(ws, { header: 1, raw: true, defval: null })
}

/** Rows that hold data: first cell is a date and not a title/info/header line. */
function isDataRow(row: Row): boolean {
  const first = row[0]
  if (first == null) return false
  const s = normalize(first)
  if (s === '' || s.startsWith('ℹ')) return false
  return parseDate(first) !== null
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const prettyDate = (iso: string): string => {
  const [y, m, d] = iso.split('-').map(Number)
  return `${d} ${MONTHS[m - 1]} ${y}`
}

export function importWorkbook(
  buffer: ArrayBuffer | Uint8Array,
  opts: { today?: string } = {}
): ImportResult {
  const wb = XLSX.read(buffer, { type: 'array' })
  const notes: string[] = []
  const today = opts.today ?? new Date().toISOString().slice(0, 10)

  // Results can't be from the future — a future date means Excel read a US-typed
  // date as dd/mm and stored the wrong serial. Swap day/month back when that lands
  // in the past; either way flag the row for confirmation in the import report.
  const fixFutureDates = <T extends { date: string; seq: number }>(list: T[], sheet: string): void => {
    for (const e of list) {
      if (e.date <= today) continue
      const [y, mo, dy] = e.date.split('-')
      const swapped = Number(dy) <= 12 ? `${y}-${dy}-${mo}` : null
      if (swapped && swapped <= today) {
        notes.push(
          `${sheet} row ${e.seq}: date read as ${prettyDate(e.date)} — that's in the future, so it was corrected to ${prettyDate(swapped)} (US-style day/month mix-up). Please confirm.`
        )
        e.date = swapped
      } else {
        notes.push(`${sheet} row ${e.seq}: date ${prettyDate(e.date)} is in the future — please check it.`)
      }
    }
  }

  const playerIds = new Map<string, string>() // lower-cased name -> id
  const players: Player[] = []
  const idFor = (rawName: unknown): string => {
    const name = normalize(rawName)
    const key = name.toLowerCase()
    let id = playerIds.get(key)
    if (!id) {
      id = `p-${key.replace(/[^a-z0-9]+/g, '-')}`
      playerIds.set(key, id)
      players.push({ id, name })
    }
    return id
  }

  const matches: MatchGame[] = []
  for (const [i, row] of sheetRows(wb, 'Match Log').entries()) {
    if (!isDataRow(row)) continue
    const date = parseDate(row[0])!
    const result = parseResult(row[3])
    if (!result || !normalize(row[1]) || !normalize(row[2])) {
      notes.push(`Match Log row ${i + 1} skipped (missing player or result)`)
      continue
    }
    matches.push({
      id: `m-${i + 1}`,
      date,
      p1: idFor(row[1]),
      p2: idFor(row[2]),
      result,
      bp1: parseNum(row[4]),
      bp2: parseNum(row[5]),
      faction1: normalize(row[6]) || undefined,
      faction2: normalize(row[7]) || undefined,
      notes: normalize(row[8]) || undefined,
      seq: i + 1
    })
  }

  const tournamentEntries: TournamentEntry[] = []
  for (const [i, row] of sheetRows(wb, 'Tournament Log').entries()) {
    if (!isDataRow(row)) continue
    const date = parseDate(row[0])!
    const rounds = parseNum(row[3])
    const sos = parseNum(row[8])
    if (!normalize(row[2]) || !rounds || sos == null) {
      notes.push(`Tournament Log row ${i + 1} skipped (missing player, rounds or SoS)`)
      continue
    }
    tournamentEntries.push({
      id: `t-${i + 1}`,
      date,
      tournament: normalize(row[1]) || 'Tournament',
      player: idFor(row[2]),
      rounds,
      wins: parseNum(row[4]) ?? 0,
      draws: parseNum(row[5]) ?? 0,
      losses: parseNum(row[6]) ?? 0,
      vp: parseNum(row[7]),
      sos,
      faction: normalize(row[11]) || undefined,
      notes: normalize(row[12]) || undefined,
      seq: i + 1
    })
  }

  const guestGames: GuestGame[] = []
  for (const [i, row] of sheetRows(wb, 'Guest Log').entries()) {
    const first = row[0]
    if (first == null || normalize(first).startsWith('ℹ')) continue
    const date = parseDate(first)
    const result = parseResult(row[2])
    if (normalize(row[1]) && result && date === null) {
      notes.push(`Guest Log row ${i + 1}: unreadable date "${normalize(first)}" — row skipped`)
      continue
    }
    if (!date || !result || !normalize(row[1])) continue
    if (typeof first === 'string') {
      notes.push(
        `Guest Log row ${i + 1}: date was stored as text "${normalize(first)}" — parsed as ${date} (this row previously broke the spreadsheet)`
      )
    }
    guestGames.push({
      id: `g-${i + 1}`,
      date,
      player: idFor(row[1]),
      result,
      playerBP: parseNum(row[3]),
      oppBP: parseNum(row[4]),
      playerFaction: normalize(row[5]) || undefined,
      oppFaction: normalize(row[6]) || undefined,
      guestName: normalize(row[7]) || 'Guest',
      guestElo: parseNum(row[8]),
      notes: normalize(row[9]) || undefined,
      seq: i + 1
    })
  }

  fixFutureDates(matches, 'Match Log')
  fixFutureDates(tournamentEntries, 'Tournament Log')
  fixFutureDates(guestGames, 'Guest Log')

  const season: Season = {
    id: 'season-1',
    name: 'Season 1',
    players,
    matches,
    tournamentEntries,
    guestGames
  }

  // ---- Reconciliation vs the workbook's own (cached) League Table ----
  const diffs: ImportDiff[] = []
  const computed = computeSeason(season)
  const oldRows = sheetRows(wb, 'Player Data')
  for (const row of oldRows) {
    const name = normalize(row[0])
    if (!name || name === 'Name') continue
    const got = computed.table.find((p) => p.name.toLowerCase() === name.toLowerCase())
    if (!got) {
      diffs.push({ name, field: 'player', old: 'present', new: 'missing' })
      continue
    }
    const fields: [string, number | undefined, number][] = [
      ['ELO', parseNum(row[1]), got.elo],
      ['Peak ELO', parseNum(row[2]), got.peakElo],
      ['Games', parseNum(row[3]), got.games],
      ['Wins', parseNum(row[4]), got.wins],
      ['Draws', parseNum(row[5]), got.draws],
      ['Losses', parseNum(row[6]), got.losses],
      ['BP', parseNum(row[7]), got.bp]
    ]
    for (const [field, oldV, newV] of fields) {
      if (oldV != null && oldV !== newV) {
        diffs.push({ name: got.name, field, old: oldV, new: newV })
      }
    }
  }

  return {
    season,
    report: {
      importedAt: new Date().toISOString(),
      matches: matches.length,
      tournamentEntries: tournamentEntries.length,
      guestGames: guestGames.length,
      players: players.length,
      diffs,
      notes
    }
  }
}
