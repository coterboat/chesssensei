# Chess Sensei

Personal, local-first chess trainer: play a strength-limited Stockfish, get a game review,
and the bot's rating adapts to how you played. See [PLAN.md](PLAN.md) for the full roadmap.

**Status:** Phase 4 — play a strength-limited Stockfish (400–2200) with optional clocks and sounds,
get a full game review, and a synthetic rating picks the next bot. Everything is local: games in
IndexedDB, rating and the in-progress game in localStorage. `npm run build` produces an installable
PWA that works offline after the first load (engine, opening book and sounds are precached).

## Game review

After every game a second Stockfish worker evaluates each position once (last → first, depth 16 /
400 ms, MultiPV 2) and the review screen shows: accuracy for both sides, an eval graph, a label
for every move (Brilliant / Great / Best / Excellent / Good / Book / Inaccuracy / Mistake / Miss /
Blunder), key moments, the engine's best line, and **Retry from here** against the same bot.

- Labels are based on **win-% lost**, not raw centipawns, so a +9 → +7 move is not a "blunder".
- Accuracy uses the Lichess curve on win-% loss. "Played like ~X" is a rough estimate, nothing more.
- Opening names come from the lichess-org/chess-openings dataset (CC0): `node scripts/build-openings.mjs`.
- `npx tsx scripts/analyze-pgn.ts game.pgn` runs the same review headlessly in the terminal.
- Review keys: `←/→` step, `↑/↓` start/end, `n` next key moment, `b` best line, `r` retry, `f` flip, `Esc` back.
- Analysis is checkpointed; if the tab closes mid-analysis it resumes on next load.
- The coach text is template-based and fully offline. No LLM is involved anywhere.

Rating rules: Elo update vs the bot's nominal rating, K=40 for the first 10 games then 24, start 1400.
A game is unrated if you used a takeback, started from a custom FEN, or it ended in under 10 moves
without a checkmate.

## How bot strength works

- **1350 and up:** Stockfish's own `UCI_LimitStrength` / `UCI_Elo`.
- **Below 1350:** Stockfish can't go lower than 1320, so the bot evaluates *every* legal move at a
  fixed shallow depth and samples one with probability ∝ `exp(−winPercentLost / T)`. The
  temperature `T` per Elo lives in `src/engine/strengthTable.json` and is fitted by
  `npm run calibrate`, which plays the sampling bot against `UCI_Elo` anchors in Node.

## Run

```bash
npm install     # also copies the lite Stockfish build into public/stockfish/
npm run dev     # http://localhost:5173
npm test        # Vitest (pure logic)
npm run calibrate -- --games 40 --write   # refit bot strength table (slow, uses all cores)
npm run build
```

Keys: `←/→` step through moves, `↑/↓` start/live, `f` flip, `q/n/r/b` pick promotion, `Esc` cancel it.

## Notes

- The opponent is Stockfish, never an LLM. Ratings shown are synthetic, not FIDE.
- Licensed GPL-3.0-or-later, as required by Stockfish and Chessground (both GPL-3).

## Assets

Sounds and the app icon were generated with Ludo.ai and post-processed locally:

```bash
set -a; source .env.local; set +a          # LUDO_API_KEY
python3 tools/gen_assets.py                 # candidates -> assets-src/ (gitignored)
python3 tools/install_assets.py . --pick move=2   # trim, normalise, pick -> public/sounds/*.wav
python3 tools/install_icon.py . 3           # needs Pillow; crops + exports the PWA icon sizes
```

Generated effects arrive with dead air in front and a long tail, so `install_assets.py` trims to the
onset and caps each sound's length; without `--pick` it chooses the candidate with the fastest attack.
