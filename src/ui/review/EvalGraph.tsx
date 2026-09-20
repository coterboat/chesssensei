import type { AnalyzedPly, PositionEval } from '../../review/types'
import { CLASS_META, NOTABLE } from './classMeta'

interface Props {
  evals: PositionEval[]
  moves: AnalyzedPly[]
  /** Position index currently on the board (0 = start). */
  current: number
  keyPlies: number[]
  onSelect: (ply: number) => void
}

const W = 600
const H = 120

/** White's winning chances over the game. Win-% scaled, so mates don't flatten everything else. */
export function EvalGraph({ evals, moves, current, keyPlies, onSelect }: Props) {
  const n = Math.max(evals.length - 1, 1)
  const x = (i: number) => (i / n) * W
  const y = (win: number) => (1 - win / 100) * H
  const curve = evals.map((e, i) => `${x(i).toFixed(1)},${y(e.winWhite).toFixed(1)}`).join(' L')

  return (
    <svg
      className="eval-graph"
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      role="img"
      aria-label="Evaluation graph. Click to jump to a move."
      onClick={(e) => {
        const box = e.currentTarget.getBoundingClientRect()
        onSelect(Math.round(((e.clientX - box.left) / box.width) * n))
      }}
    >
      <rect width={W} height={H} className="graph-bg" />
      <path d={`M0,${H} L${curve} L${W},${H} Z`} className="graph-white" />
      <line x1="0" x2={W} y1={H / 2} y2={H / 2} className="graph-mid" />
      {keyPlies.map((p) => (
        <line key={p} x1={x(p)} x2={x(p)} y1="0" y2={H} className="graph-key" />
      ))}
      <line x1={x(current)} x2={x(current)} y1="0" y2={H} className="graph-cursor" />
      {moves
        .filter((m) => NOTABLE.has(m.classification))
        .map((m) => (
          <circle
            key={m.ply}
            cx={x(m.ply)}
            cy={y(evals[m.ply].winWhite)}
            r="4"
            fill={CLASS_META[m.classification].color}
            className="graph-dot"
            vectorEffect="non-scaling-stroke"
          >
            <title>{`${Math.ceil(m.ply / 2)}${m.side === 'w' ? '.' : '…'} ${m.san} — ${CLASS_META[m.classification].label}`}</title>
          </circle>
        ))}
    </svg>
  )
}
