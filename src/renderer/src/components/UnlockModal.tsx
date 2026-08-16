import { useState } from 'react'
import { ApiError, authCode } from '../remote'
import { useApp, type Session } from '../App'

/**
 * Two steps: validate the league code against the API, then pick which player
 * you are (stamped on results you enter). One shared member code; a separate
 * admin code unlocks edits, deletes and settings.
 */
export default function UnlockModal(props: {
  onClose: () => void
  onUnlocked: (s: Session) => void
}): JSX.Element {
  const { season } = useApp()
  const [code, setCode] = useState('')
  const [checking, setChecking] = useState(false)
  const [error, setError] = useState('')
  const [pending, setPending] = useState<Session | null>(null)
  const [who, setWho] = useState('')

  const submitCode = async (): Promise<void> => {
    if (!code.trim() || checking) return
    setChecking(true)
    setError('')
    try {
      const role = await authCode(code.trim())
      setPending({ code: code.trim(), role, enteredBy: '' })
    } catch (e) {
      setError(e instanceof ApiError && e.status === 401 ? 'That code isn’t right — check with an admin' : `Couldn’t check the code: ${(e as Error).message}`)
    } finally {
      setChecking(false)
    }
  }

  const players = [...season.players].sort((a, b) => a.name.localeCompare(b.name))

  return (
    <div className="modal-backdrop" onClick={props.onClose}>
      <div className="modal" style={{ width: 420 }} onClick={(e) => e.stopPropagation()}>
        {!pending ? (
          <>
            <h2>Enter league code</h2>
            <p className="hint">The shared code lets you add results. Admins use their own code.</p>
            <div className="field" style={{ marginTop: 10 }}>
              <label>Code</label>
              <input
                autoFocus
                type="password"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && void submitCode()}
              />
            </div>
            {error && (
              <p style={{ color: 'var(--crimson-bright)', fontSize: 13, marginTop: 8 }}>{error}</p>
            )}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
              <button className="btn small" onClick={props.onClose}>
                Cancel
              </button>
              <button className="btn small primary" disabled={checking} onClick={() => void submitCode()}>
                {checking ? 'Checking…' : 'Unlock'}
              </button>
            </div>
          </>
        ) : (
          <>
            <h2>Who are you?</h2>
            <p className="hint">Results you enter are recorded with your name.</p>
            <div className="field" style={{ marginTop: 10 }}>
              <label>Player</label>
              <select autoFocus value={who} onChange={(e) => setWho(e.target.value)}>
                <option value="">— just watching / other —</option>
                {players.map((p) => (
                  <option key={p.id} value={p.name}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
              <button className="btn small primary" onClick={() => props.onUnlocked({ ...pending, enteredBy: who })}>
                Done
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
