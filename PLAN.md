# Chess Sensei — Implementation Plan

Personal, local-first chess trainer: play a strength-limited Stockfish, get a Chess.com-style
review, bot Elo adapts. Based on the original Grok spec, with the corrections in §1 applied.
Everything in the original spec that is not contradicted here still stands (non-goals, stack,
UX tone, data model, acceptance tests).

Verified on 2026-09-19 against the real packages:

| Package | Version | Notes |
|---|---|---|
| `stockfish` | 19.0.0 (GPL-3.0) | `bin/stockfish-19-lite-single.{js,wasm}` = 21 KB + 1.8 MB. Package itself is ~200 MB installed (full nets) — copy only the two lite-single files into `public/stockfish/`. |
| `@lichess-org/chessground` | 10.2.0 (GPL-3.0-or-later) | the unscoped `chessground` is the stale one |
| `chess.js` | 1.4.0 | |
| `react` 19.3 / `vite` 8.3 / `zustand` 5 / `idb` 8 / `vite-plugin-pwa` 1.3 | | use React 19, not 18 — no reason to pin old |

Lite-single in Node on this machine: ~1M nps, depth 16 in ~290 ms, depth 18 in 400 ms (MultiPV 1).
Engine options confirmed: `UCI_Elo min 1320 max 3190`, `Skill Level 0–20`, `MultiPV`, `UCI_ShowWDL`, `Threads max 1`.

---

## 1. Corrections to the original spec

### 1.1 Bot strength below 1320 is the hard problem (spec gets it wrong)
`UCI_Elo` has a floor of **1320**, and `Skill Level 0` is roughly that same strength. The spec's
fallback table ("Skill 0 + 18% chance of 2nd/3rd-best within 80cp = 400 Elo") would produce a
~1300 bot labelled 400. A player starting at 800 would lose every game and the adaptive loop
would bottom out immediately. Since the player starts at 800, **this is the most important thing
to get right**, not a fallback.

Replacement — two regimes:

- **botElo ≥ 1350:** `UCI_LimitStrength=true`, `UCI_Elo=botElo`, movetime 300–800 ms. Do **not**
  also set `Skill Level` (UCI_Elo overrides it; setting both is noise).
- **botElo < 1350:** our own weakening on top of full-strength search ("human-ish error model"):
  1. Search `MultiPV 6`, short movetime (150–300 ms), full strength.
  2. Convert each line's score to win% (§1.3). Sample a move with softmax over win%, temperature
     `T(elo)` — high T at 400, → 0 at 1350.
  3. With probability `pBlunder(elo)`, ignore the engine and pick a random legal move, biased
     toward moves that *don't* hang the queen in one (pure random looks fake; a 600 hangs pieces
     to 2-move tactics, not to nothing).
  4. Guard rails: always play mate-in-1 above ~700; never sample a move that allows mate-in-1
     above ~900; always recapture a queen. Below those, let it blunder.
  5. No weakening in book (first ~4 plies just play a sane opening move) so games don't start silly.
- **Calibration harness (`scripts/calibrate.mjs`, Node):** the `stockfish` package runs in Node,
  so play N=100 games of weak-bot(params) vs anchor `UCI_Elo 1320` and vs neighbouring weak-bot
  levels, compute Elo differences, and fit `T(elo)` / `pBlunder(elo)` so that the ladder
  400 → 1320 is approximately evenly spaced. Output is a checked-in `strengthTable.json`.
  Without this the Elo numbers are fiction; with it they're at least internally consistent.

### 1.2 Analysis pipeline
- "Evaluate before AND after each move" is double work: eval-after(ply n) ≡ eval-before(ply n+1).
  Analyze **N+1 positions once each**, derive both from the same array.
- `ucinewgame` before every `go` wipes the hash table — terrible for sequential analysis. Send it
  **once per game** (play) / once per analysis run. Analyze positions **last → first** so the hash
  carries forward-looking info into earlier positions.
- `go depth 16 movetime 400` (both limits in one command; SF stops at whichever hits first).
- **MultiPV 2, not 3.** Second-best is all that's needed for "only move"/Great/Miss detection;
  3 costs depth for nothing.
- Stockfish scores are **side-to-move relative**. Normalize to White-positive in exactly one
  place (the UCI parser's caller in `analyze.ts`) and unit-test it. This is the #1 classic bug.
- Terminal positions (mate/stalemate) have no `go` — synthesize the eval.
- Budget: 80-ply game ≈ 81 × 0.4 s ≈ 35 s. Acceptable. Stretch: analyze incrementally *during*
  the game on the second worker (cache by FEN) so review is instant.

### 1.3 Accuracy formula is misapplied
`103.1668 * exp(-0.04354 * x) - 3.1668` is the **Lichess** formula and `x` is **win-% loss**, not
centipawn loss. Fed raw cpl, a 50 cp slip scores ~8% accuracy. Correct pipeline:

```
win%(cp)   = 50 + 50 * (2 / (1 + exp(-0.00368208 * cp)) - 1)     // cp from mover's POV
win%(mate) = 100 if mover mates, 0 if mover gets mated
loss       = max(0, win%Before - win%After)                        // mover's POV
moveAcc    = clamp(103.1668 * exp(-0.04354 * loss) - 3.1668, 0, 100)
gameAcc    = (arithmeticMean(moveAcc) + harmonicMean(moveAcc)) / 2 // punishes blunders like Lichess
```
This also deletes the "mate in n → 15 − 0.5(n−1)" hack; win% handles mates naturally. Still keep
`cpl` (cp capped at ±1000) in the record for display.

### 1.4 Classification: use win-% loss, fix ordering
Raw-cp thresholds call a +9 → +7 move a "blunder". Use expected-points loss (`loss/100`),
which is what Chess.com actually does:

| Class | Rule (first match wins) |
|---|---|
| Book | position-after is in the openings table (keyed by EPD → handles transpositions; no "ply ≤ 8" rule) |
| Brilliant | see below |
| Great | loss ≤ 2 **and** 2nd-best line loses ≥ 10 win% vs best **and** not a trivial recapture |
| **Miss** | opponent's previous move lost ≥ 10 win%, best move here would have kept ≥ 10 win% more than what I played, my loss ≥ 5 — **must be checked before Inaccuracy/Mistake/Blunder** (in the spec it's rule #10 after an exhaustive cpl ladder, so it could never fire) |
| Best | played == engine best, or loss ≤ 0.5 |
| Excellent | loss ≤ 2 |
| Good | loss ≤ 5 |
| Inaccuracy | loss ≤ 10 |
| Mistake | loss ≤ 20 |
| Blunder | loss > 20 |

**Brilliant** — spec's "my material drops ≥ 2 pawns this ply" is wrong (your own move never drops
your material; the opponent's capture does). Rule: loss ≤ 2, **and** following the engine PV from
the position after my move, material balance (1/3/3/5/9) is ≥ 2 worse for me at PV ply 1 or 3
than before my move, **and** my win% after ≥ 45, **and** win% before < 97 (no "brilliant" sacs
when already +10). Ship it behind a constant; if it spams, turn it off.

"Game played like ~X Elo": map from gameAcc instead of mean cpl (same rough interpolation idea,
anchors tuned after ~20 real games). Label it "rough".

### 1.5 Adaptive Elo
- The ±25 accuracy nudge on top of K=40 double-counts and swamps the result signal. Cut to
  `clamp((acc − expectedAcc(botElo)) * 0.5, −10, +10)` and skip it for games < 20 plies.
- Rated only if: no takebacks, ≥ 10 full moves or a decisive natural ending (stops accidental
  resign-on-move-2 tanking).
- Keep: K=40→24 after 10 games, offset setting, manual lock, reset. Keep a rating history array
  for a sparkline.

### 1.6 Smaller fixes
- **Offline is claimed but never implemented.** Add `vite-plugin-pwa` (precache app shell + the
  1.8 MB wasm + openings.json) in Phase 4. Until then "offline" = `npm run dev`.
- **Draw offers:** the bot's own search eval is garbage in the weak regime (it's sampling). Track
  draw eligibility from the full-strength MultiPV top line we already have, not the played move.
- **xAI key:** entered in Settings, stored in localStorage, never `VITE_`-baked into the bundle.
- **Openings data:** lichess `chess-openings` TSVs (CC0), ~3.5k lines → build script replays each
  with chess.js and emits `{ epd: [eco, name] }`. Opening name = last matched position in the game.
- **Store design:** the chess.js instance lives in `gameController` (plain class), not in Zustand.
  Store holds serializable snapshots (fen, history, clocks, status). Chessground gets a thin
  `useEffect` ref wrapper; never re-create it on render.
- **Two workers:** `playEngine` and `analysisEngine`, each its own lite-single instance (~2 MB +
  16 MB hash each). Retry mode uses `playEngine`.
- Worker loading: `new Worker('/stockfish/stockfish-19-lite-single.js')` — classic worker from
  `public/`, not bundled by Vite; the js locates the `.wasm` next to itself. A `postinstall` /
  `predev` script copies the two files from `node_modules/stockfish/bin/`.

### 1.7 Addition worth making: the Mistake Deck (Phase 5)
The spec clones Chess.com's review but the thing that actually makes you better is drilling your
own errors. Every Mistake/Blunder/Miss becomes a card `{fen, bestUci, pv, yourMove, class}`.
A "Drill" screen serves them Leitner-style (boxes 1–5, due dates in IndexedDB): find the best
move (accept any move with loss ≤ 2), wrong → back to box 1. Plus a tiny stats panel: accuracy
trend, blunders per game, errors by phase (opening/middlegame/endgame). This is ~1 day of work
on top of Phase 3 infrastructure and is the main reason to own this tool instead of renting one.

---

## 2. Assets (Ludo AI / Grok Imagine)

Keep the board and pieces stock — AI image models can't produce 12 stylistically consistent,
crisp-at-40px SVG pieces, and Chessground's cburnett set is already the "serious analysis board"
look. Generate only:

| Asset | Tool | Spec |
|---|---|---|
| App icon / favicon / PWA icons | Grok Imagine or Ludo | one mark (knight silhouette / 先 motif), flat, works at 32 px; export 1024 → downscale to 512/192/32 |
| Wordmark "Chess Sensei" (replaces "Trainer") | either | or just set it in a good font and skip |
| Sounds: move, capture, check, castle, game-end, low-time | **Ludo AI** SFX | short (<300 ms) wooden clicks, normalized, `.mp3`+`.ogg` in `public/sounds/` |
| Classification badges (brilliant `!!`, great `!`, blunder `??`, …) | **hand-written SVG**, not AI | tiny, need to be pixel-exact and themable |
| Optional: subtle board texture, coach-panel glyph | Grok Imagine | only in Phase 4 if it still feels plain |

Asset generation is Phase 4 work; nothing before that needs it (use silence + default favicon).

---

## 3. Repo layout (delta from spec)

```
PLAN.md  README.md  LICENSE(GPL-3.0)
scripts/
  copy-engine.mjs          # node_modules/stockfish/bin/*lite-single* -> public/stockfish/
  build-openings.mjs       # lichess TSV -> public/openings.json (EPD-keyed)
  calibrate.mjs            # weak-bot ladder calibration (Node, headless)
src/
  chess/gameController.ts  chess/openings.ts  chess/material.ts
  engine/uci.ts            # pure: parse info/bestmove lines (unit-tested)
  engine/engine.ts         # worker wrapper + command queue + restart-once
  engine/play.ts           # strength regimes, sampling, guard rails
  engine/strengthTable.json
  engine/analyze.ts        # N+1 positions, reverse order, White-normalized
  review/winprob.ts  review/classify.ts  review/accuracy.ts
  review/keyMoments.ts  review/pgnExport.ts  review/adaptive.ts
  drill/deck.ts            # Phase 5
  persist/db.ts  persist/settings.ts
  state/store.ts
  ui/ PlayScreen ReviewScreen DrillScreen Board EvalGraph EvalBar MoveList
      CoachPanel HistoryDrawer SettingsDrawer PromotionPicker Clock Toast
```
`engine/uci.ts`, everything in `review/`, `chess/material.ts`, and the sampling math in
`play.ts` are pure functions with injected RNG → all Vitest-covered without a browser.

---

## 4. Build phases

Each phase ends with a concrete check. Don't start the next until it passes.

### Phase 0 — Skeleton (½ day)
1. `git init`, Vite react-ts scaffold, GPL-3 LICENSE, deps, `copy-engine.mjs` wired to `postinstall`.
2. `gameController` wrapping chess.js: `move()`, `legalDests()` (Chessground `dests` map), `status()`, `pgn()`, `undo()`, `load(fen)`.
3. `Board.tsx` Chessground ref-wrapper: dests, lastMove, check, orientation, `drawable.autoShapes` for arrows.
4. Promotion picker (needed from day one — Chessground doesn't provide one).
5. Move list (SAN, click to preview a past position → board goes read-only until "back to live").
- ✅ Human-vs-human full game incl. castling, e.p., promotion, mate; illegal moves impossible.

### Phase 1 — Engine play (1–1.5 days)
1. `uci.ts` parser + tests (cp, mate, multipv, lowerbound/upperbound lines, bestmove `(none)`).
2. `engine.ts`: worker, promise-based queue (`init`, `setOptions`, `newGame`, `search`, `stop`), one auto-restart + toast.
3. `play.ts` regime A (UCI_Elo ≥ 1350) → play a full game at 1600.
4. `play.ts` regime B (sampling model) with hand-guessed params → play a game at 600; confirm it *feels* beatable.
5. `calibrate.mjs`: run ladder overnight/in background, commit `strengthTable.json`.
6. Resign, draw offer, new game, color choice + flip, "thinking…" state, PGN headers.
- ✅ I can mate the 400 bot; the 1600 bot mates me; every engine move legal; PGN round-trips.

### Phase 2 — Persistence + adaptive (½ day)
1. `db.ts` (idb): `games`, `retries` (child records), later `cards`. `settings.ts` (localStorage): elo, offset, lock, sound, clock default.
2. `adaptive.ts` + tests (win/draw/loss, K switch, clamps, lock, unrated conditions).
3. Save on game end; header shows playerElo / botElo; History drawer (list, open, delete one/all).
- ✅ Reload keeps history + Elo; next game's botElo follows the formula.

### Phase 3 — Analysis + Review = the product (3–4 days)
1. `winprob.ts`, `accuracy.ts`, `material.ts` + tests.
2. `analyze.ts`: N+1 evals, reverse order, progress callback, cancellable, resumable (persist partial `moves[]` so a reload mid-analysis continues).
3. `classify.ts` + tests: scholar's mate, hung queen (blunder), failure to punish hung queen (**miss**), only-move (great), 1.e4 (book), +9→+7 (must NOT be blunder), mate-in-2 missed for a mate-in-5 (not a blunder).
4. `openings.ts` + `build-openings.mjs`.
5. `keyMoments.ts`: book exit, biggest swing, first blunder, last saveable moment (last ply where my win% ≥ 35 before dropping for good), the mate.
6. Review UI: board + eval bar · eval graph (plain SVG, win%-scaled so mates don't flatten it, click-to-jump, class-colored dots on errors) · colored move list · summary strip · coach panel (badge, "You played X, best was Y", best-move arrow, Show best line stepping through PV, Next key moment) · keyboard ←/→/b/r.
7. Retry mode: fork from FEN vs same botElo, saved as child record, "Back to review" returns to the same ply.
8. PGN export with `{[%eval] class, acc}` comments; auto-analysis kick-off on game end with progress pill on Play screen.
- ✅ Acceptance tests 1–10 from the original spec, verified in the browser pane, plus `npm test` and `npm run build`.

### Phase 4 — Polish (2 days)
Clocks (Off/5+0/10+0/15+10, bot "spends" its movetime, takeback disabled when on) · takebacks (mark unrated) · sounds + generated assets (§2) · settings drawer · mobile layout (board first, stacked panels) · error/empty states · PWA/offline · PGN import → same analyzer · README.

### Phase 5 — Mistake Deck + stats (1–2 days)
§1.7. Card extraction runs at the end of analysis; Drill screen; Leitner scheduling; trend panel.

### Phase 6 — Coach English (½ day, flagged, default off)
xAI chat completions per selected move with the precomputed JSON only (FEN, SAN, class, loss, best, PV, opening, material delta). 2 sentences, cached in IndexedDB by `gameId:ply`. Model never relabels.

**Total:** ~9–12 focused days; playable-with-review at the end of Phase 3 (~6 days).

---

## 5. Risks

| Risk | Mitigation |
|---|---|
| Weak-bot feels fake (random blunders, then engine-perfect play) | softmax sampling over real candidates > random-move injection; guard rails by Elo; calibrate; tune by feel after 10 real games |
| Lite net evals are noisier than full SF → flaky labels near thresholds | win%-based thresholds are forgiving in decided positions; depth 16–18 is plenty for < 2000-level review |
| Chessground vs React re-render fights | single ref wrapper, imperative `cg.set()`, never keyed remounts |
| Brilliant spam | constant kill-switch; strict win% gates |
| Analysis interrupted by tab close | partial results persisted per ply, resume on open |
