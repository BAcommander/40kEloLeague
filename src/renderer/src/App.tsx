import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { LeagueData, Season, SeasonComputation } from '@shared/types'
import type { AppendRequest, Role } from '@shared/protocol'
import { computeSeason } from '@shared/engine'
import { ApiError, appendEntry, getLeague, putLeague, usingLocalBackend } from './remote'
import { activeSeason } from './lib'
import UnlockModal from './components/UnlockModal'
import LeagueTableScreen from './screens/LeagueTableScreen'
import AddResultScreen from './screens/AddResultScreen'
import HistoryScreen from './screens/HistoryScreen'
import ChartsScreen from './screens/ChartsScreen'
import PlayersScreen from './screens/PlayersScreen'
import SettingsScreen from './screens/SettingsScreen'

export type ScreenId = 'table' | 'add' | 'history' | 'charts' | 'players' | 'settings'

export type UiRole = 'viewer' | Role

export interface Session {
  code: string
  role: Role
  enteredBy: string
}

interface Toast {
  id: number
  msg: string
  kind: 'info' | 'error'
}

interface AppCtx {
  data: LeagueData
  season: Season
  comp: SeasonComputation
  role: UiRole
  enteredBy: string
  /** Member+ write: append one result/player; resolves to the fresh data, or null on failure (already toasted). */
  append: (req: Omit<AppendRequest, 'enteredBy'>) => Promise<LeagueData | null>
  /** Admin write: full-document save (edits, deletes, settings). No-op unless admin. */
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

const SESSION_KEY = 'pkh.session'

function loadSession(): Session | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY)
    if (!raw) return null
    const s = JSON.parse(raw) as Session
    return s.code && (s.role === 'member' || s.role === 'admin') ? s : null
  } catch {
    return null
  }
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
  const [loadError, setLoadError] = useState<string | null>(null)
  const [session, setSession] = useState<Session | null>(loadSession)
  const [unlockOpen, setUnlockOpen] = useState(false)
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

  // Refs mirror the latest snapshot/session so async save handlers never act on stale closures.
  const dataRef = useRef<LeagueData | null>(null)
  const shaRef = useRef('')
  const sessionRef = useRef<Session | null>(session)
  sessionRef.current = session
  const savesInFlight = useRef(0)

  const role: UiRole = session?.role ?? 'viewer'

  const setSnap = useCallback((d: LeagueData, sha: string) => {
    dataRef.current = d
    shaRef.current = sha
    setData(d)
  }, [])

  const toast = useCallback((msg: string, kind: 'info' | 'error' = 'info') => {
    const id = ++toastId.current
    setToasts((t) => [...t, { id, msg, kind }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 6500)
  }, [])

  const clearSession = useCallback(() => {
    localStorage.removeItem(SESSION_KEY)
    setSession(null)
  }, [])

  const saveSession = useCallback((s: Session) => {
    localStorage.setItem(SESSION_KEY, JSON.stringify(s))
    setSession(s)
  }, [])

  const refresh = useCallback(async (silent = true): Promise<void> => {
    if (savesInFlight.current > 0) return // don't clobber an optimistic save in progress
    try {
      const snap = await getLeague()
      setSnap(snap.data, snap.sha)
      setLoadError(null)
    } catch (e) {
      if (!silent) setLoadError(e instanceof Error ? e.message : 'Could not load the league')
    }
  }, [setSnap])

  useEffect(() => {
    void refresh(false)
  }, [refresh])

  // Viewers (incl. the OBS overlay) poll for fresh results; everyone refetches on tab return.
  useEffect(() => {
    const onVisible = (): void => {
      if (document.visibilityState === 'visible') void refresh()
    }
    document.addEventListener('visibilitychange', onVisible)
    const interval = role === 'viewer' ? window.setInterval(() => void refresh(), 60_000) : undefined
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      if (interval) window.clearInterval(interval)
    }
  }, [role, refresh])

  const handleAuthError = useCallback(() => {
    clearSession()
    toast('Your league code is no longer valid — enter it again', 'error')
  }, [clearSession, toast])

  /** Admin full-document save with optimistic local state and 409/401 recovery. */
  const persistAdmin = useCallback(
    (next: LeagueData, undoFrom: LeagueData | null) => {
      const s = sessionRef.current
      const prev = dataRef.current
      if (!s || s.role !== 'admin' || !prev) return
      if (undoFrom) {
        undoStack.current.push(undoFrom)
        if (undoStack.current.length > 30) undoStack.current.shift()
        setCanUndo(true)
      }
      const baseSha = shaRef.current
      dataRef.current = next
      setData(next)
      savesInFlight.current++
      putLeague(next, baseSha, s.code, s.enteredBy)
        .then((snap) => setSnap(snap.data, snap.sha))
        .catch((e) => {
          if (undoFrom) {
            undoStack.current.pop()
            setCanUndo(undoStack.current.length > 0)
          }
          if (e instanceof ApiError && e.status === 409) {
            toast('Someone else saved first — reloaded the latest league. Your change was NOT applied; please redo it.', 'error')
            void refresh()
          } else if (e instanceof ApiError && (e.status === 401 || e.status === 403)) {
            setSnap(prev, baseSha)
            handleAuthError()
          } else {
            setSnap(prev, baseSha)
            toast(`Save failed: ${e instanceof Error ? e.message : e}`, 'error')
          }
        })
        .finally(() => {
          savesInFlight.current--
        })
    },
    [setSnap, toast, refresh, handleAuthError]
  )

  const mutate = useCallback(
    (fn: (d: LeagueData) => LeagueData) => {
      const prev = dataRef.current
      if (!prev) return
      persistAdmin(fn(prev), prev)
    },
    [persistAdmin]
  )

  const undo = useCallback(() => {
    const prev = undoStack.current.pop()
    setCanUndo(undoStack.current.length > 0)
    if (prev) {
      persistAdmin(prev, null)
      toast('Change undone')
    }
  }, [persistAdmin, toast])

  const replaceData = useCallback(
    (d: LeagueData) => {
      persistAdmin(d, dataRef.current)
    },
    [persistAdmin]
  )

  const append = useCallback(
    async (req: Omit<AppendRequest, 'enteredBy'>): Promise<LeagueData | null> => {
      const s = sessionRef.current
      if (!s) {
        setUnlockOpen(true)
        return null
      }
      savesInFlight.current++
      try {
        const snap = await appendEntry({ ...req, enteredBy: s.enteredBy }, s.code)
        setSnap(snap.data, snap.sha)
        return snap.data
      } catch (e) {
        if (e instanceof ApiError && (e.status === 401 || e.status === 403)) {
          handleAuthError()
        } else if (e instanceof ApiError && e.status === 409) {
          toast(e.message, 'error')
          void refresh()
        } else {
          toast(`Save failed: ${e instanceof Error ? e.message : e}`, 'error')
        }
        return null
      } finally {
        savesInFlight.current--
      }
    },
    [setSnap, toast, refresh, handleAuthError]
  )

  const season = useMemo(() => (data ? activeSeason(data) : null), [data])
  const comp = useMemo(() => (season ? computeSeason(season) : null), [season])

  if (loadError) {
    return (
      <div style={{ padding: 40, color: '#b8ad98', maxWidth: 480 }}>
        <h2 style={{ color: '#f2ead8', marginBottom: 10 }}>Couldn&apos;t load the league</h2>
        <p style={{ marginBottom: 16 }}>{loadError}</p>
        <button className="btn primary" onClick={() => void refresh(false)}>
          Try again
        </button>
      </div>
    )
  }

  if (!data || !season || !comp) {
    return <div style={{ padding: 40, color: '#8a8071' }}>Loading league…</div>
  }

  const ctx: AppCtx = {
    data,
    season,
    comp,
    role,
    enteredBy: session?.enteredBy ?? '',
    append,
    mutate,
    replaceData,
    toast,
    undo,
    canUndo,
    go: setScreen
  }

  const nav = NAV.filter((n) => n.id !== 'add' || role !== 'viewer')

  return (
    <Ctx.Provider value={ctx}>
      <div className="app">
        <nav className="sidebar">
          <div className="brand">
            PKH LEAGUE
            <small>W40K ELO Tracker</small>
          </div>
          <div className="divider" />
          {nav.map((n) => (
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
            <div style={{ marginTop: 10 }}>
              {session ? (
                <>
                  <div style={{ marginBottom: 6 }}>
                    {session.enteredBy || 'Signed in'} · {session.role}
                    {usingLocalBackend && ' · local dev'}
                  </div>
                  <button className="btn small" onClick={clearSession}>
                    Sign out
                  </button>
                </>
              ) : (
                <button className="btn small" onClick={() => setUnlockOpen(true)}>
                  Enter league code
                </button>
              )}
            </div>
          </div>
        </nav>
        <main className="main">
          {screen === 'table' && <LeagueTableScreen />}
          {screen === 'add' && role !== 'viewer' && <AddResultScreen />}
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
        {unlockOpen && (
          <UnlockModal
            onClose={() => setUnlockOpen(false)}
            onUnlocked={(s) => {
              saveSession(s)
              setUnlockOpen(false)
              toast(s.role === 'admin' ? 'Signed in as admin' : 'Welcome — you can now add results')
            }}
          />
        )}
      </div>
    </Ctx.Provider>
  )
}
