import { forwardRef } from 'react'
import type { PlayerStats } from '@shared/types'
import { fmtDate, fmtPct, todayIso } from '../lib'

interface Props {
  leagueName: string
  seasonName: string
  table: PlayerStats[]
}

/**
 * The shareable league-table graphic (rendered off-screen, exported as PNG at 2x).
 * 1080px wide — sized for WhatsApp/phone screens.
 */
const ShareCard = forwardRef<HTMLDivElement, Props>(function ShareCard({ leagueName, seasonName, table }, ref) {
  const medal = (rank: number): string => (rank === 1 ? '#c9a24b' : rank === 2 ? '#b9b9b9' : rank === 3 ? '#b0793d' : 'transparent')
  return (
    <div
      ref={ref}
      style={{
        width: 1080,
        background: 'linear-gradient(160deg, #1b1511 0%, #14100c 55%, #1a1008 100%)',
        color: '#f2ead8',
        fontFamily: "'Segoe UI', system-ui, sans-serif",
        padding: '52px 56px 40px',
        position: 'relative',
        overflow: 'hidden'
      }}
    >
      {/* corner ornament */}
      <div
        style={{
          position: 'absolute',
          top: -130,
          right: -130,
          width: 380,
          height: 380,
          border: '2px solid rgba(201,162,75,0.14)',
          transform: 'rotate(45deg)'
        }}
      />
      <div
        style={{
          position: 'absolute',
          top: -100,
          right: -100,
          width: 320,
          height: 320,
          border: '1px solid rgba(201,162,75,0.10)',
          transform: 'rotate(45deg)'
        }}
      />

      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 8 }}>
        <div>
          <div
            style={{
              fontFamily: "Bahnschrift, 'Segoe UI', sans-serif",
              fontSize: 46,
              fontWeight: 700,
              letterSpacing: '0.05em',
              color: '#c9a24b',
              lineHeight: 1.05
            }}
          >
            {leagueName.toUpperCase()}
          </div>
          <div style={{ fontSize: 19, color: '#b8ad98', marginTop: 8, letterSpacing: '0.14em', textTransform: 'uppercase' }}>
            {seasonName} · Standings · {fmtDate(todayIso())}
          </div>
        </div>
        <div
          style={{
            fontFamily: "Bahnschrift, 'Segoe UI', sans-serif",
            fontSize: 21,
            color: '#a61e22',
            border: '2px solid #a61e22',
            padding: '8px 18px',
            letterSpacing: '0.16em',
            transform: 'rotate(-2deg)'
          }}
        >
          WARHAMMER 40K
        </div>
      </div>

      <div style={{ height: 3, background: 'linear-gradient(90deg, #a61e22, #c9a24b 40%, transparent)', margin: '22px 0 26px' }} />

      <table style={{ width: '100%', borderCollapse: 'collapse', fontVariantNumeric: 'tabular-nums' }}>
        <thead>
          <tr>
            {['Rank', 'Player', 'ELO', 'Games', 'W', 'D', 'L', 'Win %', 'BP'].map((h, i) => (
              <th
                key={h}
                style={{
                  fontFamily: "Bahnschrift, 'Segoe UI', sans-serif",
                  fontSize: 16,
                  letterSpacing: '0.12em',
                  textTransform: 'uppercase',
                  color: '#8a8071',
                  textAlign: i < 2 ? 'left' : 'right',
                  padding: '10px 14px',
                  borderBottom: '2px solid rgba(201,162,75,0.35)'
                }}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.map((p) => {
            const top = p.rank <= 3
            return (
              <tr key={p.playerId} style={{ background: p.rank === 1 ? 'rgba(201,162,75,0.09)' : 'transparent' }}>
                <td style={{ padding: '13px 14px', borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
                    <span
                      style={{
                        width: 10,
                        height: 10,
                        transform: 'rotate(45deg)',
                        background: medal(p.rank),
                        display: 'inline-block'
                      }}
                    />
                    <span style={{ fontSize: 22, fontWeight: 700, color: top ? '#c9a24b' : '#f2ead8' }}>{p.rank}</span>
                  </span>
                </td>
                <td
                  style={{
                    padding: '13px 14px',
                    borderBottom: '1px solid rgba(255,255,255,0.07)',
                    fontSize: 23,
                    fontWeight: 700,
                    color: top ? '#f8f2df' : '#e4dbc6'
                  }}
                >
                  {p.name}
                </td>
                <td style={{ padding: '13px 14px', borderBottom: '1px solid rgba(255,255,255,0.07)', textAlign: 'right', fontSize: 23, fontWeight: 700, color: top ? '#c9a24b' : '#f2ead8' }}>
                  {p.elo}
                </td>
                {[p.games, p.wins, p.draws, p.losses].map((v, i) => (
                  <td key={i} style={{ padding: '13px 14px', borderBottom: '1px solid rgba(255,255,255,0.07)', textAlign: 'right', fontSize: 20, color: '#b8ad98' }}>
                    {v}
                  </td>
                ))}
                <td style={{ padding: '13px 14px', borderBottom: '1px solid rgba(255,255,255,0.07)', textAlign: 'right', fontSize: 20, color: '#b8ad98' }}>
                  {fmtPct(p.winPct)}
                </td>
                <td style={{ padding: '13px 14px', borderBottom: '1px solid rgba(255,255,255,0.07)', textAlign: 'right', fontSize: 20, color: '#b8ad98' }}>
                  {p.bp}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>

      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 26, color: '#8a8071', fontSize: 15 }}>
        <span>In the grim darkness of the far future, there is only war.</span>
        <span style={{ letterSpacing: '0.1em' }}>PKH LEAGUE APP</span>
      </div>
    </div>
  )
})

export default ShareCard
