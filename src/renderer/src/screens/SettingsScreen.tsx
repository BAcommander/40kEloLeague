import { useState } from 'react'
import type { ImportReport, LeagueData, Season } from '@shared/types'
import { computeSeason, DEFAULT_START_ELO, excelRound } from '@shared/engine'
import { useApp } from '../App'
import { api } from '../api'
import { fmtDate, uid, updateSeason } from '../lib'

function ReportView({ report }: { report: ImportReport }): JSX.Element {
  return (
    <div>
      <p className="hint">
        Imported {report.matches} matches, {report.tournamentEntries} tournament entries, {report.guestGames} guest
        games, {report.players} players ({fmtDate(report.importedAt.slice(0, 10))}).
      </p>
      {report.notes.length > 0 && (
        <ul style={{ margin: '8px 0 12px 18px', color: 'var(--ink-2)', fontSize: 13 }}>
          {report.notes.map((n, i) => (
            <li key={i}>{n}</li>
          ))}
        </ul>
      )}
      {report.diffs.length > 0 ? (
        <>
          <p style={{ fontSize: 13, color: 'var(--ink-2)', margin: '8px 0' }}>
            These numbers differ from the old spreadsheet because the import fixes its data-entry bugs (a text date
            that excluded a guest game, and trailing spaces that split one player into two):
          </p>
          <table className="diffs">
            <thead>
              <tr>
                <th>Player</th>
                <th>Field</th>
                <th>Spreadsheet</th>
                <th>Corrected</th>
              </tr>
            </thead>
            <tbody>
              {report.diffs.map((d, i) => (
                <tr key={i}>
                  <td>{d.name}</td>
                  <td>{d.field}</td>
                  <td>{d.old}</td>
                  <td style={{ color: 'var(--gold)' }}>{d.new}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : (
        <p className="hint">No differences vs the spreadsheet's table.</p>
      )}
    </div>
  )
}

export default function SettingsScreen(): JSX.Element {
  const { data, season, comp, mutate, replaceData, toast } = useApp()
  const [leagueName, setLeagueName] = useState(data.settings.leagueName)
  const [showReport, setShowReport] = useState(false)
  const [newSeasonOpen, setNewSeasonOpen] = useState(false)
  const [nsName, setNsName] = useState(`Season ${data.seasons.length + 1}`)
  const [nsMode, setNsMode] = useState<'fresh' | 'carry'>('fresh')
  const [nsCarryPct, setNsCarryPct] = useState('50')
  const [pendingImport, setPendingImport] = useState<{ season: Season; report: ImportReport } | null>(null)

  const saveLeagueName = (): void => {
    mutate((d) => ({ ...d, settings: { ...d.settings, leagueName: leagueName.trim() || 'PKH League' } }))
    toast('League name updated')
  }

  const [minRanked, setMinRanked] = useState(String(season.minRankedGames ?? 2))
  const saveMinRanked = (): void => {
    const n = Math.max(1, Math.round(Number(minRanked) || 2))
    mutate((d) => updateSeason(d, season.id, (s) => ({ ...s, minRankedGames: n })))
    setMinRanked(String(n))
    toast(`Players now need ${n} game${n === 1 ? '' : 's'} to appear in the rankings`)
  }

  const exportJson = async (): Promise<void> => {
    const path = await api.exportFile(data)
    if (path) toast(`Backup exported:\n${path}`)
  }

  const importJson = async (): Promise<void> => {
    try {
      const imported = await api.importFile()
      if (imported) {
        replaceData(imported)
        toast('League data restored from backup')
      }
    } catch (e) {
      toast(`Import failed: ${(e as Error).message}`, 'error')
    }
  }

  const importExcel = async (): Promise<void> => {
    try {
      const result = await api.importXlsx()
      if (result) setPendingImport(result)
    } catch (e) {
      toast(`Excel import failed: ${(e as Error).message}`, 'error')
    }
  }

  const applyExcelImport = (): void => {
    if (!pendingImport) return
    const next: LeagueData = {
      version: 1,
      settings: data.settings,
      activeSeasonId: pendingImport.season.id,
      seasons: [pendingImport.season],
      importReport: pendingImport.report
    }
    replaceData(next)
    toast('Excel data imported — league rebuilt from the workbook')
    setPendingImport(null)
  }

  const revealFile = (): void => {
    void api.revealDataFile()
  }

  const createSeason = (): void => {
    const id = uid('season')
    const startingElos: Record<string, number> = {}
    if (nsMode === 'carry') {
      const pct = Math.max(0, Math.min(100, Number(nsCarryPct) || 0)) / 100
      for (const p of comp.table) {
        startingElos[p.playerId] = excelRound(DEFAULT_START_ELO + (p.elo - DEFAULT_START_ELO) * pct, 0)
      }
    }
    const next: Season = {
      id,
      name: nsName.trim() || `Season ${data.seasons.length + 1}`,
      players: season.players.map((p) => ({ ...p })),
      startingElos: nsMode === 'carry' ? startingElos : undefined,
      minRankedGames: season.minRankedGames,
      matches: [],
      tournamentEntries: [],
      guestGames: []
    }
    mutate((d) => ({
      ...d,
      seasons: [...d.seasons.map((s) => (s.id === d.activeSeasonId ? { ...s, archived: true } : s)), next],
      activeSeasonId: id
    }))
    toast(`${next.name} started${nsMode === 'carry' ? ` — ELOs carried over at ${nsCarryPct}%` : ' — everyone back to 1000'}`)
    setNewSeasonOpen(false)
  }

  const switchSeason = (id: string): void => {
    mutate((d) => ({ ...d, activeSeasonId: id }))
  }

  return (
    <div>
      <div className="screen-head">
        <h1>Settings</h1>
      </div>

      <div className="settings-list">
        <div className="card">
          <h2>League</h2>
          <div className="setting-item" style={{ marginTop: 10 }}>
            <div className="grow">
              <div className="name">League name</div>
              <div className="desc">Shown on the shareable league-table image.</div>
            </div>
            <input value={leagueName} onChange={(e) => setLeagueName(e.target.value)} style={{ width: 240 }} />
            <button className="btn small" onClick={saveLeagueName}>
              Save
            </button>
          </div>
          <div className="setting-item" style={{ marginTop: 12 }}>
            <div className="grow">
              <div className="name">Minimum games to be ranked</div>
              <div className="desc">
                Players with fewer games show as provisional below the table — a single win can't claim mid-table.
                Applies to {season.name}.
              </div>
            </div>
            <input
              type="number"
              min={1}
              value={minRanked}
              onChange={(e) => setMinRanked(e.target.value)}
              style={{ width: 80 }}
            />
            <button className="btn small" onClick={saveMinRanked}>
              Save
            </button>
          </div>
        </div>

        <div className="card">
          <h2>Seasons</h2>
          <p className="hint">
            Start a new season for the next edition — the old one stays archived and viewable.
          </p>
          {data.seasons.map((s) => (
            <div className="setting-item" key={s.id} style={{ marginBottom: 8 }}>
              <div className="grow">
                <div className="name">
                  {s.name}
                  {s.id === data.activeSeasonId && (
                    <span className="pill tournament" style={{ marginLeft: 8 }}>
                      active
                    </span>
                  )}
                  {s.archived && s.id !== data.activeSeasonId && (
                    <span className="pill draw" style={{ marginLeft: 8 }}>
                      archived
                    </span>
                  )}
                </div>
                <div className="desc">
                  {s.players.length} players · {s.matches.length} matches · {s.tournamentEntries.length} tournament
                  entries · {s.guestGames.length} guest games
                </div>
              </div>
              {s.id !== data.activeSeasonId && (
                <button className="btn small" onClick={() => switchSeason(s.id)}>
                  View / make active
                </button>
              )}
            </div>
          ))}
          <button className="btn primary" style={{ marginTop: 6 }} onClick={() => setNewSeasonOpen(true)}>
            Start new season
          </button>
        </div>

        <div className="card">
          <h2>Data</h2>
          <div className="setting-item" style={{ marginTop: 10 }}>
            <div className="grow">
              <div className="name">Backup & restore</div>
              <div className="desc">
                The league saves automatically after every change, with the last 20 versions kept as backups. Export a
                file to move to another PC or share with someone.
              </div>
            </div>
            <button className="btn small" onClick={exportJson}>
              Export backup
            </button>
            <button className="btn small" onClick={importJson}>
              Restore backup
            </button>
          </div>
          <div className="setting-item" style={{ marginTop: 12 }}>
            <div className="grow">
              <div className="name">Data file</div>
              <div className="desc">Where everything lives on this PC.</div>
            </div>
            <button className="btn small" onClick={revealFile}>
              Show in folder
            </button>
          </div>
          <div className="setting-item" style={{ marginTop: 12 }}>
            <div className="grow">
              <div className="name">Import from Excel</div>
              <div className="desc">
                Re-import a W40K_ELO_League workbook. Replaces the current league after showing what changes.
              </div>
            </div>
            <button className="btn small" onClick={importExcel}>
              Import .xlsx
            </button>
          </div>
          {data.importReport && (
            <div className="setting-item" style={{ marginTop: 12 }}>
              <div className="grow">
                <div className="name">Original import report</div>
                <div className="desc">What changed vs the old spreadsheet when this league was first imported.</div>
              </div>
              <button className="btn small" onClick={() => setShowReport(true)}>
                View report
              </button>
            </div>
          )}
        </div>

        <div className="card">
          <h2>ELO rules</h2>
          <p className="hint" style={{ marginBottom: 0 }}>
            Matches: K=32, zero-sum. Tournaments: phantom opponent at 800 + SoS×400, K = min(32×rounds, 96). Guest
            games: K=32, one-sided, guest defaults to 1000. New players start at 1000. These replicate the original
            spreadsheet exactly.
          </p>
        </div>
      </div>

      {showReport && data.importReport && (
        <div className="modal-backdrop" onClick={() => setShowReport(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Import reconciliation</h2>
            <ReportView report={data.importReport} />
            <div style={{ marginTop: 14, textAlign: 'right' }}>
              <button className="btn small" onClick={() => setShowReport(false)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {pendingImport && (
        <div className="modal-backdrop" onClick={() => setPendingImport(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Confirm Excel import</h2>
            <ReportView report={pendingImport.report} />
            <p style={{ color: 'var(--crimson-bright)', fontSize: 13, marginTop: 10 }}>
              This replaces the current league data (a backup of the current state is kept automatically).
            </p>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 14 }}>
              <button className="btn small" onClick={() => setPendingImport(null)}>
                Cancel
              </button>
              <button className="btn small primary" onClick={applyExcelImport}>
                Import and replace
              </button>
            </div>
          </div>
        </div>
      )}

      {newSeasonOpen && (
        <div className="modal-backdrop" onClick={() => setNewSeasonOpen(false)}>
          <div className="modal" style={{ width: 480 }} onClick={(e) => e.stopPropagation()}>
            <h2>Start a new season</h2>
            <div className="field" style={{ marginBottom: 14 }}>
              <label>Season name</label>
              <input value={nsName} onChange={(e) => setNsName(e.target.value)} />
            </div>
            <div className="field" style={{ marginBottom: 14 }}>
              <label>Starting ELOs</label>
              <div className="seg">
                <button className={nsMode === 'fresh' ? 'on' : ''} onClick={() => setNsMode('fresh')}>
                  Everyone starts at 1000
                </button>
                <button className={nsMode === 'carry' ? 'on' : ''} onClick={() => setNsMode('carry')}>
                  Carry over
                </button>
              </div>
            </div>
            {nsMode === 'carry' && (
              <div className="field" style={{ marginBottom: 14 }}>
                <label>Carry-over strength (%)</label>
                <input type="number" value={nsCarryPct} onChange={(e) => setNsCarryPct(e.target.value)} />
                <span className="desc" style={{ color: 'var(--ink-3)', fontSize: 12 }}>
                  e.g. 50% — a player finishing on 1072 starts the new season at 1036.
                </span>
              </div>
            )}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="btn small" onClick={() => setNewSeasonOpen(false)}>
                Cancel
              </button>
              <button className="btn small primary" onClick={createSeason}>
                Start season
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
