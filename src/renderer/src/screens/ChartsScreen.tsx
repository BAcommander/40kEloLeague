import { useMemo, useRef, useState } from 'react'
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  LabelList,
  Cell
} from 'recharts'
import { toPng } from 'html-to-image'
import { useApp } from '../App'
import { downloadDataUrl } from '../remote'
import { fmtDate, SERIES, WDL } from '../lib'

const SURFACE = '#201b16'
const GRID = '#35302a'
const INK2 = '#b8ad98'
const INK3 = '#8a8071'

const tooltipStyle = {
  background: '#2a231c',
  border: '1px solid rgba(255,255,255,0.16)',
  borderRadius: 8,
  fontSize: 12.5,
  color: '#f2ead8'
} as const

function ChartCard(props: {
  title: string
  hint: string
  children: React.ReactNode
  exportName: string
}): JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const { toast } = useApp()
  const exportPng = async (): Promise<void> => {
    if (!ref.current) return
    const url = await toPng(ref.current, { pixelRatio: 2, backgroundColor: SURFACE })
    downloadDataUrl(url, `${props.exportName}.png`)
    toast('Chart downloaded')
  }
  return (
    <div className="card" ref={ref}>
      <div style={{ display: 'flex', alignItems: 'baseline' }}>
        <div style={{ flex: 1 }}>
          <h2>{props.title}</h2>
          <p className="hint">{props.hint}</p>
        </div>
        <button className="btn small" onClick={exportPng}>
          Export PNG
        </button>
      </div>
      {props.children}
    </div>
  )
}

/** Diverging fill for head-to-head cells: blue = row player ahead, red = behind, gray = even. */
function h2hColor(winShare: number, games: number): string {
  if (games === 0) return 'transparent'
  if (winShare >= 0.8) return '#1c5cab'
  if (winShare > 0.5) return '#2e5075'
  if (winShare === 0.5) return '#383835'
  if (winShare > 0.2) return '#6e3a38'
  return '#8a3535'
}

export default function ChartsScreen(): JSX.Element {
  const { season, comp, toast } = useApp()

  const activePlayers = useMemo(
    () => comp.table.filter((p) => p.games > 0),
    [comp.table]
  )

  // ---- ELO over time: stable color-slot assignment per player ----
  const [slots, setSlots] = useState<Map<string, number>>(() => {
    const m = new Map<string, number>()
    activePlayers.slice(0, 4).forEach((p, i) => m.set(p.playerId, i))
    return m
  })

  const togglePlayer = (pid: string): void => {
    setSlots((prev) => {
      const next = new Map(prev)
      if (next.has(pid)) {
        next.delete(pid)
      } else {
        if (next.size >= 8) {
          toast('Up to 8 players on the chart at once — deselect one first', 'error')
          return prev
        }
        const used = new Set(next.values())
        let free = 0
        while (used.has(free)) free++
        next.set(pid, free)
      }
      return next
    })
  }

  const eloData = useMemo(() => {
    const selected = [...slots.keys()]
    const current = new Map<string, number>()
    for (const pid of selected) current.set(pid, season.startingElos?.[pid] ?? 1000)
    const rows: Record<string, number | string>[] = [{ x: 0, ...Object.fromEntries(current) }]
    comp.timeline.forEach((ev, i) => {
      if (current.has(ev.playerId)) current.set(ev.playerId, ev.eloAfter)
      if (ev.opponentId && current.has(ev.opponentId) && ev.opponentEloAfter !== undefined) {
        current.set(ev.opponentId, ev.opponentEloAfter)
      }
      rows.push({ x: i + 1, ...Object.fromEntries(current) })
    })
    return rows
  }, [slots, comp.timeline, season.startingElos])

  const nameOf = (pid: string): string => season.players.find((p) => p.id === pid)?.name ?? pid

  // ---- Faction performance ----
  const factionData = useMemo(
    () =>
      comp.factionStats
        .filter((f) => f.games > 0)
        .map((f) => ({
          name: f.faction,
          winPct: Math.round(f.winPct * 100),
          games: f.games,
          label: `${Math.round(f.winPct * 100)}% · ${f.games} game${f.games === 1 ? '' : 's'}`
        }))
        .sort((a, b) => b.winPct - a.winPct),
    [comp.factionStats]
  )

  // ---- Disposition results (player-agnostic W/D/L per disposition) ----
  const dispositionData = useMemo(
    () =>
      comp.dispositionStats.map((d) => ({
        name: d.disposition,
        Wins: d.wins,
        Draws: d.draws,
        Losses: d.losses,
        winPct: Math.round(d.winPct * 100),
        games: d.games
      })),
    [comp.dispositionStats]
  )

  // ---- W/D/L ----
  const wdlData = useMemo(
    () =>
      activePlayers.map((p) => ({
        name: p.name,
        Wins: p.wins,
        Draws: p.draws,
        Losses: p.losses
      })),
    [activePlayers]
  )

  // ---- Avg BP ----
  const bpData = useMemo(
    () =>
      [...activePlayers]
        .sort((a, b) => b.avgBp - a.avgBp)
        .map((p) => ({ name: p.name, avgBp: Math.round(p.avgBp * 10) / 10 })),
    [activePlayers]
  )

  // ---- head-to-head ----
  const h2hPlayers = useMemo(
    () =>
      activePlayers.filter((p) =>
        season.matches.some((m) => m.p1 === p.playerId || m.p2 === p.playerId)
      ),
    [activePlayers, season.matches]
  )

  const barSize = Math.min(24, Math.max(14, 300 / Math.max(1, activePlayers.length)))

  return (
    <div>
      <div className="screen-head">
        <h1>Charts</h1>
        <span className="sub">Every chart exports as a PNG for sharing</span>
      </div>

      <div className="chart-grid">
        <ChartCard
          title="ELO over the season"
          hint="Rating after every game, in league order. Pick up to 8 players."
          exportName="elo-history"
        >
          <div className="chip-row">
            {activePlayers.map((p) => {
              const slot = slots.get(p.playerId)
              return (
                <button
                  key={p.playerId}
                  className={`chip ${slot !== undefined ? 'on' : ''}`}
                  onClick={() => togglePlayer(p.playerId)}
                >
                  <span className="dot" style={{ background: slot !== undefined ? SERIES[slot] : undefined }} />
                  {p.name}
                </button>
              )
            })}
          </div>
          <ResponsiveContainer width="100%" height={340}>
            <LineChart data={eloData} margin={{ top: 8, right: 24, bottom: 4, left: 0 }}>
              <CartesianGrid stroke={GRID} strokeWidth={1} vertical={false} />
              <XAxis
                dataKey="x"
                type="number"
                domain={[0, comp.timeline.length]}
                tickCount={8}
                stroke={GRID}
                tick={{ fill: INK3, fontSize: 11.5 }}
                tickFormatter={(x: number) =>
                  x === 0 ? 'Start' : comp.timeline[x - 1] ? fmtDate(comp.timeline[x - 1].date).slice(0, 6) : ''
                }
              />
              <YAxis
                domain={['dataMin - 15', 'dataMax + 15']}
                stroke={GRID}
                tick={{ fill: INK3, fontSize: 11.5 }}
                width={44}
              />
              <Tooltip
                contentStyle={tooltipStyle}
                labelFormatter={(x) => {
                  const ev = comp.timeline[(x as number) - 1]
                  return ev ? `${fmtDate(ev.date)} — ${ev.playerName} vs ${ev.opponentLabel}` : 'Season start'
                }}
              />
              {[...slots.entries()].map(([pid, slot]) => (
                <Line
                  key={pid}
                  type="stepAfter"
                  dataKey={pid}
                  name={nameOf(pid)}
                  stroke={SERIES[slot]}
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 4.5, stroke: SURFACE, strokeWidth: 2 }}
                  isAnimationActive={false}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
          <div className="legend-row">
            {[...slots.entries()].map(([pid, slot]) => (
              <span className="key" key={pid}>
                <span className="swatch" style={{ background: SERIES[slot] }} />
                {nameOf(pid)}
              </span>
            ))}
          </div>
        </ChartCard>

        <ChartCard
          title="Faction performance"
          hint="Win rate by faction across all recorded games (league players only)."
          exportName="faction-performance"
        >
          <ResponsiveContainer width="100%" height={Math.max(200, factionData.length * 34 + 40)}>
            <BarChart data={factionData} layout="vertical" margin={{ top: 4, right: 60, bottom: 4, left: 30 }}>
              <CartesianGrid stroke={GRID} strokeWidth={1} horizontal={false} />
              <XAxis
                type="number"
                domain={[0, 100]}
                stroke={GRID}
                tick={{ fill: INK3, fontSize: 11.5 }}
                tickFormatter={(v) => `${v}%`}
              />
              <YAxis
                type="category"
                dataKey="name"
                width={130}
                stroke={GRID}
                tick={{ fill: INK2, fontSize: 12.5 }}
              />
              <Tooltip
                contentStyle={tooltipStyle}
                formatter={(v: number, _n, item) => [`${v}% win rate · ${item.payload.games} games`, '']}
                cursor={{ fill: 'rgba(255,255,255,0.04)' }}
              />
              <Bar dataKey="winPct" fill="#3987e5" barSize={18} radius={[0, 4, 4, 0]} isAnimationActive={false}>
                <LabelList
                  dataKey="label"
                  position="right"
                  style={{ fill: INK2, fontSize: 12, fontVariantNumeric: 'tabular-nums' }}
                />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard
          title="Head-to-head"
          hint="Row player's record against column player (league singles matches). Blue = ahead, red = behind."
          exportName="head-to-head"
        >
          <div style={{ overflowX: 'auto' }}>
            <table className="h2h">
              <thead>
                <tr>
                  <th></th>
                  {h2hPlayers.map((p) => (
                    <th key={p.playerId}>{p.name}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {h2hPlayers.map((row) => (
                  <tr key={row.playerId}>
                    <th style={{ textAlign: 'right' }}>{row.name}</th>
                    {h2hPlayers.map((col) => {
                      if (row.playerId === col.playerId) {
                        return <td key={col.playerId} style={{ background: 'rgba(255,255,255,0.03)' }} />
                      }
                      const cell = comp.headToHead[row.playerId]?.[col.playerId]
                      const games = cell ? cell.wins + cell.draws + cell.losses : 0
                      const share = games ? (cell!.wins + 0.5 * cell!.draws) / games : 0
                      return (
                        <td
                          key={col.playerId}
                          style={{ background: h2hColor(share, games), color: games ? '#f2ead8' : 'var(--ink-3)' }}
                          title={games ? `${row.name} vs ${col.name}: ${cell!.wins}W ${cell!.draws}D ${cell!.losses}L` : 'Not played'}
                        >
                          {games ? `${cell!.wins}–${cell!.draws}–${cell!.losses}` : '·'}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="legend-row">
            <span className="key"><span className="swatch" style={{ background: '#1c5cab' }} />Dominates</span>
            <span className="key"><span className="swatch" style={{ background: '#383835' }} />Even</span>
            <span className="key"><span className="swatch" style={{ background: '#8a3535' }} />Struggles</span>
            <span className="key" style={{ color: 'var(--ink-3)' }}>Cells read W–D–L</span>
          </div>
        </ChartCard>

        <ChartCard
          title="Results breakdown"
          hint="Wins, draws and losses per player, all game types."
          exportName="results-breakdown"
        >
          <ResponsiveContainer width="100%" height={Math.max(200, wdlData.length * 34 + 40)}>
            <BarChart data={wdlData} layout="vertical" margin={{ top: 4, right: 40, bottom: 4, left: 10 }}>
              <CartesianGrid stroke={GRID} strokeWidth={1} horizontal={false} />
              <XAxis type="number" allowDecimals={false} stroke={GRID} tick={{ fill: INK3, fontSize: 11.5 }} />
              <YAxis type="category" dataKey="name" width={80} stroke={GRID} tick={{ fill: INK2, fontSize: 12.5 }} />
              <Tooltip contentStyle={tooltipStyle} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
              <Bar dataKey="Wins" stackId="a" fill={WDL.win} barSize={barSize} stroke={SURFACE} strokeWidth={1} isAnimationActive={false} />
              <Bar dataKey="Draws" stackId="a" fill={WDL.draw} barSize={barSize} stroke={SURFACE} strokeWidth={1} isAnimationActive={false} />
              <Bar dataKey="Losses" stackId="a" fill={WDL.loss} barSize={barSize} radius={[0, 4, 4, 0]} stroke={SURFACE} strokeWidth={1} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
          <div className="legend-row">
            <span className="key"><span className="swatch" style={{ background: WDL.win }} />Wins</span>
            <span className="key"><span className="swatch" style={{ background: WDL.draw }} />Draws</span>
            <span className="key"><span className="swatch" style={{ background: WDL.loss }} />Losses</span>
          </div>
        </ChartCard>

        <ChartCard
          title="Disposition results"
          hint="Wins, draws and losses per disposition, across all players and game types."
          exportName="disposition-results"
        >
          {dispositionData.length === 0 ? (
            <p className="hint" style={{ padding: '18px 0 8px' }}>
              No dispositions recorded yet — add them alongside the faction when saving a result, and this chart
              tracks how each disposition performs regardless of who runs it.
            </p>
          ) : (
            <>
              <ResponsiveContainer width="100%" height={Math.max(200, dispositionData.length * 34 + 40)}>
                <BarChart data={dispositionData} layout="vertical" margin={{ top: 4, right: 40, bottom: 4, left: 30 }}>
                  <CartesianGrid stroke={GRID} strokeWidth={1} horizontal={false} />
                  <XAxis type="number" allowDecimals={false} stroke={GRID} tick={{ fill: INK3, fontSize: 11.5 }} />
                  <YAxis type="category" dataKey="name" width={130} stroke={GRID} tick={{ fill: INK2, fontSize: 12.5 }} />
                  <Tooltip
                    contentStyle={tooltipStyle}
                    cursor={{ fill: 'rgba(255,255,255,0.04)' }}
                    labelFormatter={(name, payload) => {
                      const row = payload?.[0]?.payload
                      return row ? `${name} — ${row.winPct}% wins · ${row.games} games` : name
                    }}
                  />
                  <Bar dataKey="Wins" stackId="a" fill={WDL.win} barSize={18} stroke={SURFACE} strokeWidth={1} isAnimationActive={false} />
                  <Bar dataKey="Draws" stackId="a" fill={WDL.draw} barSize={18} stroke={SURFACE} strokeWidth={1} isAnimationActive={false} />
                  <Bar dataKey="Losses" stackId="a" fill={WDL.loss} barSize={18} radius={[0, 4, 4, 0]} stroke={SURFACE} strokeWidth={1} isAnimationActive={false} />
                </BarChart>
              </ResponsiveContainer>
              <div className="legend-row">
                <span className="key"><span className="swatch" style={{ background: WDL.win }} />Wins</span>
                <span className="key"><span className="swatch" style={{ background: WDL.draw }} />Draws</span>
                <span className="key"><span className="swatch" style={{ background: WDL.loss }} />Losses</span>
              </div>
            </>
          )}
        </ChartCard>

        <ChartCard
          title="Average battle points"
          hint="Average BP scored per game — a form guide independent of ELO."
          exportName="avg-battle-points"
        >
          <ResponsiveContainer width="100%" height={Math.max(200, bpData.length * 34 + 40)}>
            <BarChart data={bpData} layout="vertical" margin={{ top: 4, right: 60, bottom: 4, left: 10 }}>
              <CartesianGrid stroke={GRID} strokeWidth={1} horizontal={false} />
              <XAxis type="number" stroke={GRID} tick={{ fill: INK3, fontSize: 11.5 }} />
              <YAxis type="category" dataKey="name" width={80} stroke={GRID} tick={{ fill: INK2, fontSize: 12.5 }} />
              <Tooltip
                contentStyle={tooltipStyle}
                formatter={(v: number) => [`${v} avg BP`, '']}
                cursor={{ fill: 'rgba(255,255,255,0.04)' }}
              />
              <Bar dataKey="avgBp" fill="#d95926" barSize={18} radius={[0, 4, 4, 0]} isAnimationActive={false}>
                <LabelList dataKey="avgBp" position="right" style={{ fill: INK2, fontSize: 12, fontVariantNumeric: 'tabular-nums' }} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>
    </div>
  )
}
