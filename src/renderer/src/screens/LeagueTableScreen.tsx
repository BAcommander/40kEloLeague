import { useMemo, useRef, useState } from 'react'
import { toPng } from 'html-to-image'
import { computeSeason } from '@shared/engine'
import type { Season } from '@shared/types'
import { useApp } from '../App'
import { api } from '../api'
import { fmtDate, fmtPct, todayIso } from '../lib'
import ShareCard from '../components/ShareCard'

/** Season with the most recent event removed — used for rank-movement arrows. */
function withoutLastEvent(season: Season, comp: ReturnType<typeof computeSeason>): Season | null {
  const last = comp.timeline[comp.timeline.length - 1]
  if (!last) return null
  if (last.type === 'Match') {
    return { ...season, matches: season.matches.filter((m) => m.id !== last.sourceId) }
  }
  if (last.type === 'Tournament') {
    return {
      ...season,
      tournamentEntries: season.tournamentEntries.filter((t) => t.id !== last.sourceId)
    }
  }
  return { ...season, guestGames: season.guestGames.filter((g) => g.id !== last.sourceId) }
}

export default function LeagueTableScreen(): JSX.Element {
  const { data, season, comp, toast } = useApp()
  const cardRef = useRef<HTMLDivElement>(null)
  const [exporting, setExporting] = useState(false)

  const prevRanks = useMemo(() => {
    const prev = withoutLastEvent(season, comp)
    if (!prev) return new Map<string, number>()
    return new Map(computeSeason(prev).table.map((p) => [p.playerId, p.rank]))
  }, [season, comp])

  const played = comp.table.filter((p) => p.games > 0)
  const unplayed = comp.table.filter((p) => p.games === 0)

  const renderPng = async (): Promise<string | null> => {
    if (!cardRef.current) return null
    setExporting(true)
    try {
      return await toPng(cardRef.current, { pixelRatio: 2, cacheBust: true })
    } finally {
      setExporting(false)
    }
  }

  const savePng = async (): Promise<void> => {
    const url = await renderPng()
    if (!url) return
    const path = await api.savePng(url, `${data.settings.leagueName.replace(/\s+/g, '-')}-${todayIso()}.png`)
    if (path) toast(`Image saved:\n${path}`)
  }

  const copyPng = async (): Promise<void> => {
    const url = await renderPng()
    if (!url) return
    await api.copyPng(url)
    toast('League table image copied to clipboard — paste it straight into WhatsApp')
  }

  return (
    <div>
      <div className="screen-head">
        <h1>League Table</h1>
        <span className="sub">
          {season.name} · updated {comp.timeline.length ? fmtDate(comp.timeline[comp.timeline.length - 1].date) : '—'}
        </span>
        <span className="spacer" />
        <button className="btn" onClick={copyPng} disabled={exporting}>
          Copy image
        </button>
        <button className="btn gold" onClick={savePng} disabled={exporting}>
          {exporting ? 'Rendering…' : 'Share as image'}
        </button>
      </div>

      <div className="card" style={{ padding: '6px 4px' }}>
        <table className="league">
          <thead>
            <tr>
              <th style={{ width: 70 }}>Rank</th>
              <th>Name</th>
              <th style={{ width: 60 }}></th>
              <th>ELO</th>
              <th>Peak</th>
              <th>Games</th>
              <th>W</th>
              <th>D</th>
              <th>L</th>
              <th>Win %</th>
              <th>BP</th>
              <th>Tourneys</th>
            </tr>
          </thead>
          <tbody>
            {played.map((p) => {
              const prev = prevRanks.get(p.playerId)
              const move = prev === undefined ? 0 : prev - p.rank
              return (
                <tr key={p.playerId}>
                  <td>
                    <span className={`rank-cell ${p.rank === 1 ? 'rank-1' : ''}`}>
                      {p.rank === 1 ? '♔' : ''} {p.rank}
                    </span>
                  </td>
                  <td className="player-name">{p.name}</td>
                  <td>
                    {move > 0 && <span className="movement up">▲{move}</span>}
                    {move < 0 && <span className="movement down">▼{-move}</span>}
                    {move === 0 && <span className="movement same">—</span>}
                  </td>
                  <td className={`elo-cell ${p.rank === 1 ? 'rank-1' : ''}`}>{p.elo}</td>
                  <td>{p.peakElo}</td>
                  <td>{p.games}</td>
                  <td>{p.wins}</td>
                  <td>{p.draws}</td>
                  <td>{p.losses}</td>
                  <td>{fmtPct(p.winPct)}</td>
                  <td>{p.bp}</td>
                  <td>{p.tournamentsPlayed}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {unplayed.length > 0 && (
          <div style={{ padding: '10px 14px', color: 'var(--ink-3)', fontSize: 12.5 }}>
            Yet to play: {unplayed.map((p) => p.name).join(', ')}
          </div>
        )}
      </div>

      {/* Share card: rendered off-screen for PNG export (on-screen in the ?sharecard=1 dev harness) */}
      <div
        style={
          new URLSearchParams(location.search).has('sharecard')
            ? { marginTop: 20, transform: 'scale(0.9)', transformOrigin: 'top left' }
            : { position: 'fixed', left: -3000, top: 0 }
        }
      >
        <ShareCard ref={cardRef} leagueName={data.settings.leagueName} seasonName={season.name} table={played} />
      </div>
    </div>
  )
}
