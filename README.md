# PKH League — W40K ELO League Tracker

The league's web app — it replaced the `W40K_ELO_League` Excel spreadsheet (and the
desktop app that came in between). All the league's history is loaded, the ELO maths is
identical to the spreadsheet, and everything recalculates automatically when a result is
added, edited or deleted.

**Live site**: `https://bacommander.github.io/40kEloLeague/` — anyone with the link can
view the table (streams can use it as an OBS browser source; it refreshes itself every
minute).

## How it works

- The **frontend** is served free by GitHub Pages from this repo (`master` branch, built
  by the Actions workflow).
- The **league data** is a single JSON file on this repo's **`data` branch** — every
  result is a git commit, so the full history of the league is the git history and
  nothing can ever be lost.
- A tiny **Cloudflare Worker** (`worker/`) is the write gate: it holds the GitHub token
  and the league codes. Members' appends are applied server-side against the latest
  data, so two people uploading at once can never lose each other's games.

## Daily use

1. Open the site → **Enter league code** (bottom left, one time per device) → pick your
   name.
2. **Add Result** → players, result, battle points → **Save**. The table, ELOs and
   charts update instantly and a toast shows exactly how much each ELO moved.
3. **Share the table**: League Table → **Copy image**, paste straight into WhatsApp.
4. **Made a mistake?** Ask an admin — with the admin code, every game in **History** can
   be edited or deleted and the whole league recalculates as if it had always been right.

Roles: no code = view only · member code = add results (and new players) · admin code =
everything (edits, deletes, seasons, settings, backups).

## What's tracked

- **Singles matches** between league players (K=32, zero-sum)
- **Tournaments** — one entry per player: rounds, W/D/L, VP, SoS. ELO vs a phantom
  opponent at `800 + SoS×400`, K = `min(32×rounds, 96)`
- **Guest games** vs non-league opponents (one-sided, guest defaults to ELO 1000)
- League table (ELO, peak, W/D/L, win %, BP, tournaments), tie-break on average BP
- Charts: ELO over the season, faction win rates, head-to-head grid, results breakdown,
  average battle points — all exportable as PNGs
- **Seasons**: Settings → Start new season for the next edition (fresh 1000s, or carry
  over a percentage of everyone's rating). Old seasons stay archived and viewable.

## Note on the first import

The spreadsheet had two data-entry bugs which the import fixed, so a few numbers differ
from the last Excel table (see **Settings → Original import report**):

- The guest game's date was typed as text, which broke the spreadsheet's formulas — the
  game counted toward totals but not ELO. Restored: **Allan 1017 → 1032**.
- Two match rows had `"Andrew  "` with trailing spaces, which Excel treated as a
  different player — Andrew was missing 2 losses. Merged: **Andrew 1011 → 982**, with
  small knock-on shifts for John and Kev.

## For developers

```bash
npm install
npm test              # ELO engine verified against the original spreadsheet's own numbers
npm run dev           # local dev — runs against an in-memory copy of the seed data
                      #   (codes: "member" / "admin"); set VITE_WORKER_URL to hit a real worker
npm run build         # production build into dist-web/
npm run worker:dev    # run the API worker locally (wrangler)
npm run worker:deploy # deploy the API worker to Cloudflare
npm run import:xlsx   # regenerate dev seed data from the original workbook
```

Stack: Vite + React + TypeScript, Cloudflare Worker API, GitHub Contents API storage.
The ELO engine (`src/shared/engine.ts`) is pure and event-sourced: raw results in, full
replay out — no stored derived state. Deploys happen automatically on push to `master`.
