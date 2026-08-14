# PKH League — W40K ELO League Tracker

A Windows desktop app that replaces the `W40K_ELO_League` Excel spreadsheet. All the
league's history is already loaded, the ELO maths is identical to the spreadsheet, and
everything recalculates automatically when you add, edit or delete a result.

## For Miles — daily use

1. **Install**: run `PKH League Setup 1.0.0.exe` once (or just double-click the portable
   `PKH League 1.0.0.exe` — no install needed).
2. **After a game night**: open the app → **Add Result** → pick the players, result and
   battle points → **Save**. That's it — the league table, every ELO and all the charts
   update instantly, and a toast shows exactly how much each player's ELO moved.
3. **Share the table**: **League Table → Copy image**, then paste straight into WhatsApp.
   (Or **Share as image** to save the PNG.)
4. **Made a mistake?** **History** lists every game ever played — Edit or Delete any of
   them and the whole league recalculates as if it had always been right. There's also an
   **Undo last change** button.

Everything saves automatically to your PC (Settings → Data shows where). The last 20
versions are kept as backups, and **Settings → Export backup** makes a file you can move
to another computer or send to someone.

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
npm run dev           # run with hot reload
npm run import:xlsx   # regenerate seed data from the original workbook
npm run dist          # build portable exe + installer into dist/
```

Stack: Electron + Vite + React + TypeScript. The ELO engine (`src/shared/engine.ts`) is
pure and event-sourced: raw results in, full replay out — no stored derived state.
