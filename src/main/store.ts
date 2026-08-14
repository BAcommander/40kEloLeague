import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, unlinkSync, copyFileSync, renameSync } from 'fs'
import { join } from 'path'
import type { LeagueData } from '../shared/types'
import seed from './seed.json'

const MAX_BACKUPS = 20

const dataDir = (): string => app.getPath('userData')
const dataFile = (): string => join(dataDir(), 'league-data.json')
const backupDir = (): string => join(dataDir(), 'backups')

export function loadData(): LeagueData {
  const file = dataFile()
  if (!existsSync(file)) {
    // First run: start from the data imported from the original spreadsheet.
    saveData(seed as unknown as LeagueData)
    return seed as unknown as LeagueData
  }
  try {
    return JSON.parse(readFileSync(file, 'utf-8')) as LeagueData
  } catch (err) {
    // Corrupt file: fall back to the most recent backup rather than losing the league.
    const backups = listBackups()
    for (const b of backups) {
      try {
        const data = JSON.parse(readFileSync(join(backupDir(), b), 'utf-8')) as LeagueData
        copyFileSync(join(backupDir(), b), file + '.corrupt-replaced')
        return data
      } catch {
        continue
      }
    }
    throw err
  }
}

function listBackups(): string[] {
  if (!existsSync(backupDir())) return []
  return readdirSync(backupDir())
    .filter((f) => f.startsWith('league-data-') && f.endsWith('.json'))
    .sort()
    .reverse() // newest first (timestamped names)
}

export function saveData(data: LeagueData): void {
  mkdirSync(dataDir(), { recursive: true })
  const file = dataFile()
  // Back up the previous version before overwriting.
  if (existsSync(file)) {
    mkdirSync(backupDir(), { recursive: true })
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    copyFileSync(file, join(backupDir(), `league-data-${stamp}.json`))
    const backups = listBackups()
    for (const old of backups.slice(MAX_BACKUPS)) {
      unlinkSync(join(backupDir(), old))
    }
  }
  const tmp = file + '.tmp'
  writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8')
  // Atomic replace so a crash mid-write can't corrupt the data file.
  renameSync(tmp, file)
}

export function dataFilePath(): string {
  return dataFile()
}
