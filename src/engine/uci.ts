// Pure UCI text parsing. Scores are always relative to the side to move, as Stockfish reports them.

export interface Score {
  type: 'cp' | 'mate'
  /** Centipawns, or moves-to-mate (negative = side to move gets mated). */
  value: number
}

export interface InfoLine {
  depth: number
  multipv: number
  score: Score
  bound?: 'lower' | 'upper'
  pv: string[]
}

export interface BestMove {
  /** null when the position has no legal moves ("bestmove (none)"). */
  bestmove: string | null
  ponder?: string
}

export function parseInfo(line: string): InfoLine | null {
  if (!line.startsWith('info ')) return null
  const t = line.split(/\s+/)
  let depth: number | undefined
  let multipv = 1
  let score: Score | undefined
  let bound: InfoLine['bound']
  let pv: string[] = []

  for (let i = 1; i < t.length; i++) {
    switch (t[i]) {
      case 'string':
        return null
      case 'depth':
        depth = Number(t[++i])
        break
      case 'multipv':
        multipv = Number(t[++i])
        break
      case 'score': {
        const type = t[++i]
        const value = Number(t[++i])
        if ((type !== 'cp' && type !== 'mate') || Number.isNaN(value)) return null
        score = { type, value }
        if (t[i + 1] === 'lowerbound') (bound = 'lower'), i++
        else if (t[i + 1] === 'upperbound') (bound = 'upper'), i++
        break
      }
      case 'pv':
        pv = t.slice(i + 1)
        i = t.length
        break
    }
  }
  if (depth === undefined || !score || pv.length === 0) return null
  return { depth, multipv, score, bound, pv }
}

export function parseBestMove(line: string): BestMove | null {
  if (!line.startsWith('bestmove')) return null
  const t = line.split(/\s+/)
  const bestmove = !t[1] || t[1] === '(none)' ? null : t[1]
  const ponder = t[2] === 'ponder' && t[3] && t[3] !== '(none)' ? t[3] : undefined
  return { bestmove, ponder }
}

/** Collapses a score to centipawns, mapping mates to ±(10000 − n) so nearer mates rank higher. */
export function scoreToCp(score: Score): number {
  if (score.type === 'cp') return score.value
  return score.value > 0 ? 10000 - score.value : -10000 - score.value
}
