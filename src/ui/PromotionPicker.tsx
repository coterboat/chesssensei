import { useEffect } from 'react'
import type { Color, PromotionPiece } from '../chess/gameController'

const PIECES: [PromotionPiece, string][] = [
  ['q', 'queen'],
  ['n', 'knight'],
  ['r', 'rook'],
  ['b', 'bishop'],
]

interface Props {
  color: Color
  /** Destination square, e.g. "e8" — the picker hangs off this file. */
  square: string
  orientation: 'white' | 'black'
  onPick: (piece: PromotionPiece) => void
  onCancel: () => void
}

export function PromotionPicker({ color, square, orientation, onPick, onCancel }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel()
      const hit = PIECES.find(([p]) => p === e.key.toLowerCase())
      if (hit) onPick(hit[0])
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onPick, onCancel])

  const file = square.charCodeAt(0) - 97
  const col = orientation === 'white' ? file : 7 - file
  // The promoting pawn arrives at the top of the board when it is that side's orientation.
  const fromTop = (color === 'w') === (orientation === 'white')
  const colorName = color === 'w' ? 'white' : 'black'

  return (
    <div className="promo-backdrop" onClick={onCancel}>
      <div
        className="promo cg-wrap"
        style={{ left: `${col * 12.5}%`, [fromTop ? 'top' : 'bottom']: 0 }}
        onClick={(e) => e.stopPropagation()}
      >
        {(fromTop ? PIECES : [...PIECES].reverse()).map(([p, name]) => (
          // Chessground's piece sprites are keyed on a literal <piece> tag, which React can't render directly.
          <button
            key={p}
            className="promo-btn"
            aria-label={`Promote to ${name}`}
            onClick={() => onPick(p)}
            dangerouslySetInnerHTML={{ __html: `<piece class="${name} ${colorName}"></piece>` }}
          />
        ))}
      </div>
    </div>
  )
}
