import type { PositionEval } from '../../review/types'
import { formatScore } from './classMeta'

interface Props {
  evaluation?: PositionEval
  orientation: 'white' | 'black'
}

export function EvalBar({ evaluation, orientation }: Props) {
  const win = evaluation?.winWhite ?? 50
  const whiteAhead = win >= 50
  return (
    <div className={`eval-bar ${orientation}`} title="Engine evaluation (White's winning chances)">
      <div className="eval-white" style={{ height: `${win}%` }} />
      {evaluation && (
        <span className={`eval-label ${whiteAhead ? 'on-white' : 'on-black'}`}>
          {formatScore(evaluation.score, evaluation.winWhite).replace(/^[+−]/, '')}
        </span>
      )}
    </div>
  )
}
