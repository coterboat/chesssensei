import type { Color } from '../chess/gameController'
import type { Score } from '../engine/uci'

export type MoveClass =
  | 'book'
  | 'brilliant'
  | 'great'
  | 'best'
  | 'excellent'
  | 'good'
  | 'inaccuracy'
  | 'mistake'
  | 'blunder'
  | 'miss'

/** Engine verdict on one position. Everything is from WHITE's point of view. */
export interface PositionEval {
  fen: string
  score: Score
  /** White's win probability, 0–100. */
  winWhite: number
  depth: number
  /** Best move and its principal variation (uci). Absent in terminal positions. */
  best?: string
  pv: string[]
  /** Second-best line, for "only move" detection. */
  second?: { uci: string; score: Score; winWhite: number }
}

export interface AnalyzedPly {
  ply: number
  san: string
  uci: string
  side: Color
  fenBefore: string
  fenAfter: string
  classification: MoveClass
  /** Win-% points given away by this move (mover's point of view). */
  winLoss: number
  /** Centipawns given away, capped at 1000. */
  cpl: number
  accuracy: number
  winBefore: number
  winAfter: number
  bestUci?: string
  bestSan?: string
}

export interface Opening {
  eco: string
  name: string
}

export interface GameAnalysis {
  moves: AnalyzedPly[]
  accuracy: { w: number; b: number }
  estimatedElo: { w: number; b: number }
  opening?: Opening
  /** Last ply that was still opening theory (0 = none). */
  bookPlies: number
}
