# PKH League — project notes

Windows desktop app (Electron + Vite + React + TypeScript) that replaced Miles's
`W40K_ELO_League_v2.xlsx` spreadsheet for running a Warhammer 40K ELO league.
Built for a non-technical user: adding a result must stay a few clicks, and the
league must never be hand-repairable-only (everything recomputes from raw data).

## Commands

```bash
npm test              # vitest — engine verified against the spreadsheet's own numbers
npm run dev           # hot-reload dev (electron-vite)
npm run build         # bundle main/preload/renderer into out/
npm run dist          # build + package portable exe + NSIS installer into dist/
npm run import:xlsx   # regenerate src/main/seed.json from the original workbook
npx electron scripts/make-icon.js   # re-render build/icon.png from build/icon.html
```

## Architecture — the one rule that matters

**Event-sourced.** The data file stores only raw inputs (matches, tournament
entries, guest games, players). Every derived number — ELO, peaks, aggregates,
charts, head-to-head — comes out of one pure function, `computeSeason()` in
`src/shared/engine.ts`, which replays the full season on every change (<1ms at
this scale). Never store derived state; never mutate incrementally. This is what
makes edit/delete/undo trivially correct where the spreadsheet was fragile.

- `src/shared/types.ts` — data model (`LeagueData` → seasons → raw logs) + computed types
- `src/shared/engine.ts` — ELO replay + aggregates (pure, no I/O)
- `src/shared/importXlsx.ts` — SheetJS parser for the original workbook + reconciliation diff
- `src/main/store.ts` — JSON persistence in `userData`, atomic write via rename, 20 rolling backups
- `src/main/index.ts` — window, IPC (`data:*`, `xlsx:import`, `png:*`), dev shot harness
- `src/renderer/src/screens/*` — League Table, Add Result (also the History edit modal), History, Charts, Players, Settings
- `src/main/seed.json` — generated first-run data; regenerate via `npm run import:xlsx`, commit it

## ELO rules (replicate the spreadsheet EXACTLY — league continuity depends on it)

- Everyone starts at 1000 (per-season `startingElos` overrides for carry-over seasons)
- Chronological replay; same-day tie-break order: **matches → guests → tournaments**,
  then entry order (`seq`) — mirrors the sheet's sort-key offsets (0 / +0.0003 / +0.0005)
- Match: `E = 1/(1+10^((opp−me)/400))`, Δ = round(32·(A−E)), **zero-sum** (P2 gets −Δ)
- Tournament: phantom opponent `round(800 + SoS×400)`, composite `round((W+0.5D)/rounds, 4)`,
  `K = min(32×rounds, 96)`, one-sided
- Guest: opponent = est. ELO (blank → 1000), K=32, one-sided
- Rounding is Excel's **half-away-from-zero** (`excelRound`), not JS `Math.round` —
  they differ on negative halves and it shows up in real deltas
- League sort: ELO desc, tie-break average BP desc
- Ranking eligibility: players need `Season.minRankedGames` games (default 2,
  editable in Settings) to hold a rank; below that they're `provisional` (rank 0),
  shown under the table. ELO still computes and counts — only the rank is withheld.

Any change to these must be a deliberate league decision, versioned per season.

## Lessons from the spreadsheet import (why numbers shifted)

The old sheet had silent data-entry bugs the importer now normalizes:

1. **Text dates** — guest date typed as `"08/13/2026"` → `#VALUE!` broke the sort-key
   chain; the game counted in totals but not ELO. `parseDate` accepts serials, ISO,
   and slash dates (unambiguous month position wins; ambiguous assumes mm/dd US —
   the league types dates US-style).
2. **Trailing-space names** — `"Andrew  "` became a phantom player; Excel COUNTIF/LOOKUP
   don't trim. All names/factions are whitespace-collapsed and matched case-insensitively.
3. **US dates misread by UK Excel** — Miles typed mm/dd but UK-locale Excel stored
   some as dd/mm *serials* (e.g. "8/12/2026" → serial for 8 Dec, a future date), so
   the wrong date is baked into the cell and invisible to text parsing. The importer
   repairs any imported date in the future by swapping day/month when that lands in
   the past, and flags each in the report notes ("Please confirm"). Rows 25–28 of the
   Match Log were affected (true dates 9–12 Aug 2026); the swap is ELO-neutral because
   relative order among the affected players is preserved. The Add Result form also
   rejects future dates outright.

Corrected results: Allan 1017→1032, Andrew 1011→982 (±1 knock-ons for John/Kev).
The reconciliation report is stored on `LeagueData.importReport` and shown in Settings.
The engine test suite deliberately reproduces the *buggy* behaviour (untrimmed names,
guest excluded) to pin against the sheet's own computed values in `tests/fixtures/`
(extracted from cached formula values in the xlsx — the workbook itself is committed
there for the round-trip test).

## Testing approach

Ground truth is the spreadsheet's own cached ELO Engine values, not hand-computed
numbers. `tests/engine.test.ts` replays with bugs preserved and asserts every
eloBefore/after/delta/K matches; a second pass asserts the *fixed* data behaves
correctly. When touching the engine, run `npm test` before anything else — a 1-point
drift means a rounding or ordering regression.

## Dev screenshot harness (headless UI verification)

The packaged main process supports env-gated capture — use it to eyeball screens
without clicking through:

```bash
PKH_SHOT=/path/shot.png PKH_SHOT_SCREEN=charts PKH_SHOT_SCROLL=1500 npx electron .
# PKH_SHOT_SCREEN: table | add | history | charts | players | settings
# PKH_SHOT_SHARECARD=1  renders the share card on-screen (table screen)
# PKH_TEST_COPY=1       clicks "Copy image" and verifies a real PNG hit the clipboard
```

## UI conventions

- Chrome palette: dark 40K theme (crimson `--crimson`, gold `--gold`) — **never used
  for chart series**. Chart series use the validated dataviz dark slots in
  `lib.ts` `SERIES`; W/D/L uses the green/gray/red diverging trio. Follow the
  `dataviz` skill before adding/altering any chart.
- Fonts: Bahnschrift (headings, ships with Win 11), Segoe UI (body) — nothing bundled.
- Player identity is by stable `id`; renames just edit `Player.name` and all history
  follows. Color-slot assignment on the ELO chart is per-entity and stable while selected.
- Dispositions: optional free-text per player per game (all three log types), tracked
  player-agnostically in `dispositionStats` with its own W/D/L chart. No canonical
  list — the suggestion dropdown is built from values already recorded.
- Share card is 1080px wide, exported at 2× via `html-to-image`.

## Data locations

- Packaged app: `%APPDATA%\PKH League\league-data.json` (+ `backups\`)
- Dev: `%APPDATA%\pkh-league\league-data.json` (different app name → separate data)
- Original workbook copy: `tests/fixtures/W40K_ELO_League_v2.xlsx`
