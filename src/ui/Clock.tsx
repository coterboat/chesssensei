import { useEffect, useState } from 'react'
import { formatClock, remaining, type ClockState } from '../chess/clock'
import type { Color } from '../chess/gameController'

export function Clock({ clock, side, label }: { clock: ClockState; side: Color; label: string }) {
  const [, tick] = useState(0)
  const running = clock.running === side
  useEffect(() => {
    if (!running) return
    const id = setInterval(() => tick((n) => n + 1), 100)
    return () => clearInterval(id)
  }, [running])

  const left = remaining(clock, side, Date.now())
  return (
    <div className={`clock${running ? ' running' : ''}${left < 20_000 ? ' low' : ''}`}>
      <span>{label}</span>
      <strong>{formatClock(left)}</strong>
    </div>
  )
}
