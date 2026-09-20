import { describe, expect, it } from 'vitest'
import { movetimeFor, sampleMove, temperatureFor } from './play'
import type { InfoLine } from './uci'

const line = (move: string, cp: number, multipv = 1): InfoLine => ({ depth: 8, multipv, score: { type: 'cp', value: cp }, pv: [move] })
const mate = (move: string, n: number): InfoLine => ({ depth: 8, multipv: 1, score: { type: 'mate', value: n }, pv: [move] })

function seeded(seed = 1) {
  let s = seed
  return () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296)
}

function frequencies(lines: InfoLine[], temperature: number, n = 4000) {
  const rng = seeded()
  const counts: Record<string, number> = {}
  for (let i = 0; i < n; i++) {
    const m = sampleMove(lines, { temperature }, rng).pv[0]
    counts[m] = (counts[m] ?? 0) + 1
  }
  return counts
}

describe('sampleMove', () => {
  const lines = [line('best', 40), line('ok', -20), line('hang', -500)]

  it('plays the best move almost always at very low temperature', () => {
    expect(frequencies(lines, 0.05).best).toBe(4000)
  })

  it('blunders more as temperature rises, but still prefers better moves', () => {
    const cold = frequencies(lines, 2)
    const hot = frequencies(lines, 14)
    expect(hot.hang ?? 0).toBeGreaterThan(cold.hang ?? 0)
    expect(hot.best).toBeGreaterThan(hot.ok)
    expect(hot.ok).toBeGreaterThan(hot.hang)
  })

  it('takes mate in one when asked to', () => {
    const l = [line('a', 300), mate('m', 1), line('b', 0)]
    const rng = seeded()
    for (let i = 0; i < 200; i++) expect(sampleMove(l, { temperature: 50, takeMateInOne: true }, rng).pv[0]).toBe('m')
  })

  it('avoids allowing mate in one when any alternative exists', () => {
    const l = [line('a', -300), mate('suicide', -1)]
    const rng = seeded()
    for (let i = 0; i < 200; i++) expect(sampleMove(l, { temperature: 50, avoidMatedInOne: true }, rng).pv[0]).toBe('a')
    expect(sampleMove([mate('forced', -1)], { temperature: 5, avoidMatedInOne: true }, rng).pv[0]).toBe('forced')
  })
})

describe('strength mapping', () => {
  it('interpolates temperature and decreases with Elo', () => {
    const pts = [{ elo: 400, temperature: 10 }, { elo: 800, temperature: 6 }]
    expect(temperatureFor(600, pts)).toBe(8)
    expect(temperatureFor(100, pts)).toBe(10)
    expect(temperatureFor(2000, pts)).toBe(6)
    expect(temperatureFor(400)).toBeGreaterThan(temperatureFor(1200))
  })
  it('scales movetime from 300 to 800 ms', () => {
    expect(movetimeFor(1350)).toBeGreaterThanOrEqual(300)
    expect(movetimeFor(2200)).toBe(800)
  })
})
