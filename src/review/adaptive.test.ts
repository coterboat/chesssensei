import { describe, expect, it } from 'vitest'
import { expectedScore, kFactor, nextBotElo, qualityNudge, unratedReason, updateRating } from './adaptive'

describe('adaptive rating', () => {
  it('expected score is 0.5 for equal ratings and ~0.41 at +60', () => {
    expect(expectedScore(1500, 1500)).toBe(0.5)
    expect(expectedScore(1500, 1560)).toBeCloseTo(0.414, 2)
  })

  it('moves up on a win, down on a loss, and draws against a stronger bot gain', () => {
    expect(updateRating(1500, 1500, 1, 0)).toBe(1520)
    expect(updateRating(1500, 1500, 0, 0)).toBe(1480)
    expect(updateRating(1500, 1500, 0.5, 0)).toBe(1500)
    expect(updateRating(1500, 1700, 0.5, 0)).toBeGreaterThan(1500)
  })

  it('switches K from 40 to 24 after ten games', () => {
    expect(kFactor(9)).toBe(40)
    expect(kFactor(10)).toBe(24)
    expect(updateRating(1500, 1500, 1, 10)).toBe(1512)
  })

  it('clamps to the rating range', () => {
    expect(updateRating(2795, 2000, 1, 0)).toBeLessThanOrEqual(2800)
    expect(updateRating(205, 2000, 0, 0)).toBeGreaterThanOrEqual(200)
  })

  it('quality nudge is bounded and ignored for short games', () => {
    expect(qualityNudge(95, 75, 60)).toBe(10)
    expect(qualityNudge(40, 75, 60)).toBe(-10)
    expect(qualityNudge(79, 75, 60)).toBe(2)
    expect(qualityNudge(95, 75, 12)).toBe(0)
  })

  it('next bot sits offset above the player, within engine limits', () => {
    expect(nextBotElo(1500, 60, 400, 2200)).toBe(1560)
    expect(nextBotElo(2190, 200, 400, 2200)).toBe(2200)
    expect(nextBotElo(250, 0, 400, 2200)).toBe(400)
  })
})

describe('unratedReason', () => {
  const base = { vsEngine: true, takebacks: 0, fromStartPosition: true, plies: 60, termination: 'checkmate' }
  it('rates a normal game', () => expect(unratedReason(base)).toBeNull())
  it('rejects takebacks, custom positions and human games', () => {
    expect(unratedReason({ ...base, takebacks: 1 })).toMatch(/takeback/)
    expect(unratedReason({ ...base, fromStartPosition: false })).toMatch(/position/)
    expect(unratedReason({ ...base, vsEngine: false })).toMatch(/bot/)
  })
  it('rejects early resignations but rates a quick checkmate', () => {
    expect(unratedReason({ ...base, plies: 6, termination: 'resign' })).toMatch(/10 moves/)
    expect(unratedReason({ ...base, plies: 7, termination: 'checkmate' })).toBeNull()
  })
})
