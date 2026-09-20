import { useEffect, useMemo, useState } from 'react'
import { inspectFen, type GameStatus } from '../chess/gameController'
import { useStore } from '../state/store'
import { TIME_CONTROLS } from '../chess/clock'
import { ENGINE_URL } from '../engine/engine'
import { Board } from './Board'
import { Clock } from './Clock'
import { HistoryDrawer } from './HistoryDrawer'
import { MoveList } from './MoveList'
import { PromotionPicker } from './PromotionPicker'

const TERMINATION_TEXT: Record<NonNullable<GameStatus['termination']>, string> = {
  checkmate: 'Checkmate',
  stalemate: 'Stalemate',
  threefold: 'Draw by repetition',
  'fifty-move': 'Draw by fifty-move rule',
  insufficient: 'Draw by insufficient material',
  resign: 'Resignation',
  'draw-agree': 'Draw agreed',
  time: 'Out of time',
}

const ELO_CHOICES = Array.from({ length: 19 }, (_, i) => 400 + i * 100)

const sideName = (c: 'w' | 'b') => (c === 'w' ? 'White' : 'Black')

function statusText(status: GameStatus, turn: 'w' | 'b', inCheck: boolean): string {
  if (status.over && status.termination) return `${TERMINATION_TEXT[status.termination]} · ${status.result}`
  return `${turn === 'w' ? 'White' : 'Black'} to move${inCheck ? ' — check' : ''}`
}

export function PlayScreen() {
  const s = useStore()
  const { viewPly, game, settings } = s
  const [historyOpen, setHistoryOpen] = useState(false)
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

  const vsEngine = s.opponent === 'engine'
  const bottomSide = s.orientation === 'white' ? 'w' : 'b'
  const topSide = bottomSide === 'w' ? 'b' : 'w'
  const movable =
    !live || game.status.over ? undefined : !vsEngine ? 'both' : s.playerColor === 'w' ? 'white' : 'black'

  useEffect(() => {
    if (!s.toast) return
    const id = setTimeout(() => s.setToast(null), 4000)
    return () => clearTimeout(id)
  }, [s.toast, s.setToast])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return
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
        {s.clock && <Clock clock={s.clock} side={topSide} label={topSide === s.playerColor || !vsEngine ? sideName(topSide) : `Bot ${s.botElo}`} />}
        <div className="board-frame">
          <Board
            fen={shown.fen}
            orientation={s.orientation}
            turn={shown.turn}
            inCheck={shown.inCheck}
            lastMove={shown.lastMove}
            dests={game.dests}
            movable={movable}
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
        {s.clock && <Clock clock={s.clock} side={bottomSide} label={bottomSide === s.playerColor && vsEngine ? 'You' : sideName(bottomSide)} />}
      </section>

      <aside className="side">
        <div className={`status${game.status.over ? ' over' : ''}`} data-testid="status">
          {statusText(game.status, game.turn, game.inCheck)}
          {s.thinking && <span className="thinking"> · thinking…</span>}
          {vsEngine && s.engineState === 'loading' && <span className="thinking"> · loading engine…</span>}
          {s.lastRating && !s.retry && (
            <div className="rating-change">
              {s.lastRating.unrated
                ? `Unrated — ${s.lastRating.unrated}`
                : `Rating ${s.lastRating.before} → ${s.lastRating.after} (${s.lastRating.after >= s.lastRating.before ? '+' : ''}${s.lastRating.after - s.lastRating.before})`}
            </div>
          )}
        </div>
        {vsEngine && s.engineState === 'failed' && (
          <div className="engine-error" role="alert">
            <strong>The chess engine didn't load.</strong>
            <span>Expected at <code>{ENGINE_URL}</code>. Run <code>npm install</code> to copy it into <code>public/stockfish/</code>.</span>
            <button className="btn" onClick={s.retryEngine}>Try again</button>
          </div>
        )}
        {s.retry && (
          <button className="btn back-live" onClick={() => s.openReview(s.retry!.parentId, s.retry!.ply)}>
            Retrying move {Math.ceil(s.retry.ply / 2)} — back to review
          </button>
        )}
        {s.lastGameId && !s.retry && (
          <button className="btn primary" onClick={() => s.openReview(s.lastGameId!)}>
            {s.analysisProgress?.id === s.lastGameId
              ? `Analyzing move ${Math.ceil(s.analysisProgress.done / 2)}/${Math.ceil(s.analysisProgress.total / 2)}… open review`
              : 'Review game'}
          </button>
        )}
        <MoveList history={game.history} currentPly={currentPly} onSelect={s.setViewPly} />
        {!live && (
          <button className="btn back-live" onClick={() => s.setViewPly(null)}>
            Viewing move {currentPly} of {game.history.length} — back to live
          </button>
        )}
        <div className="controls">
          <button className="btn" onClick={s.resign} disabled={game.status.over || game.history.length === 0}>Resign</button>
          <button className="btn" onClick={s.offerDraw} disabled={game.status.over || !vsEngine}>Offer draw</button>
          <button className="btn" onClick={s.takeback} disabled={game.status.over || game.history.length === 0 || s.clock !== null} title={s.clock ? 'No takebacks in timed games' : 'Makes the game unrated'}>Takeback</button>
          <button className="btn" onClick={s.flip} title="Flip board (f)">Flip</button>
          <button className="btn wide" onClick={() => setHistoryOpen(true)}>History ({s.savedGames.filter((g) => !g.parentId).length})</button>
        </div>
        <form
          className="setup"
          onSubmit={(e) => {
            e.preventDefault()
            const f = new FormData(e.currentTarget)
            const who = String(f.get('opponent'))
            if (who !== 'human') s.setBotLock(who === 'adaptive' ? null : Number(who))
            s.newGame({
              color: f.get('color') as 'w' | 'b' | 'random',
              opponent: who === 'human' ? 'human' : 'engine',
              timeControl: String(f.get('tc')),
            })
          }}
        >
          <label>
            Play as
            <select name="color" defaultValue={s.colorChoice}>
              <option value="w">White</option>
              <option value="b">Black</option>
              <option value="random">Random</option>
            </select>
          </label>
          <label>
            Opponent
            <select name="opponent" defaultValue={!vsEngine ? 'human' : settings.botLock === null ? 'adaptive' : String(settings.botLock)}>
              <option value="adaptive">Adaptive bot</option>
              {ELO_CHOICES.map((elo) => (
                <option key={elo} value={elo}>Bot {elo} (locked)</option>
              ))}
              <option value="human">Human (pass & play)</option>
            </select>
          </label>
          <label className="span-2">
            Clock
            <select name="tc" defaultValue={settings.timeControl}>
              {TIME_CONTROLS.map((tc) => (
                <option key={tc.id} value={tc.id}>{tc.label}</option>
              ))}
            </select>
          </label>
          <button className="btn primary" type="submit">New game</button>
        </form>
        <details className="fen-box">
          <summary>Position</summary>
          <input readOnly value={shown.fen} onFocus={(e) => e.target.select()} aria-label="Current FEN" />
          <form
            onSubmit={(e) => {
              e.preventDefault()
              const input = e.currentTarget.elements.namedItem('fen') as HTMLInputElement
              try {
                s.newGame({ fen: input.value.trim() })
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
      {historyOpen && <HistoryDrawer onClose={() => setHistoryOpen(false)} />}
      {s.toast && (
        <div className="toast" role="status" onClick={() => s.setToast(null)}>
          {s.toast}
        </div>
      )}
    </main>
  )
}
