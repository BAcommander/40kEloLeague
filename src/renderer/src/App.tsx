import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { LeagueData, Season, SeasonComputation } from '@shared/types'
import { computeSeason } from '@shared/engine'
import { api } from './api'
import { activeSeason } from './lib'
import LeagueTableScreen from './screens/LeagueTableScreen'
import AddResultScreen from './screens/AddResultScreen'
import HistoryScreen from './screens/HistoryScreen'
import ChartsScreen from './screens/ChartsScreen'
import PlayersScreen from './screens/PlayersScreen'
import SettingsScreen from './screens/SettingsScreen'

export type ScreenId = 'table' | 'add' | 'history' | 'charts' | 'players' | 'settings'

interface Toast {
  id: number
  msg: string
  kind: 'info' | 'error'
}

interface AppCtx {
  data: LeagueData
  season: Season
  comp: SeasonComputation
  mutate: (fn: (d: LeagueData) => LeagueData) => void
  replaceData: (d: LeagueData) => void
  toast: (msg: string, kind?: 'info' | 'error') => void
  undo: () => void
  canUndo: boolean
  go: (s: ScreenId) => void
}

const Ctx = createContext<AppCtx | null>(null)

export function useApp(): AppCtx {
  const v = useContext(Ctx)
  if (!v) throw new Error('useApp outside provider')
  return v
}

const NAV: { id: ScreenId; label: string; icon: JSX.Element }[] = [
  {
    id: 'table',
    label: 'League Table',
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
        <path d="M2 1h12v3H2zM2 6h12v1.5H2zm0 3.5h12V11H2zM2 13h12v1.5H2z" />
      </svg>
    )
  },
  {
    id: 'add',
    label: 'Add Result',
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
        <path d="M7 2h2v5h5v2H9v5H7V9H2V7h5z" />
      </svg>
    )
  },
  {
    id: 'history',
    label: 'History',
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6">
        <circle cx="8" cy="8" r="6" />
        <path d="M8 4.5V8l2.5 1.5" strokeLinecap="round" />
      </svg>
    )
  },
  {
    id: 'charts',
    label: 'Charts',
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
        <path d="M2 13h2.5V6H2zM6.75 13h2.5V2h-2.5zM11.5 13H14V8h-2.5z" />
      </svg>
    )
  },
  {
    id: 'players',
    label: 'Players',
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
        <circle cx="8" cy="5" r="3" />
        <path d="M2.5 14c0-3 2.5-4.5 5.5-4.5s5.5 1.5 5.5 4.5z" />
      </svg>
    )
  },
  {
    id: 'settings',
    label: 'Settings',
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6">
        <circle cx="8" cy="8" r="2.4" />
        <path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M12.6 3.4l-1.4 1.4M4.8 11.2l-1.4 1.4" />
      </svg>
    )
  }
]

export default function App(): JSX.Element {
  const [data, setData] = useState<LeagueData | null>(null)
  const [screen, setScreen] = useState<ScreenId>(() => {
    const q = new URLSearchParams(location.search).get('screen')
    return (['table', 'add', 'history', 'charts', 'players', 'settings'] as const).includes(
      q as ScreenId
    )
      ? (q as ScreenId)
      : 'table'
  })
  const [toasts, setToasts] = useState<Toast[]>([])
  const undoStack = useRef<LeagueData[]>([])
  const [canUndo, setCanUndo] = useState(false)
  const toastId = useRef(0)

  useEffect(() => {
    api.loadData().then(setData)
  }, [])

  const toast = useCallback((msg: string, kind: 'info' | 'error' = 'info') => {
    const id = ++toastId.current
    setToasts((t) => [...t, { id, msg, kind }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 6500)
  }, [])

  const persist = useCallback(
    (next: LeagueData) => {
      setData(next)
      api.saveData(next).catch((e) => toast(`Save failed: ${e.message}`, 'error'))
    },
    [toast]
  )

  const mutate = useCallback(
    (fn: (d: LeagueData) => LeagueData) => {
      setData((prev) => {
        if (!prev) return prev
        undoStack.current.push(prev)
        if (undoStack.current.length > 30) undoStack.current.shift()
        setCanUndo(true)
        const next = fn(prev)
        api.saveData(next).catch((e) => toast(`Save failed: ${e.message}`, 'error'))
        return next
      })
    },
    [toast]
  )

  const undo = useCallback(() => {
    const prev = undoStack.current.pop()
    setCanUndo(undoStack.current.length > 0)
    if (prev) {
      persist(prev)
      toast('Change undone')
    }
  }, [persist, toast])

  const replaceData = useCallback(
    (d: LeagueData) => {
      if (data) {
        undoStack.current.push(data)
        setCanUndo(true)
      }
      persist(d)
    },
    [data, persist]
  )

  const season = useMemo(() => (data ? activeSeason(data) : null), [data])
  const comp = useMemo(() => (season ? computeSeason(season) : null), [season])

  if (!data || !season || !comp) {
    return <div style={{ padding: 40, color: '#8a8071' }}>Loading league…</div>
  }

  const ctx: AppCtx = {
    data,
    season,
    comp,
    mutate,
    replaceData,
    toast,
    undo,
    canUndo,
    go: setScreen
  }

  return (
    <Ctx.Provider value={ctx}>
      <div className="app">
        <nav className="sidebar">
          <div className="brand">
            PKH LEAGUE
            <small>W40K ELO Tracker</small>
          </div>
          <div className="divider" />
          {NAV.map((n) => (
            <button
              key={n.id}
              className={`nav-btn ${screen === n.id ? 'active' : ''}`}
              onClick={() => setScreen(n.id)}
            >
              {n.icon}
              {n.label}
            </button>
          ))}
          <div className="foot">
            {season.name}
            <br />
            {season.players.length} players ·{' '}
            {season.matches.length + season.guestGames.length} games ·{' '}
            {new Set(season.tournamentEntries.map((t) => t.tournament)).size} tournaments
          </div>
        </nav>
        <main className="main">
          {screen === 'table' && <LeagueTableScreen />}
          {screen === 'add' && <AddResultScreen />}
          {screen === 'history' && <HistoryScreen />}
          {screen === 'charts' && <ChartsScreen />}
          {screen === 'players' && <PlayersScreen />}
          {screen === 'settings' && <SettingsScreen />}
        </main>
        <div className="toasts">
          {toasts.map((t) => (
            <div key={t.id} className={`toast ${t.kind}`}>
              {t.msg}
            </div>
          ))}
        </div>
      </div>
    </Ctx.Provider>
  )
}
