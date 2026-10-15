import { Fragment, useMemo, useRef, useState } from 'react'
import { toBlob, toPng } from 'html-to-image'
import { computeSeason, DEFAULT_MIN_RANKED_GAMES } from '@shared/engine'
import type { PlayerStats, Season } from '@shared/types'
import { useApp } from '../App'
import { useIsMobile } from '../hooks'
import { copyPngToClipboard, downloadDataUrl } from '../remote'
import { fmtDate, fmtPct, todayIso } from '../lib'
import ShareCard from '../components/ShareCard'

/** The columns hidden on phones, shown in the row's expandable detail panel instead. */
const DETAIL_STATS: { label: string; value: (p: PlayerStats) => string | number }[] = [
  { label: 'Peak', value: (p) => p.peakElo },
  { label: 'Games', value: (p) => p.games },
  { label: 'W', value: (p) => p.wins },
  { label: 'D', value: (p) => p.draws },
  { label: 'L', value: (p) => p.losses },
  { label: 'Win %', value: (p) => fmtPct(p.winPct) },
  { label: 'BP', value: (p) => p.bp },
  { label: 'Tourneys', value: (p) => p.tournamentsPlayed }
]

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
  const isMobile = useIsMobile()
  // Phone: only Rank / Name / trend / ELO fit, so a tapped row unfolds the rest below it.
  const [expanded, setExpanded] = useState<string | null>(null)
  const toggleRow = (pid: string): void => {
    if (isMobile) setExpanded((cur) => (cur === pid ? null : pid))
  }
  const detailRow = (p: PlayerStats): JSX.Element | null =>
    isMobile && expanded === p.playerId ? (
      <tr className="detail-row" key={`${p.playerId}-detail`}>
        <td colSpan={4}>
          <div className="detail-grid">
            {DETAIL_STATS.map((s) => (
              <div className="stat" key={s.label}>
                <span className="v">{s.value(p)}</span>
                <span className="k">{s.label}</span>
              </div>
            ))}
          </div>
        </td>
      </tr>
    ) : null

  const prevRanks = useMemo(() => {
    const prev = withoutLastEvent(season, comp)
    if (!prev) return new Map<string, number>()
    return new Map(computeSeason(prev).table.map((p) => [p.playerId, p.rank]))
  }, [season, comp])

  const ranked = comp.table.filter((p) => !p.provisional)
  const provisional = comp.table.filter((p) => p.provisional && p.games > 0)
  const unplayed = comp.table.filter((p) => p.games === 0)
  const minGames = season.minRankedGames ?? DEFAULT_MIN_RANKED_GAMES

  const renderPng = async (): Promise<string | null> => {
    if (!cardRef.current) return null
    setExporting(true)
    try {
      return await toPng(cardRef.current, { pixelRatio: 2, cacheBust: true })
    } finally {
      setExporting(false)
    }
  }

  const pngName = (): string => `${data.settings.leagueName.replace(/\s+/g, '-')}-${todayIso()}.png`

  const savePng = async (): Promise<void> => {
    const url = await renderPng()
    if (!url) return
    downloadDataUrl(url, pngName())
    toast('Image downloaded — check your Downloads folder')
  }

  /** Kicked off synchronously from the click so the clipboard keeps its user-gesture window. */
  const copyPng = (): void => {
    const node = cardRef.current
    if (!node) return
    setExporting(true)
    const render = (): Promise<Blob> =>
      toBlob(node, { pixelRatio: 2, cacheBust: true }).then((b) => {
        if (!b) throw new Error('Could not render the image')
        return b
      })
    copyPngToClipboard(render)
      .then(async (ok) => {
        if (ok) {
          toast('League table image copied to clipboard — paste it straight into WhatsApp')
        } else {
          // Clipboard unavailable (e.g. Firefox settings) — download instead.
          const url = await renderPng()
          if (url) {
            downloadDataUrl(url, pngName())
            toast('Copying isn’t supported in this browser — the image was downloaded instead')
          }
        }
      })
      .finally(() => setExporting(false))
  }

  return (
    <div>
      <div className="screen-head">
        <h1>League Table</h1>
        <span className="sub">
          {season.name} · updated {comp.timeline.length ? fmtDate(comp.timeline[comp.timeline.length - 1].date) : '—'}
        </span>
        <span className="spacer" />
        <div className="head-actions">
          <button className="btn" onClick={copyPng} disabled={exporting}>
            Copy image
          </button>
          <button className="btn gold" onClick={savePng} disabled={exporting}>
            {exporting ? 'Rendering…' : 'Share as image'}
          </button>
        </div>
      </div>

      <div className="card" style={{ padding: '6px 4px' }}>
        <table className="league">
          <thead>
            <tr>
              <th className="col-rank">Rank</th>
              <th>Name</th>
              <th className="col-move"></th>
              <th>ELO</th>
              <th className="col-more">Peak</th>
              <th className="col-more">Games</th>
              <th className="col-more">W</th>
              <th className="col-more">D</th>
              <th className="col-more">L</th>
              <th className="col-more">Win %</th>
              <th className="col-more">BP</th>
              <th className="col-more">Tourneys</th>
            </tr>
          </thead>
          <tbody>
            {ranked.map((p) => {
              const prev = prevRanks.get(p.playerId)
              // No arrow for players who were provisional (rank 0) before this event.
              const move = !prev ? 0 : prev - p.rank
              return (
                <Fragment key={p.playerId}>
                  <tr
                    className={`${isMobile ? 'tappable' : ''} ${expanded === p.playerId ? 'open' : ''}`}
                    onClick={() => toggleRow(p.playerId)}
                    aria-expanded={isMobile ? expanded === p.playerId : undefined}
                  >
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
                    <td className="col-more">{p.peakElo}</td>
                    <td className="col-more">{p.games}</td>
                    <td className="col-more">{p.wins}</td>
                    <td className="col-more">{p.draws}</td>
                    <td className="col-more">{p.losses}</td>
                    <td className="col-more">{fmtPct(p.winPct)}</td>
                    <td className="col-more">{p.bp}</td>
                    <td className="col-more">{p.tournamentsPlayed}</td>
                  </tr>
                  {detailRow(p)}
                </Fragment>
              )
            })}
            {provisional.map((p, i) => (
              <Fragment key={p.playerId}>
                <tr
                  className={`${i === 0 ? 'provisional-start' : ''} ${isMobile ? 'tappable' : ''} ${expanded === p.playerId ? 'open' : ''}`}
                  style={{ opacity: 0.62 }}
                  onClick={() => toggleRow(p.playerId)}
                  aria-expanded={isMobile ? expanded === p.playerId : undefined}
                >
                  <td>
                    <span className="rank-cell" style={{ fontSize: 11, letterSpacing: '0.04em' }}>PROV</span>
                  </td>
                  <td className="player-name">{p.name}</td>
                  <td />
                  <td className="elo-cell">{p.elo}</td>
                  <td className="col-more">{p.peakElo}</td>
                  <td className="col-more">{p.games}</td>
                  <td className="col-more">{p.wins}</td>
                  <td className="col-more">{p.draws}</td>
                  <td className="col-more">{p.losses}</td>
                  <td className="col-more">{fmtPct(p.winPct)}</td>
                  <td className="col-more">{p.bp}</td>
                  <td className="col-more">{p.tournamentsPlayed}</td>
                </tr>
                {detailRow(p)}
              </Fragment>
            ))}
          </tbody>
        </table>
        {provisional.length > 0 && (
          <div style={{ padding: '10px 14px 0', color: 'var(--ink-3)', fontSize: 12.5 }}>
            Provisional: ranked after {minGames} games — ELO already counts.
          </div>
        )}
        {isMobile && (
          <div style={{ padding: '10px 14px 0', color: 'var(--ink-3)', fontSize: 12.5 }}>
            Tap a player for peak, games, W/D/L, win %, BP and tournaments.
          </div>
        )}
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
        <ShareCard
          ref={cardRef}
          leagueName={data.settings.leagueName}
          seasonName={season.name}
          table={ranked}
          provisional={provisional}
          minGames={minGames}
        />
      </div>
    </div>
  )
}
