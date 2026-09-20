# Chess Sensei

Personal, local-first chess trainer: play a strength-limited Stockfish, get a game review,
and the bot's rating adapts to how you played. See [PLAN.md](PLAN.md) for the full roadmap.

**Status:** Phase 0 — board, full legal chess (human vs human), SAN move list with preview, promotion picker.

## Run

```bash
npm install     # also copies the lite Stockfish build into public/stockfish/
npm run dev     # http://localhost:5173
npm test        # Vitest (pure logic)
npm run build
```

Keys: `←/→` step through moves, `↑/↓` start/live, `f` flip, `q/n/r/b` pick promotion, `Esc` cancel it.

## Notes

- The opponent is Stockfish, never an LLM. Ratings shown are synthetic, not FIDE.
- Licensed GPL-3.0-or-later, as required by Stockfish and Chessground (both GPL-3).
