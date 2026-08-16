export { activeSeason, nextSeq, updateSeason } from '@shared/data'

export function uid(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
}

export function todayIso(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function fmtDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return `${d} ${months[m - 1]} ${y}`
}

export function fmtPct(x: number): string {
  return `${Math.round(x * 100)}%`
}

/** Validated dataviz dark categorical slots — chart series only, never chrome. */
export const SERIES = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767']

export const WDL = { win: '#2b9c48', draw: '#6b6660', loss: '#e66767' }

/** The five 11th-edition force dispositions each player picks from (free text also allowed). */
export const DISPOSITIONS = [
  'Take and Hold',
  'Purge the Foe',
  'Disruption',
  'Reconnaissance',
  'Priority Assets'
]

/** All known 10th-edition faction names for the faction dropdown (free text also allowed). */
export const FACTIONS = [
  'Ad Mech', 'Adepta Sororitas', 'Adeptus Custodes', 'Aeldari', 'Astra Militarum', 'Black Templars',
  'Blood Angels', 'Chaos Daemons', 'Chaos Knights', 'Chaos Space Marines', 'Dark Angels', 'Death Guard',
  'Deathwatch', 'Drukhari', 'Emperors Children', 'Grey Knights', 'GSC', 'Guard', 'Imperial Agents',
  'Imperial Knights', 'Leagues of Votann', 'Necrons', 'Orks', 'Salamanders', 'Space Marines',
  'Space Wolves', "T'au Empire", 'Thousand Sons', 'Tyranids', 'Ultramarines', 'Votaan', 'White Scars',
  'World Eaters'
]
