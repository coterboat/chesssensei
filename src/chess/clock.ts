import type { Color } from './gameController'

export interface TimeControl {
  id: string
  label: string
  /** Starting time per side in ms; 0 = no clock. */
  base: number
  increment: number
}

export const TIME_CONTROLS: TimeControl[] = [
  { id: 'off', label: 'No clock', base: 0, increment: 0 },
  { id: '5+0', label: '5 min', base: 5 * 60_000, increment: 0 },
  { id: '10+0', label: '10 min', base: 10 * 60_000, increment: 0 },
  { id: '15+10', label: '15 | 10', base: 15 * 60_000, increment: 10_000 },
]

export const timeControl = (id: string): TimeControl => TIME_CONTROLS.find((t) => t.id === id) ?? TIME_CONTROLS[0]

export interface ClockState {
  w: number
  b: number
  /** Side whose clock is counting down, and when it started (epoch ms). null = stopped. */
  running: Color | null
  since: number
}

export function newClock(tc: TimeControl): ClockState | null {
  return tc.base > 0 ? { w: tc.base, b: tc.base, running: null, since: 0 } : null
}

/** Time left for a side right now, without mutating anything. */
export function remaining(clock: ClockState, side: Color, now: number): number {
  const spent = clock.running === side ? now - clock.since : 0
  return Math.max(0, clock[side] - spent)
}

/** `mover` just moved: bank their elapsed time, add the increment, start the other clock. */
export function press(clock: ClockState, mover: Color, increment: number, now: number): ClockState {
  const left = remaining(clock, mover, now)
  const next: ClockState = { ...clock, [mover]: left + increment }
  return { ...next, running: mover === 'w' ? 'b' : 'w', since: now }
}

export function stop(clock: ClockState, now: number): ClockState {
  if (!clock.running) return clock
  return { ...clock, [clock.running]: remaining(clock, clock.running, now), running: null }
}

export function formatClock(ms: number): string {
  const total = Math.max(0, ms)
  if (total < 20_000) return `${Math.floor(total / 1000)}.${Math.floor((total % 1000) / 100)}`
  const s = Math.ceil(total / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}
