# PKH League — project notes

Web app (Vite + React + TypeScript, hosted on GitHub Pages) that replaced Miles's
`W40K_ELO_League_v2.xlsx` spreadsheet — and the interim Electron desktop app (retired at
tag `desktop-final`) — for running a Warhammer 40K ELO league. Built for non-technical
users: adding a result must stay a few clicks, and the league must never be
hand-repairable-only (everything recomputes from raw data).

## Commands

```bash
npm test              # vitest — engine verified against the spreadsheet's own numbers
npm run dev           # hot-reload dev; no worker → in-memory seed backend (codes "member"/"admin")
                      #   set VITE_WORKER_URL=http://localhost:8787 to hit a local worker
npm run build         # production bundle into dist-web/
npm run worker:dev    # run the Cloudflare Worker API locally (wrangler)
npm run worker:deploy # deploy the worker (manual — not part of CI)
npm run import:xlsx   # regenerate src/renderer/src/devSeed.json from the original workbook
```

## Architecture — the rules that matter

**Event-sourced.** The data document stores only raw inputs (matches, tournament
entries, guest games, players). Every derived number — ELO, peaks, aggregates, charts,
head-to-head — comes out of one pure function, `computeSeason()` in
`src/shared/engine.ts`, which replays the full season on every change (<1ms at this
scale). Never store derived state; never mutate incrementally.

**Data lives in the repo.** The whole league is one JSON file, `league-data.json`, on
the orphan **`data` branch** of this repo — every change is a commit (the git history is
the audit log and backup). The only writer is the Cloudflare Worker in `worker/`
(deployed as `pkh-league-api`), which holds a fine-grained GitHub PAT plus the two
league codes as secrets. GitHub Pages serves the frontend, deployed by
`.github/workflows/deploy.yml` on push to `master` (repo variable `WORKER_URL` is baked
into the build as `VITE_WORKER_URL`).

**Write model.** Reads are public (`GET /league` → `{data, sha}`). Members
(`POST /append` with the shared code) can only append one entry — the worker re-fetches
HEAD, assigns `seq`, validates, commits, and retries on SHA conflict, so concurrent
uploads from different devices never lose each other and stale clients can't clobber
anything. Admins (`PUT /league` with the admin code) replace the whole document, guarded
by the `baseSha` they loaded — a stale save gets a 409 and the UI reloads. Client-side
undo exists for admins only; a member's mistake is fixed by an admin in History.

- `src/shared/types.ts` — data model (`LeagueData` → seasons → raw logs) + computed types
- `src/shared/engine.ts` — ELO replay + aggregates (pure, no I/O)
- `src/shared/data.ts` — `activeSeason`/`updateSeason`/`nextSeq` (shared with the worker)
- `src/shared/protocol.ts` — client↔worker request/response shapes
- `src/shared/importXlsx.ts` — SheetJS parser for the original workbook (browser-safe,
  lazy-loaded so its ~500KB chunk stays out of the normal page load)
- `worker/index.ts` — the API: auth (constant-time), validation, GitHub Contents API
  read/commit with unicode-safe base64, CORS allowlist
- `src/renderer/src/remote.ts` — worker client + browser file/clipboard helpers;
  `localBackend.ts` is the dev-only in-memory backend (tree-shaken out of prod)
- `src/renderer/src/App.tsx` — data/sha/role state, `append` vs admin `mutate`,
  60s viewer polling (feeds the OBS overlay), session in localStorage
- `src/renderer/src/screens/*` — League Table, Add Result (also the History edit modal),
  History, Charts, Players, Settings (role-gated)

## Roles

`viewer` (no code, read-only — the stream/OBS view, `?screen=table` works as a browser
source) · `member` (shared code: append results and new players) · `admin` (John +
Miles: edits, deletes, undo, seasons, settings, imports). UI gating is convenience; the
worker enforces the real boundary.

## ELO rules (replicate the spreadsheet EXACTLY — league continuity depends on it)

- Everyone starts at 1000 (per-season `startingElos` overrides for carry-over seasons)
- Chronological replay; same-day tie-break order: **matches → guests → tournaments**,
  then entry order (`seq`, assigned server-side) — mirrors the sheet's sort-key offsets
  (0 / +0.0003 / +0.0005)
- Match: `E = 1/(1+10^((opp−me)/400))`, Δ = round(32·(A−E)), **zero-sum** (P2 gets −Δ)
- Tournament: phantom opponent `round(800 + SoS×400)`, composite `round((W+0.5D)/rounds, 4)`,
  `K = min(32×rounds, 96)`, one-sided
- Guest: opponent = est. ELO (blank → 1000), K=32, one-sided
- Rounding is Excel's **half-away-from-zero** (`excelRound`), not JS `Math.round` —
  they differ on negative halves and it shows up in real deltas
- League sort: ELO desc, tie-break average BP desc
- Ranking eligibility: players need `Season.minRankedGames` games (default 3,
  editable in Settings) to hold a rank; below that they're `provisional` (rank 0),
  shown below a divider line under the table. ELO still computes and counts —
  only the rank is withheld.

Any change to these must be a deliberate league decision, versioned per season.

## Lessons from the spreadsheet import (why numbers shifted)

The old sheet had silent data-entry bugs the importer now normalizes:

1. **Text dates** — guest date typed as `"08/13/2026"` → `#VALUE!` broke the sort-key
   chain; the game counted in totals but not ELO. `parseDate` accepts serials, ISO,
   and slash dates (unambiguous month position wins; ambiguous assumes mm/dd US —
   the league types dates US-style).
2. **Trailing-space names** — `"Andrew  "` became a phantom player; Excel COUNTIF/LOOKUP
   don't trim. All names/factions are whitespace-collapsed and matched case-insensitively
   (the worker rejects appends that would create a duplicate-name player).
3. **US dates misread by UK Excel** — Miles typed mm/dd but UK-locale Excel stored
   some as dd/mm *serials*, so the wrong date is baked into the cell and invisible to
   text parsing. The importer repairs any imported date in the future by swapping
   day/month when that lands in the past, and flags each in the report notes. The Add
   Result form (and the worker) also reject future dates outright.

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

For UI verification, `npm run dev` with no `VITE_WORKER_URL` runs fully offline against
`devSeed.json` (codes "member"/"admin") — every flow incl. appends, edits and undo works
in-memory.

## UI conventions

- Chrome palette: dark 40K theme (crimson `--crimson`, gold `--gold`) — **never used
  for chart series**. Chart series use the validated dataviz dark slots in
  `lib.ts` `SERIES`; W/D/L uses the green/gray/red diverging trio. Follow the
  `dataviz` skill before adding/altering any chart.
- Fonts: Bahnschrift (headings, ships with Win 11), Segoe UI (body) — nothing bundled.
- Player identity is by stable `id`; renames just edit `Player.name` and all history
  follows. Color-slot assignment on the ELO chart is per-entity and stable while selected.
- Dispositions: optional free-text per player per game (all three log types), tracked
  player-agnostically in `dispositionStats` with its own W/D/L chart. The suggestion
  dropdown seeds the five 11th-ed force dispositions (`DISPOSITIONS` in `lib.ts` — per
  https://game-datamissions.com/11th/matrix) plus any other values already recorded.
- Share card is 1080px wide, exported at 2× via `html-to-image`; "Copy image" uses the
  async ClipboardItem-with-promise form (Safari-safe, download fallback for Firefox).
- The CSP meta in `src/renderer/index.html` must allow `connect-src` to the worker —
  a missing entry silently breaks every fetch.

## Deployment / secrets (nothing secret is in the repo)

- Worker secrets (`npx wrangler secret put`, from `worker/`): `GITHUB_TOKEN`
  (fine-grained PAT, this repo only, Contents read+write), `MEMBER_CODE`, `ADMIN_CODE`.
- GitHub repo variable `WORKER_URL` = the deployed worker URL (used at build time).
- Pages: Settings → Pages → Source "GitHub Actions". Data branch is public — remind the
  league that notes fields are world-readable.
- Original workbook copy: `tests/fixtures/W40K_ELO_League_v2.xlsx`
