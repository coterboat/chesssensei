import type { GameRecord } from '../persist/db'
import type { MoveClass } from './types'

export type Phase = 'opening' | 'middlegame' | 'endgame'

const PIECE_VALUES: Record<string, number> = { n: 3, b: 3, r: 5, q: 9 }

/** Opening = first 12 moves; endgame = 13 or fewer points of pieces (no pawns/kings) left in total. */
export function phaseOf(fen: string, ply: number): Phase {
  let pieces = 0
  for (const ch of fen.split(' ')[0].toLowerCase()) pieces += PIECE_VALUES[ch] ?? 0
  if (pieces <= 13) return 'endgame'
  return ply <= 24 ? 'opening' : 'middlegame'
}

const ERRORS: ReadonlySet<MoveClass> = new Set(['inaccuracy', 'mistake', 'blunder', 'miss'])
const SERIOUS: ReadonlySet<MoveClass> = new Set(['mistake', 'blunder', 'miss'])

export interface Stats {
  games: number
  record: { wins: number; draws: number; losses: number }
  /** Player accuracy per game, oldest first. */
  accuracyTrend: number[]
  averageAccuracy: number
  /** Mistakes + blunders + misses per game. */
  seriousPerGame: number
  /** Share of the player's moves in each phase that were errors (0–1), with the counts behind it. */
  byPhase: Record<Phase, { moves: number; errors: number; rate: number }>
  worstPhase: Phase | null
}

/** Trends over the player's own analyzed bot games (imports and retries excluded). */
export function computeStats(records: GameRecord[], lastN = 30): Stats {
  const games = records
    .filter((g) => g.analysisComplete && g.analysis && !g.parentId && !g.imported)
    .sort((a, b) => a.createdAt - b.createdAt)
    .slice(-lastN)

  const record = { wins: 0, draws: 0, losses: 0 }
  const byPhase: Stats['byPhase'] = {
    opening: { moves: 0, errors: 0, rate: 0 },
    middlegame: { moves: 0, errors: 0, rate: 0 },
    endgame: { moves: 0, errors: 0, rate: 0 },
  }
  let serious = 0

  for (const g of games) {
    if (g.result === '1/2-1/2') record.draws++
    else if ((g.result === '1-0') === (g.playerColor === 'w')) record.wins++
    else record.losses++

    for (const m of g.analysis!.moves) {
      if (m.side !== g.playerColor || m.classification === 'book') continue
      const p = byPhase[phaseOf(m.fenBefore, m.ply)]
      p.moves++
      if (ERRORS.has(m.classification)) p.errors++
      if (SERIOUS.has(m.classification)) serious++
    }
  }
  for (const p of Object.values(byPhase)) p.rate = p.moves ? p.errors / p.moves : 0

  const accuracyTrend = games.map((g) => g.analysis!.accuracy[g.playerColor])
  const ranked = (Object.entries(byPhase) as [Phase, Stats['byPhase'][Phase]][]).filter(([, p]) => p.moves >= 10)
  return {
    games: games.length,
    record,
    accuracyTrend,
    averageAccuracy: accuracyTrend.length ? accuracyTrend.reduce((a, b) => a + b, 0) / accuracyTrend.length : 0,
    seriousPerGame: games.length ? serious / games.length : 0,
    byPhase,
    worstPhase: ranked.length ? ranked.sort((a, b) => b[1].rate - a[1].rate)[0][0] : null,
  }
}
