import { winPercent } from '../review/winprob'
import type { Engine } from './engine'
import table from './strengthTable.json'
import type { InfoLine, Score } from './uci'

/** Stockfish's UCI_Elo floor is 1320; below this we weaken the engine ourselves. */
export const UCI_ELO_MIN = 1350
export const BOT_ELO_MIN = 400
export const BOT_ELO_MAX = 2200

export type Rng = () => number

export interface BotMove {
  uci: string
  /** Engine's honest evaluation of the position (its best line), from the bot's point of view. */
  score: Score | null
}

/** Piecewise-linear lookup of sampling temperature (in win-% units) for a bot Elo. */
export function temperatureFor(elo: number, points = table.points): number {
  const pts = [...points].sort((a, b) => a.elo - b.elo)
  if (elo <= pts[0].elo) return pts[0].temperature
  for (let i = 1; i < pts.length; i++) {
    if (elo <= pts[i].elo) {
      const [a, b] = [pts[i - 1], pts[i]]
      return a.temperature + ((elo - a.elo) / (b.elo - a.elo)) * (b.temperature - a.temperature)
    }
  }
  return pts[pts.length - 1].temperature
}

export function movetimeFor(elo: number): number {
  return Math.round(300 + (500 * (Math.min(Math.max(elo, 1200), 2200) - 1200)) / 1000)
}

export interface SampleOptions {
  temperature: number
  /** Always play a mate in one when there is one. */
  takeMateInOne?: boolean
  /** Never choose a move that allows mate in one, if any alternative exists. */
  avoidMatedInOne?: boolean
}

/**
 * Human-ish error model: every legal move is a candidate, chosen with probability
 * ∝ exp(−winPercentLost / T). Low T ≈ engine best; high T hangs pieces now and then.
 */
export function sampleMove(lines: InfoLine[], opts: SampleOptions, rng: Rng = Math.random): InfoLine {
  if (lines.length === 0) throw new Error('no candidate moves')
  let candidates = lines
  const best = candidates.reduce((a, b) => (winScore(b) > winScore(a) ? b : a))

  if (opts.takeMateInOne && best.score.type === 'mate' && best.score.value === 1) return best
  if (opts.avoidMatedInOne) {
    const safe = candidates.filter((l) => !(l.score.type === 'mate' && l.score.value === -1))
    if (safe.length > 0) candidates = safe
  }

  const T = Math.max(opts.temperature, 0.01)
  const top = winScore(best)
  const weights = candidates.map((l) => Math.exp(-(top - winScore(l)) / T))
  const total = weights.reduce((a, b) => a + b, 0)
  let r = rng() * total
  for (let i = 0; i < candidates.length; i++) {
    r -= weights[i]
    if (r <= 0) return candidates[i]
  }
  return candidates[candidates.length - 1]
}

// Win% plus a tiny mate-distance tiebreak so mate in 1 outranks mate in 5.
function winScore(l: InfoLine): number {
  const w = winPercent(l.score)
  return l.score.type === 'mate' ? w - Math.sign(l.score.value) * l.score.value * 0.01 : w
}

function fullmoveNumber(fen: string): number {
  return Number(fen.split(' ')[5]) || 1
}

export interface BotOverrides {
  /** Sampling temperature to use instead of the table lookup (calibration). */
  temperature?: number
  movetime?: number
}

export async function chooseBotMove(
  engine: Engine,
  fen: string,
  elo: number,
  rng: Rng = Math.random,
  overrides: BotOverrides = {},
): Promise<BotMove> {
  if (elo >= UCI_ELO_MIN) {
    await engine.setOptions({ UCI_LimitStrength: true, UCI_Elo: Math.min(elo, 3190) })
    const res = await engine.search(fen, { movetime: overrides.movetime ?? movetimeFor(elo) })
    if (!res.bestmove) throw new Error('engine returned no move')
    return { uci: res.bestmove, score: res.lines[0]?.score ?? null }
  }

  await engine.setOptions({ UCI_LimitStrength: false })
  const res = await engine.search(fen, { depth: table.sampleDepth }, 256)
  if (res.lines.length === 0) {
    if (!res.bestmove) throw new Error('engine returned no move')
    return { uci: res.bestmove, score: null }
  }
  // Keep the first few moves sane so games don't open with nonsense.
  const base = overrides.temperature ?? temperatureFor(elo)
  const temperature = fullmoveNumber(fen) <= 4 ? Math.min(base, 1.5) : base
  const pick = sampleMove(res.lines, { temperature, takeMateInOne: elo >= 700, avoidMatedInOne: elo >= 900 }, rng)
  return { uci: pick.pv[0], score: res.lines[0].score }
}
