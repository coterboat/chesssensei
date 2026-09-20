import { describe, expect, it } from 'vitest'
import { GameController } from '../chess/gameController'
import { bookFromTable, epd } from '../chess/openings'
import { terminalEval, toWhite } from '../engine/analyze'
import type { Score } from '../engine/uci'
import { gameAccuracy, moveAccuracy } from './accuracy'
import { classifyGame } from './classify'
import type { PositionEval } from './types'
import { winPercent } from './winprob'

/** Builds a position eval from a White-POV score. */
function ev(fen: string, score: Score | number, best?: string, second?: [string, number], pv?: string[]): PositionEval {
  const s: Score = typeof score === 'number' ? { type: 'cp', value: score } : score
  return {
    fen,
    score: s,
    winWhite: winPercent(s),
    depth: 16,
    best,
    pv: pv ?? (best ? [best] : []),
    second: second ? { uci: second[0], score: { type: 'cp', value: second[1] }, winWhite: winPercent({ type: 'cp', value: second[1] }) } : undefined,
  }
}

function game(ucis: string[], fen?: string) {
  const g = new GameController(fen)
  for (const u of ucis) if (!g.moveUci(u)) throw new Error(`bad move ${u}`)
  const plies = g.history()
  return { plies, fens: [plies[0].fenBefore, ...plies.map((p) => p.fenAfter)] }
}

/** cps[i] = White-POV eval of position i; bests[i] = engine best in position i. */
function classify(ucis: string[], cps: (number | Score)[], bests: (string | undefined)[] = [], fen?: string) {
  const { plies, fens } = game(ucis, fen)
  return classifyGame(plies, fens.map((f, i) => ev(f, cps[i], bests[i]))).moves
}

describe('accuracy', () => {
  it('is a function of win-% lost, not centipawns', () => {
    expect(moveAccuracy(0)).toBe(100)
    expect(moveAccuracy(5)).toBeGreaterThan(75)
    expect(moveAccuracy(50)).toBeLessThan(15)
  })
  it('punishes blunders more than a plain average would', () => {
    const accs = [100, 100, 100, 10]
    expect(gameAccuracy(accs)).toBeLessThan(77.5)
    expect(gameAccuracy([90, 90])).toBeCloseTo(90)
  })
})

describe('score normalization', () => {
  it('flips side-to-move scores to White POV only when Black is to move', () => {
    expect(toWhite({ type: 'cp', value: 120 }, 'w').value).toBe(120)
    expect(toWhite({ type: 'cp', value: 120 }, 'b').value).toBe(-120)
    expect(toWhite({ type: 'mate', value: 3 }, 'b')).toEqual({ type: 'mate', value: -3 })
  })
  it('synthesizes terminal positions', () => {
    const mated = terminalEval('r1bqkb1r/pppp1Qpp/2n2n2/4p3/2B1P3/8/PPPP1PPP/RNB1K1NR b KQkq - 0 4')
    expect(mated?.winWhite).toBe(100)
    expect(terminalEval('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1')?.winWhite).toBe(50)
    expect(terminalEval(new GameController().fen())).toBeNull()
  })
})

describe('classifyGame', () => {
  it('labels a hung queen as a blunder and the punishing capture as best', () => {
    // 1.e4 e5 2.Qh5 Nc6 3.Qxe5+?? Nxe5
    const m = classify(
      ['e2e4', 'e7e5', 'd1h5', 'b8c6', 'h5e5', 'c6e5'],
      [30, 30, 30, -20, -20, -900, -900],
      ['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1c4', 'c6e5'],
    )
    expect(m[4].classification).toBe('blunder')
    expect(m[4].side).toBe('w')
    expect(m[5].classification).toBe('best')
    expect(m[5].winLoss).toBe(0)
  })

  it('calls it a miss when a blunder goes unpunished', () => {
    // Same, but Black ignores the queen and the eval swings back to level.
    const m = classify(
      ['e2e4', 'e7e5', 'd1h5', 'b8c6', 'h5e5', 'f8e7'],
      [30, 30, 30, -20, -20, -900, 0],
      ['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1c4', 'c6e5'],
    )
    expect(m[5].classification).toBe('miss')
    expect(m[5].bestSan).toBe('Nxe5')
  })

  it('does not call a big centipawn drop a blunder when still completely winning', () => {
    const m = classify(['e2e4', 'e7e5', 'g1f3'], [900, 900, 900, 700], ['e2e4', 'e7e5', 'b1c3'])
    expect(m[2].cpl).toBe(200)
    expect(m[2].winLoss).toBeLessThan(5)
    expect(['excellent', 'good']).toContain(m[2].classification)
  })

  it('treats a slower mate as (nearly) free and being mated as total loss', () => {
    const m = classify(['e2e4', 'e7e5', 'g1f3'], [0, 0, { type: 'mate', value: 2 }, { type: 'mate', value: 5 }], [])
    expect(m[2].winLoss).toBe(0)
    const lost = classify(['e2e4', 'e7e5', 'g1f3'], [0, 0, 300, { type: 'mate', value: -3 }], [])
    expect(lost[2].classification).toBe('blunder')
  })

  it('marks the only good move as great, but not a routine recapture', () => {
    const { plies, fens } = game(['e2e4', 'd7d5', 'e4d5', 'd8d5'])
    const evals = fens.map((f) => ev(f, 20))
    evals[2] = ev(fens[2], 20, 'e4d5', ['b1c3', -250])
    evals[3] = ev(fens[3], 20, 'd8d5', ['g8f6', 300])
    const m = classifyGame(plies, evals).moves
    expect(m[2].classification).toBe('great')
    expect(m[3].classification).toBe('best') // only move, but it is just taking back
  })

  it('recognizes a sound sacrifice as brilliant', () => {
    // Legall-style: 5.Nxe5! leaves the queen hanging; after Bxd1 Bxf7+ White is a queen down but mating.
    const { plies, fens } = game(['e2e4', 'e7e5', 'g1f3', 'd7d6', 'f1c4', 'c8g4', 'b1c3', 'g7g6', 'f3e5'])
    const evals = fens.map((f) => ev(f, 30))
    evals[8] = ev(fens[8], 300, 'f3e5', ['h2h3', 40])
    evals[9] = ev(fens[9], 300, 'g4d1', undefined, ['g4d1', 'c4f7', 'e8e7', 'c3d5'])
    expect(classifyGame(plies, evals).moves[8].classification).toBe('brilliant')
  })

  it('tags book moves and the opening name, and stops at the first non-book move', () => {
    const { plies, fens } = game(['e2e4', 'e7e5', 'a2a3', 'g8f6'])
    const book = bookFromTable({
      [epd(fens[1])]: "B00|King's Pawn",
      [epd(fens[2])]: "C20|King's Pawn Game",
      [epd(fens[4])]: 'X99|Transposition that must not count',
    })
    const a = classifyGame(plies, fens.map((f) => ev(f, 20)), book)
    expect(a.moves.map((m) => m.classification)).toEqual(['book', 'book', 'best', 'best'])
    expect(a.opening?.name).toBe("King's Pawn Game")
    expect(a.bookPlies).toBe(2)
  })

  it("handles scholar's mate: mating move is best, accuracies computed per side", () => {
    const ucis = ['e2e4', 'e7e5', 'f1c4', 'b8c6', 'd1h5', 'g8f6', 'h5f7']
    const { plies, fens } = game(ucis)
    const evals = fens.map((f, i) => (i === 7 ? terminalEval(f)! : ev(f, i === 6 ? { type: 'mate', value: 1 } : 30, i === 6 ? 'h5f7' : undefined)))
    const a = classifyGame(plies, evals)
    expect(a.moves).toHaveLength(7)
    expect(a.moves[6].classification).toBe('best')
    expect(a.moves[5].classification).toBe('blunder') // Nf6?? allows mate
    expect(a.accuracy.w).toBeGreaterThan(a.accuracy.b)
  })

  it('rejects a mismatched eval count', () => {
    const { plies, fens } = game(['e2e4'])
    expect(() => classifyGame(plies, [ev(fens[0], 0)])).toThrow()
  })
})
