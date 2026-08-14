import { useMemo, useState } from 'react'
import type { TimelineEvent } from '@shared/types'
import { useApp } from '../App'
import { fmtDate, updateSeason } from '../lib'
import { EventEditor, type EditTarget } from './AddResultScreen'

export default function HistoryScreen(): JSX.Element {
  const { season, comp, mutate, toast, canUndo, undo } = useApp()
  const [filterPlayer, setFilterPlayer] = useState('')
  const [filterType, setFilterType] = useState('')
  const [editing, setEditing] = useState<EditTarget | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<TimelineEvent | null>(null)

  const rows = useMemo(() => {
    const list = [...comp.timeline].reverse() // newest first
    return list.filter(
      (e) =>
        (!filterPlayer || e.playerId === filterPlayer || e.opponentId === filterPlayer) &&
        (!filterType || e.type === filterType)
    )
  }, [comp.timeline, filterPlayer, filterType])

  const deleteEvent = (e: TimelineEvent): void => {
    mutate((d) =>
      updateSeason(d, season.id, (s) => {
        if (e.type === 'Match') return { ...s, matches: s.matches.filter((m) => m.id !== e.sourceId) }
        if (e.type === 'Tournament')
          return { ...s, tournamentEntries: s.tournamentEntries.filter((t) => t.id !== e.sourceId) }
        return { ...s, guestGames: s.guestGames.filter((g) => g.id !== e.sourceId) }
      })
    )
    toast('Result deleted — all ELOs recalculated')
    setConfirmDelete(null)
  }

  return (
    <div>
      <div className="screen-head">
        <h1>History</h1>
        <span className="sub">
          {comp.timeline.length} events · every edit recalculates the whole league
        </span>
        <span className="spacer" />
        {canUndo && (
          <button className="btn small" onClick={undo}>
            Undo last change
          </button>
        )}
        <select value={filterPlayer} onChange={(e) => setFilterPlayer(e.target.value)}>
          <option value="">All players</option>
          {[...season.players]
            .sort((a, b) => a.name.localeCompare(b.name))
            .map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
        </select>
        <select value={filterType} onChange={(e) => setFilterType(e.target.value)}>
          <option value="">All types</option>
          <option>Match</option>
          <option>Tournament</option>
          <option>Guest</option>
        </select>
      </div>

      <div className="card" style={{ padding: '4px 0' }}>
        {rows.map((e) => (
          <div className="history-row" key={`${e.type}-${e.sourceId}`}>
            <span style={{ color: 'var(--ink-3)', fontSize: 12.5 }}>{fmtDate(e.date)}</span>
            <span className={`pill ${e.type.toLowerCase()}`}>{e.type}</span>
            <span>
              <span className="who">{e.playerName}</span>
              {e.result && (
                <span className={`pill ${e.result.toLowerCase()}`} style={{ margin: '0 8px' }}>
                  {e.result}
                </span>
              )}
              {e.type === 'Tournament' && (
                <span className="pill tournament" style={{ margin: '0 8px' }}>
                  {Math.round(e.actual * 100)}% score
                </span>
              )}
              <span style={{ color: 'var(--ink-2)' }}>vs {e.opponentLabel}</span>
              {e.faction && <span style={{ color: 'var(--ink-3)', fontSize: 12 }}> · {e.faction}</span>}
            </span>
            <span className="elo-shift">
              {e.eloBefore} → {e.eloAfter}
            </span>
            <span className={`elo-shift ${e.delta > 0 ? 'delta-pos' : e.delta < 0 ? 'delta-neg' : 'delta-zero'}`}>
              {e.delta > 0 ? '+' : ''}
              {e.delta}
            </span>
            <span style={{ display: 'flex', gap: 6 }}>
              <button className="btn small" onClick={() => setEditing({ type: e.type, id: e.sourceId })}>
                Edit
              </button>
              <button className="btn small danger" onClick={() => setConfirmDelete(e)}>
                Delete
              </button>
            </span>
          </div>
        ))}
        {rows.length === 0 && (
          <div style={{ padding: 20, color: 'var(--ink-3)' }}>No events match the filter.</div>
        )}
      </div>

      {editing && (
        <div className="modal-backdrop" onClick={() => setEditing(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Edit result</h2>
            <EventEditor edit={editing} onDone={() => setEditing(null)} />
            <div style={{ marginTop: 12 }}>
              <button className="btn small" onClick={() => setEditing(null)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmDelete && (
        <div className="modal-backdrop" onClick={() => setConfirmDelete(null)}>
          <div className="modal" style={{ width: 440 }} onClick={(e) => e.stopPropagation()}>
            <h2>Delete this result?</h2>
            <p style={{ color: 'var(--ink-2)', marginBottom: 18 }}>
              {fmtDate(confirmDelete.date)} — {confirmDelete.playerName} vs {confirmDelete.opponentLabel}.
              <br />
              All ELOs will be recalculated as if it never happened.
            </p>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="btn small" onClick={() => setConfirmDelete(null)}>
                Cancel
              </button>
              <button className="btn small primary" onClick={() => deleteEvent(confirmDelete)}>
                Delete result
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
