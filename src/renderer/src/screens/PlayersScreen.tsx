import { useMemo, useState } from 'react'
import { useApp } from '../App'
import { fmtDate, fmtPct, uid, updateSeason } from '../lib'

export default function PlayersScreen(): JSX.Element {
  const { season, comp, mutate, toast } = useApp()
  const [renaming, setRenaming] = useState<string | null>(null)
  const [newName, setNewName] = useState('')
  const [adding, setAdding] = useState(false)
  const [addName, setAddName] = useState('')
  const [detail, setDetail] = useState<string | null>(null)

  const factionsOf = useMemo(() => {
    const map = new Map<string, Set<string>>()
    const add = (pid: string, f?: string): void => {
      if (!f) return
      if (!map.has(pid)) map.set(pid, new Set())
      map.get(pid)!.add(f)
    }
    for (const m of season.matches) {
      add(m.p1, m.faction1)
      add(m.p2, m.faction2)
    }
    for (const t of season.tournamentEntries) add(t.player, t.faction)
    for (const g of season.guestGames) add(g.player, g.playerFaction)
    return map
  }, [season])

  const rename = (pid: string): void => {
    const name = newName.trim()
    if (!name) return
    mutate((d) =>
      updateSeason(d, season.id, (s) => ({
        ...s,
        players: s.players.map((p) => (p.id === pid ? { ...p, name } : p))
      }))
    )
    toast(`Player renamed to ${name} — all history follows automatically`)
    setRenaming(null)
  }

  const addPlayer = (): void => {
    const name = addName.trim()
    if (!name) return
    if (season.players.some((p) => p.name.toLowerCase() === name.toLowerCase())) {
      toast('A player with that name already exists', 'error')
      return
    }
    mutate((d) =>
      updateSeason(d, season.id, (s) => ({ ...s, players: [...s.players, { id: uid('p'), name }] }))
    )
    toast(`${name} joined the league at ELO 1000`)
    setAdding(false)
    setAddName('')
  }

  const detailStats = detail ? comp.table.find((p) => p.playerId === detail) : null
  const detailEvents = detail
    ? comp.timeline
        .filter((e) => e.playerId === detail || e.opponentId === detail)
        .slice(-30)
        .reverse()
    : []

  return (
    <div>
      <div className="screen-head">
        <h1>Players</h1>
        <span className="sub">{season.players.length} registered</span>
        <span className="spacer" />
        <button className="btn primary" onClick={() => setAdding(true)}>
          Add player
        </button>
      </div>

      <div className="player-cards">
        {comp.table.map((p) => (
          <div className="card" key={p.playerId}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {renaming === p.playerId ? (
                <>
                  <input
                    autoFocus
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && rename(p.playerId)}
                    style={{ flex: 1 }}
                  />
                  <button className="btn small" onClick={() => rename(p.playerId)}>
                    Save
                  </button>
                </>
              ) : (
                <>
                  <span className="player-name" style={{ fontSize: 16, flex: 1 }}>
                    {p.rank === 1 ? '♔ ' : ''}
                    {p.name}
                  </span>
                  <span style={{ color: 'var(--ink-3)', fontSize: 12 }}>
                    {p.provisional ? 'provisional' : `#${p.rank}`}
                  </span>
                </>
              )}
            </div>
            <div className="stat-row">
              <div className="stat">
                <span className="v" style={{ color: p.rank === 1 ? 'var(--gold)' : undefined }}>{p.elo}</span>
                <span className="k">ELO</span>
              </div>
              <div className="stat">
                <span className="v">{p.peakElo}</span>
                <span className="k">Peak</span>
              </div>
              <div className="stat">
                <span className="v">
                  {p.wins}–{p.draws}–{p.losses}
                </span>
                <span className="k">W–D–L</span>
              </div>
              <div className="stat">
                <span className="v">{fmtPct(p.winPct)}</span>
                <span className="k">Win rate</span>
              </div>
            </div>
            <div style={{ marginTop: 10, color: 'var(--ink-3)', fontSize: 12, minHeight: 18 }}>
              {[...(factionsOf.get(p.playerId) ?? [])].join(' · ') || 'No faction recorded'}
            </div>
            <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
              <button className="btn small" onClick={() => setDetail(p.playerId)}>
                Details
              </button>
              <button
                className="btn small"
                onClick={() => {
                  setRenaming(p.playerId)
                  setNewName(p.name)
                }}
              >
                Rename
              </button>
            </div>
          </div>
        ))}
      </div>

      {adding && (
        <div className="modal-backdrop" onClick={() => setAdding(false)}>
          <div className="modal" style={{ width: 400 }} onClick={(e) => e.stopPropagation()}>
            <h2>Add a player</h2>
            <div className="field">
              <label>Name</label>
              <input
                autoFocus
                value={addName}
                onChange={(e) => setAddName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addPlayer()}
              />
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
              <button className="btn small" onClick={() => setAdding(false)}>
                Cancel
              </button>
              <button className="btn small primary" onClick={addPlayer}>
                Add player
              </button>
            </div>
          </div>
        </div>
      )}

      {detail && detailStats && (
        <div className="modal-backdrop" onClick={() => setDetail(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>
              {detailStats.name} — {detailStats.elo} ELO (peak {detailStats.peakElo})
            </h2>
            <p className="hint" style={{ marginBottom: 10 }}>
              {detailStats.games} games · {fmtPct(detailStats.winPct)} win rate · {detailStats.bp} BP total ·{' '}
              {detailStats.tournamentsPlayed} tournament{detailStats.tournamentsPlayed === 1 ? '' : 's'}
            </p>
            {detailEvents.map((e) => {
              const mine = e.playerId === detail
              const delta = mine ? e.delta : -e.delta
              const after = mine ? e.eloAfter : e.opponentEloAfter
              const opp = mine ? e.opponentLabel : e.playerName
              const res = mine
                ? e.result ?? (e.type === 'Tournament' ? `${Math.round(e.actual * 100)}%` : '')
                : e.result === 'Win'
                  ? 'Loss'
                  : e.result === 'Loss'
                    ? 'Win'
                    : e.result
              return (
                <div className="history-row" key={`${e.type}-${e.sourceId}`} style={{ gridTemplateColumns: '92px 86px 1fr 96px' }}>
                  <span style={{ color: 'var(--ink-3)', fontSize: 12.5 }}>{fmtDate(e.date)}</span>
                  <span className={`pill ${e.type.toLowerCase()}`}>{e.type}</span>
                  <span>
                    {res && <span className={`pill ${String(res).toLowerCase()}`} style={{ marginRight: 8 }}>{res}</span>}
                    <span style={{ color: 'var(--ink-2)' }}>vs {opp}</span>
                  </span>
                  <span className={`elo-shift ${delta > 0 ? 'delta-pos' : delta < 0 ? 'delta-neg' : 'delta-zero'}`}>
                    {delta > 0 ? '+' : ''}
                    {delta} → {after}
                  </span>
                </div>
              )
            })}
            <div style={{ marginTop: 14, textAlign: 'right' }}>
              <button className="btn small" onClick={() => setDetail(null)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
