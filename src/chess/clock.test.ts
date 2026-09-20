import { describe, expect, it } from 'vitest'
import { formatClock, newClock, press, remaining, stop, timeControl } from './clock'

describe('clock', () => {
  it('has no clock when the time control is off', () => {
    expect(newClock(timeControl('off'))).toBeNull()
    expect(newClock(timeControl('nonsense'))).toBeNull()
  })

  it('does not run until the first move, then charges the side to move', () => {
    let c = newClock(timeControl('5+0'))!
    expect(remaining(c, 'w', 99_999)).toBe(300_000)
    c = press(c, 'w', 0, 1_000) // White moves at t=1s; Black's clock starts
    expect(c.running).toBe('b')
    expect(remaining(c, 'b', 4_000)).toBe(297_000)
    expect(remaining(c, 'w', 4_000)).toBe(300_000)
    c = press(c, 'b', 0, 4_000)
    expect(c.b).toBe(297_000)
  })

  it('adds the increment after a move and never goes negative', () => {
    let c = newClock(timeControl('15+10'))!
    c = press(c, 'w', 10_000, 0)
    c = press(c, 'b', 10_000, 5_000)
    expect(c.b).toBe(900_000 - 5_000 + 10_000)
    expect(remaining({ ...c, w: 1_000, running: 'w', since: 0 }, 'w', 5_000)).toBe(0)
  })

  it('stop banks the running side', () => {
    const c = stop({ w: 10_000, b: 10_000, running: 'w', since: 0 }, 3_000)
    expect(c).toMatchObject({ w: 7_000, running: null })
  })

  it('formats minutes, and tenths under 20 seconds', () => {
    expect(formatClock(300_000)).toBe('5:00')
    expect(formatClock(61_500)).toBe('1:02')
    expect(formatClock(9_450)).toBe('9.4')
    expect(formatClock(-5)).toBe('0.0')
  })
})
