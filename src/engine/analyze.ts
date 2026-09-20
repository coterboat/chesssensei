import { Chess } from 'chess.js'
import { winPercent } from '../review/winprob'
import type { PositionEval } from '../review/types'
import type { Engine } from './engine'
import type { InfoLine, Score } from './uci'

export const ANALYSIS_LIMITS = { depth: 16, movetime: 400 }
export const ANALYSIS_MULTIPV = 2
const ANALYSIS_HASH_MB = 64

/** Flips a side-to-move-relative score to White's point of view. The ONLY place this happens. */
export function toWhite(score: Score, turn: 'w' | 'b'): Score {
  return turn === 'w' ? score : { type: score.type, value: -score.value }
}

function fromLine(line: InfoLine, turn: 'w' | 'b') {
  const score = toWhite(line.score, turn)
  return { score, winWhite: winPercent(score) }
}

/** Positions the engine can't (or needn't) search: mate, stalemate, dead draws. */
export function terminalEval(fen: string): PositionEval | null {
  const c = new Chess(fen)
  if (c.isCheckmate()) {
    const whiteMated = c.turn() === 'w'
    return { fen, score: { type: 'mate', value: 0 }, winWhite: whiteMated ? 0 : 100, depth: 0, pv: [] }
  }
  if (c.isStalemate() || c.isInsufficientMaterial()) {
    return { fen, score: { type: 'cp', value: 0 }, winWhite: 50, depth: 0, pv: [] }
  }
  return null
}

export async function analyzePosition(engine: Engine, fen: string): Promise<PositionEval> {
  const terminal = terminalEval(fen)
  if (terminal) return terminal

  const turn = fen.split(' ')[1] as 'w' | 'b'
  const res = await engine.search(fen, ANALYSIS_LIMITS, ANALYSIS_MULTIPV)
  const [first, second] = res.lines
  if (!first) throw new Error(`no analysis for ${fen}`)
  return {
    fen,
    ...fromLine(first, turn),
    depth: first.depth,
    best: first.pv[0],
    pv: first.pv,
    second: second ? { uci: second.pv[0], ...fromLine(second, turn) } : undefined,
  }
}

export interface AnalyzeOptions {
  /** Evals already computed (resume after an interrupted run); null/undefined = still to do. */
  partial?: (PositionEval | null | undefined)[]
  onProgress?: (done: number, total: number, evals: (PositionEval | null)[]) => void
  shouldCancel?: () => boolean
}

/**
 * Evaluates every position of a game exactly once (N plies → N+1 positions), last to first so
 * the hash table carries what the engine learned about the future into earlier positions.
 * Returns null if cancelled.
 */
export async function analyzePositions(engine: Engine, fens: string[], opts: AnalyzeOptions = {}): Promise<PositionEval[] | null> {
  const evals: (PositionEval | null)[] = fens.map((fen, i) => {
    const prior = opts.partial?.[i]
    return prior && prior.fen === fen ? prior : null
  })
  let done = evals.filter(Boolean).length

  await engine.setOptions({ UCI_LimitStrength: false, Hash: ANALYSIS_HASH_MB })
  await engine.newGame()

  for (let i = fens.length - 1; i >= 0; i--) {
    if (evals[i]) continue
    if (opts.shouldCancel?.()) return null
    evals[i] = await analyzePosition(engine, fens[i])
    opts.onProgress?.(++done, fens.length, evals)
  }
  return evals as PositionEval[]
}
