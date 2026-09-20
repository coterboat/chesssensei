import { describe, expect, it } from 'vitest'
import { parseBestMove, parseInfo, scoreToCp } from './uci'

describe('parseInfo', () => {
  it('parses a cp line with multipv and pv', () => {
    const l = parseInfo('info depth 16 seldepth 21 multipv 2 score cp -38 nodes 272568 nps 949714 time 287 pv e2e4 e7e5 g1f3')
    expect(l).toEqual({ depth: 16, multipv: 2, score: { type: 'cp', value: -38 }, bound: undefined, pv: ['e2e4', 'e7e5', 'g1f3'] })
  })

  it('parses mate scores, including getting mated', () => {
    expect(parseInfo('info depth 5 score mate 3 pv a1a2')?.score).toEqual({ type: 'mate', value: 3 })
    expect(parseInfo('info depth 5 score mate -1 pv a1a2')?.score).toEqual({ type: 'mate', value: -1 })
  })

  it('records bounds and defaults multipv to 1', () => {
    const l = parseInfo('info depth 18 multipv 1 score cp 29 upperbound nodes 405243 pv e2e4 e7e5')
    expect(l?.bound).toBe('upper')
    expect(parseInfo('info depth 3 score cp 10 lowerbound pv e2e4')?.multipv).toBe(1)
  })

  it('ignores lines with no score or pv', () => {
    expect(parseInfo('info string NNUE evaluation enabled')).toBeNull()
    expect(parseInfo('info depth 10 currmove e2e4 currmovenumber 1')).toBeNull()
    expect(parseInfo('bestmove e2e4')).toBeNull()
  })
})

describe('parseBestMove', () => {
  it('parses bestmove with and without ponder', () => {
    expect(parseBestMove('bestmove e2e4 ponder e7e5')).toEqual({ bestmove: 'e2e4', ponder: 'e7e5' })
    expect(parseBestMove('bestmove e7e8q')).toEqual({ bestmove: 'e7e8q', ponder: undefined })
  })
  it('maps (none) to null', () => {
    expect(parseBestMove('bestmove (none)')).toEqual({ bestmove: null, ponder: undefined })
  })
})

describe('scoreToCp', () => {
  it('ranks faster mates higher and being mated lowest', () => {
    expect(scoreToCp({ type: 'mate', value: 1 })).toBeGreaterThan(scoreToCp({ type: 'mate', value: 4 }))
    expect(scoreToCp({ type: 'mate', value: 4 })).toBeGreaterThan(scoreToCp({ type: 'cp', value: 900 }))
    expect(scoreToCp({ type: 'mate', value: -1 })).toBeLessThan(scoreToCp({ type: 'mate', value: -4 }))
  })
})
