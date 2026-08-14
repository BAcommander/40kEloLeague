import { useMemo, useState } from 'react'
import type { GameResult, GuestGame, MatchGame, Season, TournamentEntry } from '@shared/types'
import { computeSeason } from '@shared/engine'
import { useApp } from '../App'
import { FACTIONS, nextSeq, todayIso, uid, updateSeason } from '../lib'

type Tab = 'Match' | 'Tournament' | 'Guest'

/** The faction this player fielded most recently (prefill for the faction picker). */
function lastFaction(season: Season, playerId: string): string {
  let best: { date: string; faction: string } | null = null
  const consider = (date: string, faction?: string): void => {
    if (faction && (!best || date >= best.date)) best = { date, faction }
  }
  for (const m of season.matches) {
    if (m.p1 === playerId) consider(m.date, m.faction1)
    if (m.p2 === playerId) consider(m.date, m.faction2)
  }
  for (const t of season.tournamentEntries) if (t.player === playerId) consider(t.date, t.faction)
  for (const g of season.guestGames) if (g.player === playerId) consider(g.date, g.playerFaction)
  return best ? (best as { faction: string }).faction : ''
}

function FactionInput(props: {
  label: string
  value: string
  onChange: (v: string) => void
}): JSX.Element {
  const listId = useMemo(() => uid('fl'), [])
  return (
    <div className="field">
      <label>{props.label}</label>
      <input list={listId} value={props.value} onChange={(e) => props.onChange(e.target.value)} placeholder="Faction" />
      <datalist id={listId}>
        {FACTIONS.map((f) => (
          <option key={f} value={f} />
        ))}
      </datalist>
    </div>
  )
}

function PlayerSelect(props: {
  label: string
  value: string
  exclude?: string
  onChange: (id: string) => void
  onAddPlayer: (name: string) => string
}): JSX.Element {
  const { season } = useApp()
  const [adding, setAdding] = useState(false)
  const [newName, setNewName] = useState('')
  const players = [...season.players].sort((a, b) => a.name.localeCompare(b.name))
  return (
    <div className="field">
      <label>{props.label}</label>
      {!adding ? (
        <select
          value={props.value}
          onChange={(e) => {
            if (e.target.value === '__new') {
              setAdding(true)
            } else {
              props.onChange(e.target.value)
            }
          }}
        >
          <option value="">— choose —</option>
          {players
            .filter((p) => p.id !== props.exclude)
            .map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          <option value="__new">+ New player…</option>
        </select>
      ) : (
        <div style={{ display: 'flex', gap: 6 }}>
          <input
            autoFocus
            placeholder="Player name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && newName.trim()) {
                const id = props.onAddPlayer(newName.trim())
                props.onChange(id)
                setAdding(false)
                setNewName('')
              }
              if (e.key === 'Escape') setAdding(false)
            }}
          />
          <button
            className="btn small"
            onClick={() => {
              if (newName.trim()) {
                const id = props.onAddPlayer(newName.trim())
                props.onChange(id)
              }
              setAdding(false)
              setNewName('')
            }}
          >
            Add
          </button>
        </div>
      )}
    </div>
  )
}

function ResultSeg(props: { value: GameResult; onChange: (r: GameResult) => void; forName?: string }): JSX.Element {
  return (
    <div className="field">
      <label>Result {props.forName ? `for ${props.forName}` : ''}</label>
      <div className="seg result">
        {(['Win', 'Draw', 'Loss'] as GameResult[]).map((r) => (
          <button
            key={r}
            className={props.value === r ? `on ${r.toLowerCase()}` : ''}
            onClick={() => props.onChange(r)}
          >
            {r}
          </button>
        ))}
      </div>
    </div>
  )
}

function NumField(props: {
  label: string
  value: string
  onChange: (v: string) => void
  step?: string
  placeholder?: string
}): JSX.Element {
  return (
    <div className="field">
      <label>{props.label}</label>
      <input
        type="number"
        step={props.step ?? '1'}
        value={props.value}
        placeholder={props.placeholder}
        onChange={(e) => props.onChange(e.target.value)}
      />
    </div>
  )
}

const num = (s: string): number | undefined => (s.trim() === '' ? undefined : Number(s))

export interface EditTarget {
  type: Tab
  id: string
}

export function EventEditor(props: { edit?: EditTarget; onDone?: () => void }): JSX.Element {
  const { season, mutate, toast } = useApp()

  const editing = props.edit
  const existingMatch = editing?.type === 'Match' ? season.matches.find((m) => m.id === editing.id) : undefined
  const existingTournament =
    editing?.type === 'Tournament' ? season.tournamentEntries.find((t) => t.id === editing.id) : undefined
  const existingGuest = editing?.type === 'Guest' ? season.guestGames.find((g) => g.id === editing.id) : undefined

  const [tab, setTab] = useState<Tab>(editing?.type ?? 'Match')

  // --- shared ---
  const [date, setDate] = useState(existingMatch?.date ?? existingTournament?.date ?? existingGuest?.date ?? todayIso())
  const [notes, setNotes] = useState(existingMatch?.notes ?? existingTournament?.notes ?? existingGuest?.notes ?? '')

  // --- match ---
  const [p1, setP1] = useState(existingMatch?.p1 ?? '')
  const [p2, setP2] = useState(existingMatch?.p2 ?? '')
  const [result, setResult] = useState<GameResult>(existingMatch?.result ?? existingGuest?.result ?? 'Win')
  const [bp1, setBp1] = useState(existingMatch?.bp1?.toString() ?? existingGuest?.playerBP?.toString() ?? '')
  const [bp2, setBp2] = useState(existingMatch?.bp2?.toString() ?? existingGuest?.oppBP?.toString() ?? '')
  const [f1, setF1] = useState(existingMatch?.faction1 ?? existingGuest?.playerFaction ?? '')
  const [f2, setF2] = useState(existingMatch?.faction2 ?? existingGuest?.oppFaction ?? '')

  // --- tournament ---
  const [tourney, setTourney] = useState(existingTournament?.tournament ?? '')
  const [tPlayer, setTPlayer] = useState(existingTournament?.player ?? existingGuest?.player ?? '')
  const [rounds, setRounds] = useState(existingTournament?.rounds.toString() ?? '')
  const [tw, setTw] = useState(existingTournament?.wins.toString() ?? '')
  const [td, setTd] = useState(existingTournament?.draws.toString() ?? '0')
  const [tl, setTl] = useState(existingTournament?.losses.toString() ?? '')
  const [vp, setVp] = useState(existingTournament?.vp?.toString() ?? '')
  const [sos, setSos] = useState(existingTournament?.sos.toString() ?? '')
  const [tFaction, setTFaction] = useState(existingTournament?.faction ?? '')

  // --- guest ---
  const [guestName, setGuestName] = useState(existingGuest?.guestName ?? '')
  const [guestElo, setGuestElo] = useState(existingGuest?.guestElo?.toString() ?? '1000')

  const addPlayer = (name: string): string => {
    const id = uid('p')
    mutate((d) => updateSeason(d, season.id, (s) => ({ ...s, players: [...s.players, { id, name }] })))
    return id
  }

  const pickFaction = (playerId: string, set: (v: string) => void, current: string): void => {
    if (!current) {
      const last = lastFaction(season, playerId)
      if (last) set(last)
    }
  }

  /** Save, then toast the resulting ELO movements for the players involved. */
  const commit = (mutateSeason: (s: Season) => Season, involved: string[], newEventId: string): void => {
    mutate((d) => updateSeason(d, season.id, mutateSeason))
    // Compute on the mutated season for the toast.
    const nextSeason = mutateSeason(season)
    const comp = computeSeason(nextSeason)
    const before = computeSeason(season)
    const lines = involved
      .filter(Boolean)
      .map((pid) => {
        const name = nextSeason.players.find((p) => p.id === pid)?.name ?? pid
        const oldElo = before.table.find((p) => p.playerId === pid)?.elo
        const newElo = comp.table.find((p) => p.playerId === pid)?.elo
        if (oldElo === undefined || newElo === undefined) return `${name}: —`
        const d = newElo - oldElo
        return `${name}: ${oldElo} → ${newElo} (${d >= 0 ? '+' : ''}${d})`
      })
      .join('\n')
    toast(`${editing ? 'Result updated' : 'Result saved'}\n${lines}`)
    void newEventId
    props.onDone?.()
  }

  const saveMatch = (): void => {
    if (!p1 || !p2 || p1 === p2) {
      toast('Pick two different players', 'error')
      return
    }
    const id = existingMatch?.id ?? uid('m')
    const entry: MatchGame = {
      id,
      date,
      p1,
      p2,
      result,
      bp1: num(bp1),
      bp2: num(bp2),
      faction1: f1.trim() || undefined,
      faction2: f2.trim() || undefined,
      notes: notes.trim() || undefined,
      seq: existingMatch?.seq ?? nextSeq(season)
    }
    commit(
      (s) => ({
        ...s,
        matches: existingMatch ? s.matches.map((m) => (m.id === id ? entry : m)) : [...s.matches, entry]
      }),
      [p1, p2],
      id
    )
  }

  const saveTournament = (): void => {
    const r = num(rounds)
    const so = num(sos)
    if (!tPlayer || !r || so === undefined) {
      toast('Player, rounds and SoS are required', 'error')
      return
    }
    if (so < 0 || so > 1) {
      toast('SoS must be between 0.00 and 1.00', 'error')
      return
    }
    const w = num(tw) ?? 0
    const d = num(td) ?? 0
    const l = num(tl) ?? 0
    if (w + d + l !== r) {
      toast(`W+D+L (${w + d + l}) must equal rounds played (${r})`, 'error')
      return
    }
    const id = existingTournament?.id ?? uid('t')
    const entry: TournamentEntry = {
      id,
      date,
      tournament: tourney.trim() || 'Tournament',
      player: tPlayer,
      rounds: r,
      wins: w,
      draws: d,
      losses: l,
      vp: num(vp),
      sos: so,
      faction: tFaction.trim() || undefined,
      notes: notes.trim() || undefined,
      seq: existingTournament?.seq ?? nextSeq(season)
    }
    commit(
      (s) => ({
        ...s,
        tournamentEntries: existingTournament
          ? s.tournamentEntries.map((t) => (t.id === id ? entry : t))
          : [...s.tournamentEntries, entry]
      }),
      [tPlayer],
      id
    )
  }

  const saveGuest = (): void => {
    if (!tPlayer || !guestName.trim()) {
      toast('League player and guest name are required', 'error')
      return
    }
    const id = existingGuest?.id ?? uid('g')
    const entry: GuestGame = {
      id,
      date,
      player: tPlayer,
      result,
      playerBP: num(bp1),
      oppBP: num(bp2),
      playerFaction: f1.trim() || undefined,
      oppFaction: f2.trim() || undefined,
      guestName: guestName.trim(),
      guestElo: num(guestElo),
      notes: notes.trim() || undefined,
      seq: existingGuest?.seq ?? nextSeq(season)
    }
    commit(
      (s) => ({
        ...s,
        guestGames: existingGuest ? s.guestGames.map((g) => (g.id === id ? entry : g)) : [...s.guestGames, entry]
      }),
      [tPlayer],
      id
    )
  }

  const tournamentNames = [...new Set(season.tournamentEntries.map((t) => t.tournament))]
  const p1Name = season.players.find((p) => p.id === (tab === 'Match' ? p1 : tPlayer))?.name

  return (
    <div>
      {!editing && (
        <div className="tabs">
          {(['Match', 'Tournament', 'Guest'] as Tab[]).map((t) => (
            <button key={t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>
              {t === 'Match' ? 'Singles Match' : t === 'Tournament' ? 'Tournament' : 'Guest Game'}
            </button>
          ))}
        </div>
      )}

      <div className="card">
        {tab === 'Match' && (
          <>
            <h2>Singles match</h2>
            <p className="hint">A league game between two registered players. Both ELOs move (zero-sum, K=32).</p>
            <div className="form-grid">
              <div className="field">
                <label>Date</label>
                <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
              </div>
              <PlayerSelect
                label="Player 1"
                value={p1}
                exclude={p2}
                onChange={(id) => {
                  setP1(id)
                  pickFaction(id, setF1, f1)
                }}
                onAddPlayer={addPlayer}
              />
              <PlayerSelect
                label="Player 2"
                value={p2}
                exclude={p1}
                onChange={(id) => {
                  setP2(id)
                  pickFaction(id, setF2, f2)
                }}
                onAddPlayer={addPlayer}
              />
              <ResultSeg value={result} onChange={setResult} forName={p1Name} />
              <NumField label="BP — Player 1" value={bp1} onChange={setBp1} placeholder="0–100" />
              <NumField label="BP — Player 2" value={bp2} onChange={setBp2} placeholder="0–100" />
              <FactionInput label="Faction — Player 1" value={f1} onChange={setF1} />
              <FactionInput label="Faction — Player 2" value={f2} onChange={setF2} />
              <div className="field wide">
                <label>Notes</label>
                <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" />
              </div>
            </div>
            <div style={{ marginTop: 18 }}>
              <button className="btn primary" onClick={saveMatch}>
                {editing ? 'Save changes' : 'Save match'}
              </button>
            </div>
          </>
        )}

        {tab === 'Tournament' && (
          <>
            <h2>Tournament result</h2>
            <p className="hint">
              One entry per player per tournament. ELO is applied against a phantom opponent (800 + SoS×400), K =
              min(32×rounds, 96).
            </p>
            <div className="form-grid">
              <div className="field">
                <label>Date</label>
                <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
              </div>
              <div className="field">
                <label>Tournament</label>
                <input
                  list="tournament-names"
                  value={tourney}
                  onChange={(e) => setTourney(e.target.value)}
                  placeholder="e.g. The Kelpie Cup #9"
                />
                <datalist id="tournament-names">
                  {tournamentNames.map((t) => (
                    <option key={t} value={t} />
                  ))}
                </datalist>
              </div>
              <PlayerSelect
                label="Player"
                value={tPlayer}
                onChange={(id) => {
                  setTPlayer(id)
                  pickFaction(id, setTFaction, tFaction)
                }}
                onAddPlayer={addPlayer}
              />
              <NumField label="Rounds played" value={rounds} onChange={setRounds} />
              <NumField label="Wins" value={tw} onChange={setTw} />
              <NumField label="Draws" value={td} onChange={setTd} />
              <NumField label="Losses" value={tl} onChange={setTl} />
              <NumField label="VP total" value={vp} onChange={setVp} />
              <NumField label="SoS (0.00–1.00)" value={sos} onChange={setSos} step="0.01" placeholder="e.g. 0.76" />
              <FactionInput label="Faction" value={tFaction} onChange={setTFaction} />
              <div className="field wide">
                <label>Notes</label>
                <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" />
              </div>
            </div>
            <div style={{ marginTop: 18 }}>
              <button className="btn primary" onClick={saveTournament}>
                {editing ? 'Save changes' : 'Save tournament result'}
              </button>
            </div>
          </>
        )}

        {tab === 'Guest' && (
          <>
            <h2>Guest game</h2>
            <p className="hint">
              A game against a one-off opponent who isn’t in the league. Only the league player’s ELO moves (K=32,
              guest defaults to 1000).
            </p>
            <div className="form-grid">
              <div className="field">
                <label>Date</label>
                <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
              </div>
              <PlayerSelect
                label="League player"
                value={tPlayer}
                onChange={(id) => {
                  setTPlayer(id)
                  pickFaction(id, setF1, f1)
                }}
                onAddPlayer={addPlayer}
              />
              <div className="field">
                <label>Guest opponent</label>
                <input value={guestName} onChange={(e) => setGuestName(e.target.value)} placeholder="Name" />
              </div>
              <NumField label="Guest est. ELO" value={guestElo} onChange={setGuestElo} placeholder="1000" />
              <ResultSeg value={result} onChange={setResult} forName={p1Name} />
              <NumField label="BP — league player" value={bp1} onChange={setBp1} placeholder="0–100" />
              <NumField label="BP — guest" value={bp2} onChange={setBp2} placeholder="0–100" />
              <FactionInput label="Faction — league player" value={f1} onChange={setF1} />
              <FactionInput label="Faction — guest" value={f2} onChange={setF2} />
              <div className="field wide">
                <label>Notes</label>
                <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" />
              </div>
            </div>
            <div style={{ marginTop: 18 }}>
              <button className="btn primary" onClick={saveGuest}>
                {editing ? 'Save changes' : 'Save guest game'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

export default function AddResultScreen(): JSX.Element {
  const { canUndo, undo } = useApp()
  return (
    <div>
      <div className="screen-head">
        <h1>Add Result</h1>
        <span className="sub">ELO updates instantly when you save</span>
        <span className="spacer" />
        {canUndo && (
          <button className="btn small" onClick={undo}>
            Undo last change
          </button>
        )}
      </div>
      <EventEditor />
    </div>
  )
}
