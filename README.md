# Chess Sensei

Personal, local-first chess trainer: play a strength-limited Stockfish, get a game review,
and the bot's rating adapts to how you played. See [PLAN.md](PLAN.md) for the full roadmap.

**Status:** Phase 1 — play against a strength-limited Stockfish (400–2200), choose colour, resign,
offer draw, takeback, PGN with headers. Review/adaptive rating come next.

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
