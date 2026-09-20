import { useEffect, useMemo, useState } from 'react'
import { Chess } from 'chess.js'
import type { DrawShape } from '@lichess-org/chessground/draw'
import type { Key } from '@lichess-org/chessground/types'
import type { PromotionPiece } from '../chess/gameController'
import { MAX_BOX, dueCards, nextDue, type Card } from '../drill/deck'
import { computeStats, type Phase } from '../review/stats'
import { useStore } from '../state/store'
import { Board } from './Board'
import { PromotionPicker } from './PromotionPicker'
import { CLASS_META } from './review/classMeta'
import { playSound, soundForSan } from './sound'

type Verdict = { correct: boolean; loss: number; uci: string; san: string }

const PHASE_LABEL: Record<Phase, string> = { opening: 'Opening', middlegame: 'Middlegame', endgame: 'Endgame' }

function destsOf(chess: Chess): Map<string, string[]> {
  const dests = new Map<string, string[]>()
  for (const m of chess.moves({ verbose: true })) dests.set(m.from, [...(dests.get(m.from) ?? []), m.to])
  return dests
}

function untilText(ms: number): string {
  const min = Math.round(ms / 60_000)
  if (min < 60) return `${Math.max(1, min)} min`
  if (min < 48 * 60) return `${Math.round(min / 60)} h`
  return `${Math.round(min / 1440)} days`
}

export function DrillScreen() {
  const cards = useStore((s) => s.cards)
  const savedGames = useStore((s) => s.savedGames)
  const answerCard = useStore((s) => s.answerCard)
  const removeCard = useStore((s) => s.removeCard)
  const openReview = useStore((s) => s.openReview)
  const closeReview = useStore((s) => s.closeReview)

  // The session's queue is fixed when it starts, so a just-missed card doesn't jump straight back in.
  const [queue, setQueue] = useState<string[]>(() => dueCards(cards).map((c) => c.id))
  const [verdict, setVerdict] = useState<Verdict | null>(null)
  const [checking, setChecking] = useState(false)
  const [pending, setPending] = useState<{ from: string; to: string } | null>(null)
  const [rev, setRev] = useState(0)
  const [session, setSession] = useState({ right: 0, wrong: 0 })

  // Cards can vanish mid-session (dropped, or their game deleted).
  const remaining = queue.filter((id) => cards.some((c) => c.id === id))
  const card: Card | undefined = cards.find((c) => c.id === remaining[0])
  const chess = useMemo(() => (card ? new Chess(card.fen) : null), [card?.id]) // eslint-disable-line react-hooks/exhaustive-deps
  const dests = useMemo(() => (chess && !verdict ? destsOf(chess) : new Map<string, string[]>()), [chess, verdict])
  const stats = useMemo(() => computeStats(savedGames), [savedGames])

  const submit = async (from: string, to: string, promotion?: PromotionPiece) => {
    if (!card || !chess || verdict || checking) return
    const probe = new Chess(card.fen)
    let san: string
    try {
      san = probe.move({ from, to, promotion }).san
    } catch {
      return setRev((r) => r + 1)
    }
    const uci = from + to + (promotion ?? '')
    playSound(soundForSan(san))
    setChecking(true)
    try {
      const res = await answerCard(card, uci)
      setVerdict({ ...res, uci, san })
      setSession((s) => (res.correct ? { ...s, right: s.right + 1 } : { ...s, wrong: s.wrong + 1 }))
    } finally {
      setChecking(false)
    }
  }

  const onMove = (from: string, to: string) => {
    if (!chess) return
    const promo = chess.moves({ verbose: true }).some((m) => m.from === from && m.to === to && m.promotion)
    if (promo) setPending({ from, to })
    else void submit(from, to)
  }

  const next = () => {
    setVerdict(null)
    setQueue(remaining.slice(1))
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowRight') && verdict) next()
      else if (e.key === 'Escape') closeReview()
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  // Board: the puzzle position, or the position after the answer once graded.
  const shownFen = useMemo(() => {
    if (!card) return null
    if (!verdict) return card.fen
    const c = new Chess(card.fen)
    c.move({ from: verdict.uci.slice(0, 2), to: verdict.uci.slice(2, 4), promotion: verdict.uci[4] })
    return c.fen()
  }, [card, verdict])

  const shapes = useMemo<DrawShape[]>(() => {
    if (!card || !verdict) return []
    const out: DrawShape[] = []
    if (verdict.uci !== card.bestUci) {
      out.push({ orig: card.bestUci.slice(0, 2) as Key, dest: card.bestUci.slice(2, 4) as Key, brush: 'green' })
    }
    out.push({
      orig: verdict.uci.slice(2, 4) as Key,
      label: verdict.correct ? { text: '✓', fill: CLASS_META.best.color } : { text: '✗', fill: CLASS_META.blunder.color },
    })
    return out
  }, [card, verdict])

  const boxes = Array.from({ length: MAX_BOX }, (_, i) => cards.filter((c) => c.box === i + 1).length)
  const upcoming = nextDue(cards)
  const sideName = card?.side === 'w' ? 'White' : 'Black'

  return (
    <main className="review drill">
      <section className="review-board">
        <div className="board-frame">
          {card && shownFen ? (
            <>
              <Board
                fen={shownFen}
                orientation={card.side === 'w' ? 'white' : 'black'}
                turn={shownFen.split(' ')[1] as 'w' | 'b'}
                inCheck={new Chess(shownFen).inCheck()}
                lastMove={verdict ? [verdict.uci.slice(0, 2), verdict.uci.slice(2, 4)] : undefined}
                dests={dests}
                movable={verdict || checking ? undefined : card.side === 'w' ? 'white' : 'black'}
                shapes={shapes}
                rev={rev}
                onMove={onMove}
              />
              {pending && (
                <PromotionPicker
                  color={card.side}
                  square={pending.to}
                  orientation={card.side === 'w' ? 'white' : 'black'}
                  onPick={(p) => {
                    const { from, to } = pending
                    setPending(null)
                    void submit(from, to, p)
                  }}
                  onCancel={() => {
                    setPending(null)
                    setRev((r) => r + 1)
                  }}
                />
              )}
            </>
          ) : (
            <div className="drill-empty">
              <strong>{cards.length === 0 ? 'No drill cards yet' : 'All caught up'}</strong>
              <p>
                {cards.length === 0
                  ? 'Every mistake, blunder and miss from your reviewed games becomes a card here. Play a game and come back.'
                  : upcoming
                    ? `Next card is due in ${untilText(upcoming - Date.now())}.`
                    : 'Nothing scheduled.'}
              </p>
              {cards.length > 0 && (
                <button className="btn" onClick={() => setQueue([...cards].sort((a, b) => a.box - b.box || a.due - b.due).map((c) => c.id))}>
                  Practice the whole deck anyway
                </button>
              )}
            </div>
          )}
        </div>
      </section>

      <aside className="side review-side">
        <div className="review-head">
          <div>
            <div className="review-title">Mistake deck</div>
            <div className="review-sub">
              {remaining.length} to go · {session.right} right · {session.wrong} wrong this session
            </div>
          </div>
          <button className="btn" onClick={closeReview}>Back</button>
        </div>

        {card && (
          <div className="coach">
            {!verdict ? (
              <>
                <div className="coach-head">
                  <span className="badge" style={{ background: CLASS_META[card.classification].color }}>
                    {CLASS_META[card.classification].symbol}
                  </span>
                  <strong>{sideName} to move — find the best move</strong>
                </div>
                <p>
                  You went wrong here in a real game (move {Math.ceil(card.ply / 2)}). {checking ? 'Checking your move…' : 'Take your time.'}
                </p>
                <small>Box {card.box} of {MAX_BOX} · seen {card.attempts}×</small>
              </>
            ) : (
              <>
                <div className="coach-head">
                  <span className="badge" style={{ background: verdict.correct ? CLASS_META.best.color : CLASS_META.blunder.color }}>
                    {verdict.correct ? '✓' : '✗'}
                  </span>
                  <strong>{verdict.correct ? 'Correct' : 'Not quite'} — {verdict.san}</strong>
                </div>
                <p>
                  {verdict.uci === card.bestUci
                    ? `${card.bestSan} is the engine's move.`
                    : verdict.correct
                      ? `${verdict.san} is just as good here. The engine's first choice was ${card.bestSan}.`
                      : `${verdict.san} gives up about ${Math.round(verdict.loss)}% winning chances. The move was ${card.bestSan}.`}{' '}
                  In the game you played {card.playedSan}
                  {CLASS_META[card.classification].symbol}.
                </p>
                <small>{verdict.correct ? `Now in box ${card.box} of ${MAX_BOX}` : 'Back to box 1 — it will return in a few minutes'}</small>
                <div className="coach-actions">
                  <button className="btn primary" onClick={next}>Next (Enter)</button>
                  <button className="btn" onClick={() => openReview(card.gameId, card.ply)}>See it in the game</button>
                  <button
                    className="btn"
                    title="Remove this card from the deck"
                    onClick={() => {
                      void removeCard(card.id)
                      next()
                    }}
                  >
                    Drop card
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        <div className="coach">
          <strong>Deck · {cards.length} cards</strong>
          <div className="boxes">
            {boxes.map((n, i) => (
              <div key={i} className="box" title={`Box ${i + 1}`}>
                <span>{n}</span>
                <small>Box {i + 1}</small>
              </div>
            ))}
          </div>
          <small>Right answers move a card up a box and it returns after 1, 3, 7, then 21 days. A miss sends it back to box 1.</small>
        </div>

        <div className="coach">
          <strong>Your last {stats.games} {stats.games === 1 ? 'game' : 'games'}</strong>
          {stats.games === 0 ? (
            <small>Trends appear once you have reviewed games.</small>
          ) : (
            <>
              <div className="stat-row">
                <div><span>{stats.record.wins}–{stats.record.draws}–{stats.record.losses}</span><small>W–D–L</small></div>
                <div><span>{stats.averageAccuracy.toFixed(1)}</span><small>avg accuracy</small></div>
                <div><span>{stats.seriousPerGame.toFixed(1)}</span><small>serious errors / game</small></div>
              </div>
              {stats.accuracyTrend.length > 1 && <Trend values={stats.accuracyTrend} />}
              <table className="phase-table">
                <tbody>
                  {(Object.keys(PHASE_LABEL) as Phase[]).map((p) => (
                    <tr key={p} className={stats.worstPhase === p ? 'worst' : ''}>
                      <td>{PHASE_LABEL[p]}</td>
                      <td>
                        <div className="bar"><div style={{ width: `${Math.min(100, stats.byPhase[p].rate * 250)}%` }} /></div>
                      </td>
                      <td>{stats.byPhase[p].moves ? `${Math.round(stats.byPhase[p].rate * 100)}%` : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <small>
                Share of your moves that were inaccuracies or worse, by phase.
                {stats.worstPhase && ` Your leakiest phase: the ${PHASE_LABEL[stats.worstPhase].toLowerCase()}.`}
              </small>
            </>
          )}
        </div>
      </aside>
    </main>
  )
}

function Trend({ values }: { values: number[] }) {
  const lo = Math.min(...values, 50)
  const hi = Math.max(...values, 100)
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * 100},${30 - ((v - lo) / (hi - lo)) * 28 - 1}`).join(' ')
  return (
    <div className="sparkline">
      <svg viewBox="0 0 100 30" preserveAspectRatio="none" aria-label="Accuracy per game, oldest to newest">
        <polyline points={pts} fill="none" stroke="currentColor" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
      </svg>
      <small>Accuracy per game, oldest → newest</small>
    </div>
  )
}
