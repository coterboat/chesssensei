import type { Score } from '../../engine/uci'
import type { MoveClass } from '../../review/types'

export interface ClassMeta {
  label: string
  symbol: string
  color: string
}

export const CLASS_META: Record<MoveClass, ClassMeta> = {
  brilliant: { label: 'Brilliant', symbol: '!!', color: '#1baca6' },
  great: { label: 'Great', symbol: '!', color: '#5c8bb0' },
  best: { label: 'Best', symbol: '★', color: '#81b64c' },
  excellent: { label: 'Excellent', symbol: '✓', color: '#81b64c' },
  good: { label: 'Good', symbol: '✓', color: '#77915f' },
  book: { label: 'Book', symbol: '≡', color: '#a88865' },
  inaccuracy: { label: 'Inaccuracy', symbol: '?!', color: '#f0c15c' },
  mistake: { label: 'Mistake', symbol: '?', color: '#e6912c' },
  miss: { label: 'Miss', symbol: '×', color: '#ee6b55' },
  blunder: { label: 'Blunder', symbol: '??', color: '#ca3431' },
}

/** Order of rows in the summary table. */
export const SUMMARY_ORDER: MoveClass[] = ['brilliant', 'great', 'best', 'excellent', 'good', 'book', 'inaccuracy', 'mistake', 'miss', 'blunder']

/** Classes worth a dot on the eval graph. */
export const NOTABLE: ReadonlySet<MoveClass> = new Set(['brilliant', 'great', 'inaccuracy', 'mistake', 'miss', 'blunder'])

/** White-POV score as "+1.3", "−0.4", "M3", "−M2". */
export function formatScore(score: Score, winWhite: number): string {
  if (score.type === 'mate') {
    if (score.value === 0) return winWhite >= 50 ? '1-0' : '0-1'
    return `${score.value < 0 ? '−' : ''}M${Math.abs(score.value)}`
  }
  const pawns = score.value / 100
  return `${pawns > 0 ? '+' : pawns < 0 ? '−' : ''}${Math.abs(pawns).toFixed(1)}`
}
