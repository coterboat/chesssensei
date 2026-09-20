import { describe, expect, it } from 'vitest'
import { GameController } from './gameController'

function play(g: GameController, ucis: string[]) {
  for (const u of ucis) expect(g.moveUci(u), `move ${u}`).not.toBeNull()
}

describe('GameController', () => {
  it('starts with 20 legal moves across 10 origin squares', () => {
    const g = new GameController()
    const dests = g.dests()
    expect(dests.size).toBe(10)
    expect([...dests.values()].flat().length).toBe(20)
  })

  it('rejects illegal moves without throwing and leaves state untouched', () => {
    const g = new GameController()
    const fen = g.fen()
    expect(g.move('e2', 'e5')).toBeNull()
    expect(g.move('e7', 'e5')).toBeNull()
    expect(g.fen()).toBe(fen)
  })

  it("detects scholar's mate", () => {
    const g = new GameController()
    play(g, ['e2e4', 'e7e5', 'f1c4', 'b8c6', 'd1h5', 'g8f6', 'h5f7'])
    expect(g.status()).toEqual({ over: true, result: '1-0', termination: 'checkmate' })
    expect(g.snapshot().dests.size).toBe(0)
    expect(g.history().at(-1)?.san).toBe('Qxf7#')
  })

  it('handles castling and en passant', () => {
    const g = new GameController()
    play(g, ['e2e4', 'a7a6', 'e4e5', 'd7d5', 'e5d6'])
    expect(g.history().at(-1)?.san).toBe('exd6')
    play(g, ['a6a5', 'g1f3', 'a5a4', 'f1e2', 'a4a3', 'e1g1'])
    expect(g.history().at(-1)?.san).toBe('O-O')
  })

  it('flags promotions and applies the chosen piece for both sides', () => {
    const w = new GameController('8/P6k/8/8/8/8/8/K7 w - - 0 1')
    expect(w.isPromotion('a7', 'a8')).toBe(true)
    expect(w.isPromotion('a1', 'a2')).toBe(false)
    expect(w.move('a7', 'a8', 'n')?.san).toBe('a8=N')

    const b = new GameController('k7/8/8/8/8/8/p6K/8 b - - 0 1')
    expect(b.isPromotion('a2', 'a1')).toBe(true)
    expect(b.move('a2', 'a1', 'q')?.san).toBe('a1=Q')
  })

  it('detects stalemate and threefold repetition', () => {
    expect(new GameController('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1').status().termination).toBe('stalemate')

    const g = new GameController()
    play(g, ['g1f3', 'g8f6', 'f3g1', 'f6g8', 'g1f3', 'g8f6', 'f3g1', 'f6g8'])
    expect(g.status().termination).toBe('threefold')
  })

  it('records fenBefore/fenAfter per ply and supports undo', () => {
    const g = new GameController()
    play(g, ['e2e4', 'e7e5'])
    const h = g.history()
    expect(h[1].fenBefore).toBe(h[0].fenAfter)
    expect(h[1].fenAfter).toBe(g.fen())
    g.undo()
    expect(g.fen()).toBe(h[0].fenAfter)
  })
})
