import { describe, expect, it } from 'vitest'
import type { GameRecord } from '../persist/db'
import { computeStats, phaseOf } from '../review/stats'
import type { AnalyzedPly, MoveClass } from '../review/types'
import { BOX_INTERVALS, MAX_BOX, RETRY_INTERVAL, dueCards, extractCards, grade, nextDue, type Card } from './deck'

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'
const AFTER_E4 = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1'

function move(ply: number, side: 'w' | 'b', classification: MoveClass, fenBefore = START, extra: Partial<AnalyzedPly> = {}): AnalyzedPly {
  return {
    ply, side, classification, fenBefore, fenAfter: AFTER_E4, san: 'a3', uci: 'a2a3', winLoss: 25, cpl: 300, accuracy: 30,
    winBefore: 60, winAfter: 35, bestUci: 'e2e4', bestSan: 'e4', ...extra,
  }
}

function record(moves: AnalyzedPly[], over: Partial<GameRecord> = {}): GameRecord {
  return {
    id: 'g1', createdAt: 1, playerColor: 'w', botElo: 1500, playerEloBefore: 1400, playerEloAfter: 1400, rated: true,
    timeControl: '-', result: '0-1', termination: 'checkmate', startFen: START, pgn: '', plies: [], analysisComplete: true,
    evals: Array.from({ length: moves.length + 1 }, () => ({ fen: START, score: { type: 'cp', value: 0 }, winWhite: 50, depth: 16, best: 'e2e4', pv: ['e2e4', 'e7e5'] })),
    analysis: { moves, accuracy: { w: 70, b: 80 }, estimatedElo: { w: 1000, b: 1500 }, bookPlies: 0 },
    ...over,
  }
}

describe('extractCards', () => {
  it("takes only the player's mistakes, blunders and misses", () => {
    const cards = extractCards(
      record([
        move(1, 'w', 'blunder'),
        move(2, 'b', 'blunder', AFTER_E4),
        move(3, 'w', 'inaccuracy', AFTER_E4.replace(' b ', ' w ')),
        move(5, 'w', 'miss', '8/8/8/8/8/8/8/K6k w - - 0 1'),
      ]),
      [],
      1000,
    )
    expect(cards.map((c) => c.ply)).toEqual([1, 5])
    expect(cards[0]).toMatchObject({ id: 'g1:1', box: 1, due: 1000, bestSan: 'e4', playedSan: 'a3', bestWin: 60, pv: ['e2e4', 'e7e5'] })
  })

  it('skips positions already in the deck and moves with no better alternative recorded', () => {
    const existing = extractCards(record([move(1, 'w', 'blunder')]))
    expect(extractCards(record([move(1, 'w', 'blunder')], { id: 'g2' }), existing)).toHaveLength(0)
    expect(extractCards(record([move(1, 'w', 'blunder', START, { bestUci: undefined })]))).toHaveLength(0)
    expect(extractCards(record([], { analysis: undefined }))).toHaveLength(0)
    expect(extractCards(record([move(1, 'w', 'blunder', START, { winBefore: 12 })]))).toHaveLength(0) // already lost
  })
})

describe('grade (Leitner)', () => {
  const card = extractCards(record([move(1, 'w', 'blunder')]), [], 0)[0]

  it('promotes on success with growing intervals, capped at the last box', () => {
    let c: Card = card
    for (let box = 2; box <= MAX_BOX; box++) {
      c = grade(c, true, 0)
      expect(c.box).toBe(box)
      expect(c.due).toBe(BOX_INTERVALS[box - 1])
    }
    expect(grade(c, true, 0).box).toBe(MAX_BOX)
    expect(c.attempts).toBe(MAX_BOX - 1)
    expect(c.correct).toBe(MAX_BOX - 1)
  })

  it('sends a miss back to box 1 and brings it back soon', () => {
    const high = { ...card, box: 4 }
    const c = grade(high, false, 1000)
    expect(c).toMatchObject({ box: 1, due: 1000 + RETRY_INTERVAL, attempts: 1, correct: 0 })
  })

  it('lists due cards most-overdue first and reports the next due time', () => {
    const cards = [{ ...card, id: 'a', due: 50 }, { ...card, id: 'b', due: 10 }, { ...card, id: 'c', due: 500 }]
    expect(dueCards(cards, 100).map((c) => c.id)).toEqual(['b', 'a'])
    expect(nextDue(cards, 100)).toBe(500)
    expect(nextDue([], 100)).toBeNull()
  })
})

describe('stats', () => {
  it('splits the game into phases by move number and remaining material', () => {
    expect(phaseOf(START, 5)).toBe('opening')
    expect(phaseOf(START, 40)).toBe('middlegame')
    expect(phaseOf('8/5k2/8/8/8/8/4K3/R7 w - - 0 1', 10)).toBe('endgame')
  })

  it('aggregates record, accuracy and error rates over own bot games only', () => {
    const middlegame = Array.from({ length: 12 }, (_, i) => move(31 + i * 2, 'w', i < 3 ? 'blunder' : 'best'))
    const s = computeStats([
      record(middlegame, { id: 'a', result: '1-0', createdAt: 1 }),
      record([move(1, 'w', 'best')], { id: 'b', result: '0-1', createdAt: 2, analysis: { moves: [move(1, 'w', 'best')], accuracy: { w: 90, b: 50 }, estimatedElo: { w: 2000, b: 400 }, bookPlies: 0 } }),
      record([move(1, 'w', 'blunder')], { id: 'imp', imported: { white: 'x', black: 'y' } }),
      record([move(1, 'w', 'blunder')], { id: 'retry', parentId: 'a' }),
    ])
    expect(s.games).toBe(2)
    expect(s.record).toEqual({ wins: 1, draws: 0, losses: 1 })
    expect(s.accuracyTrend).toEqual([70, 90])
    expect(s.seriousPerGame).toBe(1.5)
    expect(s.byPhase.middlegame).toMatchObject({ moves: 12, errors: 3, rate: 0.25 })
    expect(s.worstPhase).toBe('middlegame')
  })
})
