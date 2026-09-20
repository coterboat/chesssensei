import type { Score } from '../engine/uci'

/** Win probability (0–100) for the side the score is relative to. Lichess's logistic fit. */
export function winPercentFromCp(cp: number): number {
  const clamped = Math.max(-1000, Math.min(1000, cp))
  return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * clamped)) - 1)
}

export function winPercent(score: Score): number {
  if (score.type === 'mate') return score.value > 0 ? 100 : 0
  return winPercentFromCp(score.value)
}
