import { useEffect, useMemo } from 'react'
import { inspectFen, type GameStatus } from '../chess/gameController'
import { useStore } from '../state/store'
import { Board } from './Board'
import { MoveList } from './MoveList'
import { PromotionPicker } from './PromotionPicker'

const TERMINATION_TEXT: Record<NonNullable<GameStatus['termination']>, string> = {
  checkmate: 'Checkmate',
  stalemate: 'Stalemate',
  threefold: 'Draw by repetition',
  'fifty-move': 'Draw by fifty-move rule',
  insufficient: 'Draw by insufficient material',
}

function statusText(status: GameStatus, turn: 'w' | 'b', inCheck: boolean): string {
  if (status.over && status.termination) return `${TERMINATION_TEXT[status.termination]} · ${status.result}`
  return `${turn === 'w' ? 'White' : 'Black'} to move${inCheck ? ' — check' : ''}`
}

export function PlayScreen() {
  const s = useStore()
  const { game, viewPly } = s
  const live = viewPly === null
  const currentPly = viewPly ?? game.history.length

  // Position shown on the board: the live game, or a read-only preview of a past ply.
  const shown = useMemo(() => {
    if (live) return { fen: game.fen, turn: game.turn, inCheck: game.inCheck, lastMove: game.lastMove }
    const rec = game.history[currentPly - 1]
    const fen = rec ? rec.fenAfter : game.history[0].fenBefore
    const lastMove = rec ? ([rec.uci.slice(0, 2), rec.uci.slice(2, 4)] as [string, string]) : undefined
    return { fen, lastMove, ...inspectFen(fen) }
  }, [live, game, currentPly])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return
      if (e.key === 'ArrowLeft') s.stepView(-1)
      else if (e.key === 'ArrowRight') s.stepView(1)
      else if (e.key === 'ArrowUp') s.setViewPly(0)
      else if (e.key === 'ArrowDown') s.setViewPly(null)
      else if (e.key === 'f') s.flip()
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [s])

  return (
    <main className="play">
      <section className="board-col">
        <div className="board-frame">
          <Board
            fen={shown.fen}
            orientation={s.orientation}
            turn={shown.turn}
            inCheck={shown.inCheck}
            lastMove={shown.lastMove}
            dests={game.dests}
            movable={live && !game.status.over ? 'both' : undefined}
            rev={s.boardRev}
            onMove={s.userMove}
          />
          {s.pendingPromotion && (
            <PromotionPicker
              color={s.pendingPromotion.color}
              square={s.pendingPromotion.to}
              orientation={s.orientation}
              onPick={s.choosePromotion}
              onCancel={s.cancelPromotion}
            />
          )}
        </div>
      </section>

      <aside className="side">
        <div className={`status${game.status.over ? ' over' : ''}`} data-testid="status">
          {statusText(game.status, game.turn, game.inCheck)}
        </div>
        <MoveList history={game.history} currentPly={currentPly} onSelect={s.setViewPly} />
        {!live && (
          <button className="btn back-live" onClick={() => s.setViewPly(null)}>
            Viewing move {currentPly} of {game.history.length} — back to live
          </button>
        )}
        <div className="controls">
          <button className="btn" onClick={() => s.newGame()}>New game</button>
          <button className="btn" onClick={s.undo} disabled={game.history.length === 0}>Undo</button>
          <button className="btn" onClick={s.flip}>Flip</button>
        </div>
        <details className="fen-box">
          <summary>Position</summary>
          <input readOnly value={shown.fen} onFocus={(e) => e.target.select()} aria-label="Current FEN" />
          <form
            onSubmit={(e) => {
              e.preventDefault()
              const input = e.currentTarget.elements.namedItem('fen') as HTMLInputElement
              try {
                s.newGame(input.value.trim())
                input.value = ''
              } catch {
                input.setCustomValidity('Invalid FEN')
                input.reportValidity()
              }
            }}
          >
            <input name="fen" placeholder="Paste FEN to start from…" onInput={(e) => e.currentTarget.setCustomValidity('')} />
            <button className="btn" type="submit">Load</button>
          </form>
        </details>
      </aside>
    </main>
  )
}
