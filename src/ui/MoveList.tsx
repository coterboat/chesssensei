import { useEffect, useRef } from 'react'
import type { PlyRecord } from '../chess/gameController'

interface Props {
  history: PlyRecord[]
  /** Ply currently shown on the board (history.length when live). */
  currentPly: number
  onSelect: (ply: number) => void
}

export function MoveList({ history, currentPly, onSelect }: Props) {
  const active = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    active.current?.scrollIntoView({ block: 'nearest' })
  }, [currentPly, history.length])

  if (history.length === 0) return <div className="moves empty">No moves yet</div>

  const rows: PlyRecord[][] = []
  // A game loaded from a FEN with Black to move starts with a lone black ply.
  let i = 0
  if (history[0].color === 'b') rows.push([history[i++]])
  for (; i < history.length; i += 2) rows.push(history.slice(i, i + 2))
  const firstMoveNo = Number(history[0].fenBefore.split(' ')[5]) || 1

  const cell = (p: PlyRecord) => (
    <button
      key={p.ply}
      ref={p.ply === currentPly ? active : undefined}
      className={`san${p.ply === currentPly ? ' active' : ''}`}
      data-ply={p.ply}
      onClick={() => onSelect(p.ply)}
    >
      {p.san}
    </button>
  )

  return (
    <div className="moves">
      {rows.map((row, r) => (
        <div className="move-row" key={r}>
          <span className="move-no">{firstMoveNo + r}.</span>
          {row[0].color === 'b' && <span className="san placeholder">…</span>}
          {row.map(cell)}
        </div>
      ))}
    </div>
  )
}
