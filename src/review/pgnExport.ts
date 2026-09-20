import { Chess } from 'chess.js'
import type { GameAnalysis, PositionEval } from './types'

function evalTag(e: PositionEval): string {
  if (e.score.type === 'mate') return e.score.value === 0 ? '' : `[%eval #${e.score.value}] `
  return `[%eval ${(e.score.value / 100).toFixed(2)}] `
}

/** Re-emits the game with one comment per move: `{[%eval 0.35] Mistake. Best was Nf3. Accuracy 61.}` */
export function annotatedPgn(pgn: string, startFen: string, analysis: GameAnalysis, evals: PositionEval[]): string {
  const source = new Chess()
  source.loadPgn(pgn)
  const out = new Chess(startFen)
  for (const [k, v] of Object.entries(source.getHeaders())) out.setHeader(k, v)
  out.setHeader('Annotator', 'Chess Sensei (Stockfish)')
  out.setHeader('WhiteAccuracy', analysis.accuracy.w.toFixed(1))
  out.setHeader('BlackAccuracy', analysis.accuracy.b.toFixed(1))
  if (analysis.opening) {
    out.setHeader('ECO', analysis.opening.eco)
    out.setHeader('Opening', analysis.opening.name)
  }

  analysis.moves.forEach((m, i) => {
    out.move({ from: m.uci.slice(0, 2), to: m.uci.slice(2, 4), promotion: m.uci[4] })
    const label = m.classification[0].toUpperCase() + m.classification.slice(1)
    const best = m.bestSan && m.bestUci !== m.uci && m.classification !== 'book' ? ` Best was ${m.bestSan}.` : ''
    const acc = m.classification === 'book' ? '' : ` Accuracy ${Math.round(m.accuracy)}.`
    out.setComment(`${evalTag(evals[i + 1])}${label}.${best}${acc}`)
  })
  return out.pgn()
}
