import { Chess } from 'chess.js'
import type { PlyRecord } from '../chess/gameController'
import { materialBalance } from '../chess/material'
import type { Score } from '../engine/uci'
import { estimateElo, gameAccuracy, moveAccuracy } from './accuracy'
import type { AnalyzedPly, GameAnalysis, MoveClass, Opening, PositionEval } from './types'

/** Opening lookup by EPD: a named opening, '' for a known book position with no name of its own. */
export type OpeningBook = (fen: string) => Opening | '' | undefined

// Win-% thresholds (expected-points model). First match wins, in the order used below.
export const THRESHOLDS = {
  excellent: 2,
  good: 5,
  inaccuracy: 10,
  mistake: 20,
  /** A move is "the only move" when the runner-up is at least this much worse... */
  onlyMoveGap: 12,
  /** ...and would leave the mover below this win-% (so it changes the outcome, not just the margin). */
  onlyMoveCeiling: 80,
  /** Opponent's error (and my own slip) must be at least this big to call a Miss. */
  miss: 10,
  /** Pawns of material given up, still down after the opponent takes and I reply. */
  sacrifice: 2,
}

/** Kill-switch: Brilliant detection is heuristic. Turn off if it ever spams. */
export const DETECT_BRILLIANT = true

const forMover = (winWhite: number, side: 'w' | 'b') => (side === 'w' ? winWhite : 100 - winWhite)

function cpForMover(score: Score, side: 'w' | 'b'): number {
  const white = score.type === 'mate' ? (score.value > 0 ? 1000 : -1000) : Math.max(-1000, Math.min(1000, score.value))
  return side === 'w' ? white : -white
}

function sanOf(fen: string, uci: string): string | undefined {
  try {
    return new Chess(fen).move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] }).san
  } catch {
    return undefined
  }
}

/**
 * A real sacrifice: following the engine's expected continuation after the move (opponent's
 * reply, then mine), the mover is still at least `sacrifice` pawns down compared with before.
 */
function isSacrifice(ply: PlyRecord, after: PositionEval): boolean {
  if (after.pv.length < 2) return false
  const sign = ply.color === 'w' ? 1 : -1
  const before = materialBalance(ply.fenBefore) * sign
  try {
    const c = new Chess(ply.fenAfter)
    for (const uci of after.pv.slice(0, 2)) c.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] })
    return materialBalance(c.fen()) * sign <= before - THRESHOLDS.sacrifice
  } catch {
    return false
  }
}

function classifyByLoss(loss: number): MoveClass {
  if (loss <= THRESHOLDS.excellent) return 'excellent'
  if (loss <= THRESHOLDS.good) return 'good'
  if (loss <= THRESHOLDS.inaccuracy) return 'inaccuracy'
  if (loss <= THRESHOLDS.mistake) return 'mistake'
  return 'blunder'
}

/**
 * Turns per-position engine evals into per-move labels. `evals[i]` is the position before
 * ply i+1, so there must be plies.length + 1 of them.
 */
export function classifyGame(plies: PlyRecord[], evals: PositionEval[], book?: OpeningBook): GameAnalysis {
  if (evals.length !== plies.length + 1) throw new Error(`expected ${plies.length + 1} evals, got ${evals.length}`)

  const moves: AnalyzedPly[] = []
  let opening: Opening | undefined
  let bookPlies = 0
  let inBook = book !== undefined

  plies.forEach((ply, i) => {
    const before = evals[i]
    const after = evals[i + 1]
    const side = ply.color
    const winBefore = forMover(before.winWhite, side)
    const winAfter = forMover(after.winWhite, side)
    const playedBest = before.best === ply.uci

    // The engine's own first choice cannot lose anything; any gap is search noise between depths.
    const winLoss = playedBest ? 0 : Math.max(0, winBefore - winAfter)
    const cpl = playedBest ? 0 : Math.max(0, cpForMover(before.score, side) - cpForMover(after.score, side))

    let classification: MoveClass
    const bookHit = inBook ? book!(ply.fenAfter) : undefined
    if (bookHit !== undefined) {
      classification = 'book'
      bookPlies = ply.ply
      if (bookHit) opening = bookHit
    } else {
      inBook = false
      classification = classify()
    }

    function classify(): MoveClass {
      const prev = moves[i - 1]
      const secondWin = before.second ? forMover(before.second.winWhite, side) : undefined
      const onlyMove =
        secondWin !== undefined &&
        winBefore - secondWin >= THRESHOLDS.onlyMoveGap &&
        secondWin < THRESHOLDS.onlyMoveCeiling
      const recapture = prev !== undefined && plies[i - 1].captured && ply.captured && prev.uci.slice(2, 4) === ply.uci.slice(2, 4)

      if (winLoss <= THRESHOLDS.excellent) {
        // No credit for giving material away when already completely winning, unless it forces mate.
        const forcesMate = after.score.type === 'mate' && (after.score.value > 0) === (side === 'w') && after.score.value !== 0
        if (DETECT_BRILLIANT && winAfter >= 50 && (winBefore <= 95 || forcesMate) && isSacrifice(ply, after)) return 'brilliant'
        if (playedBest && onlyMove && !recapture && winBefore > 5 && winBefore < 97) return 'great'
        if (playedBest || winLoss <= 0.5) return 'best'
      }
      // Miss: the opponent just erred and I let them off the hook, without actually ending up worse.
      if (
        prev !== undefined &&
        prev.classification !== 'book' &&
        prev.winLoss >= THRESHOLDS.miss &&
        winLoss >= THRESHOLDS.miss &&
        winAfter >= 40
      ) {
        return 'miss'
      }
      return classifyByLoss(winLoss)
    }

    moves.push({
      ply: ply.ply,
      san: ply.san,
      uci: ply.uci,
      side,
      fenBefore: ply.fenBefore,
      fenAfter: ply.fenAfter,
      classification,
      winLoss,
      cpl,
      accuracy: moveAccuracy(winLoss),
      winBefore,
      winAfter,
      bestUci: before.best,
      bestSan: before.best ? sanOf(ply.fenBefore, before.best) : undefined,
    })
  })

  const accuracyFor = (side: 'w' | 'b') =>
    gameAccuracy(moves.filter((m) => m.side === side && m.classification !== 'book').map((m) => m.accuracy))
  const accuracy = { w: accuracyFor('w'), b: accuracyFor('b') }

  return {
    moves,
    accuracy,
    estimatedElo: { w: estimateElo(accuracy.w), b: estimateElo(accuracy.b) },
    opening,
    bookPlies,
  }
}
