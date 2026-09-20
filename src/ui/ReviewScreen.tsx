import { useCallback, useEffect, useMemo, useState } from 'react'
import { Chess } from 'chess.js'
import type { DrawShape } from '@lichess-org/chessground/draw'
import type { Key } from '@lichess-org/chessground/types'
import { inspectFen } from '../chess/gameController'
import type { GameRecord } from '../persist/db'
import { keyMoments } from '../review/keyMoments'
import { annotatedPgn } from '../review/pgnExport'
import type { AnalyzedPly, MoveClass, PositionEval } from '../review/types'
import { useStore } from '../state/store'
import { Board } from './Board'
import { MoveList } from './MoveList'
import { CLASS_META, SUMMARY_ORDER, formatScore } from './review/classMeta'
import { EvalBar } from './review/EvalBar'
import { EvalGraph } from './review/EvalGraph'

const BEST_LINE_PLIES = 10
const NO_DESTS = new Map<string, string[]>()

interface Line {
  /** Ply whose "before" position the line starts from. */
  fromPly: number
  sans: string[]
  ucis: string[]
  fens: string[]
  idx: number
}

function buildLine(fen: string, pv: string[], fromPly: number): Line | null {
  const c = new Chess(fen)
  const line: Line = { fromPly, sans: [], ucis: [], fens: [fen], idx: 0 }
  for (const uci of pv.slice(0, BEST_LINE_PLIES)) {
    try {
      const m = c.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] })
      line.sans.push(m.san)
      line.ucis.push(uci)
      line.fens.push(c.fen())
    } catch {
      break
    }
  }
  return line.sans.length > 0 ? line : null
}

const moveNo = (m: { ply: number; side: 'w' | 'b' }) => `${Math.ceil(m.ply / 2)}${m.side === 'w' ? '.' : '…'}`

/** Plain-English note for a move. Every fact in it comes from the engine labels, never invented. */
function explain(m: AnalyzedPly, mine: boolean, prev: AnalyzedPly | undefined): string {
  const who = mine ? 'You' : 'The bot'
  const best = m.bestSan && m.bestUci !== m.uci ? m.bestSan : null
  const drop = `${Math.round(m.winBefore)}% → ${Math.round(m.winAfter)}%`
  switch (m.classification) {
    case 'book':
      return `${m.san} is opening theory.`
    case 'brilliant':
      return `${who} gave up material with ${m.san} — and the engine agrees it is the strongest move. Hard to find.`
    case 'great':
      return `${m.san} was the only move that kept ${mine ? 'your' : 'its'} position together. Everything else was clearly worse.`
    case 'best':
      return `${m.san} is the engine's top choice.`
    case 'excellent':
      return best ? `${m.san} is nearly as good as the engine's ${best}.` : `${m.san} is an excellent move.`
    case 'good':
      return best ? `${m.san} is fine, but ${best} was a little stronger.` : `${m.san} is a decent move.`
    case 'inaccuracy':
      return `${m.san} gives away a bit (${mine ? 'your' : 'its'} winning chances ${drop}).${best ? ` ${best} was better.` : ''}`
    case 'mistake':
      return `${m.san} is a mistake: ${mine ? 'your' : 'its'} winning chances fall ${drop}.${best ? ` ${best} was the move.` : ''}`
    case 'blunder':
      return `${m.san} is a blunder — ${mine ? 'your' : 'its'} winning chances collapse ${drop}.${best ? ` ${best} was the move.` : ''}`
    case 'miss':
      return `${prev ? `${prev.san} was an error, and ` : ''}${best ?? 'a stronger move'} would have punished it. ${m.san} let ${mine ? 'the bot' : 'you'} off the hook.`
  }
}

function resultText(g: GameRecord): string {
  if (g.result === '1/2-1/2') return `Draw · ${g.termination}`
  const won = (g.result === '1-0') === (g.playerColor === 'w')
  return `${won ? 'You won' : 'You lost'} · ${g.termination}`
}

export function ReviewScreen() {
  const record = useStore((s) => s.savedGames.find((g) => g.id === s.reviewId))
  const progress = useStore((s) => (s.analysisProgress?.id === s.reviewId ? s.analysisProgress : null))
  const initialPly = useStore((s) => s.reviewPly)
  const closeReview = useStore((s) => s.closeReview)
  const startRetry = useStore((s) => s.startRetry)
  const analyze = useStore((s) => s.analyze)
  const setToast = useStore((s) => s.setToast)

  const total = record?.plies.length ?? 0
  const [ply, setPly] = useState(initialPly ?? 0)
  const [line, setLine] = useState<Line | null>(null)
  const [flipped, setFlipped] = useState(false)

  const analysis = record?.analysisComplete ? record.analysis : undefined
  const evals = analysis ? (record!.evals as PositionEval[]) : undefined
  const moments = useMemo(() => (analysis && record ? keyMoments(analysis, record.playerColor) : []), [analysis, record])

  const goTo = useCallback(
    (p: number) => {
      setLine(null)
      setPly(Math.max(0, Math.min(total, p)))
    },
    [total],
  )

  const move = ply > 0 ? analysis?.moves[ply - 1] : undefined
  const mine = move?.side === record?.playerColor

  const toggleLine = useCallback(() => {
    if (line) return setLine(null)
    if (!evals || !record || ply === 0) return
    const before = evals[ply - 1]
    const built = buildLine(before.fen, before.pv, ply)
    if (built) setLine({ ...built, idx: 1 })
  }, [line, evals, record, ply])

  const retry = useCallback(() => {
    if (record && move && mine) startRetry(record, ply)
  }, [record, move, mine, startRetry, ply])

  const nextMoment = useCallback(() => {
    if (moments.length === 0) return
    goTo((moments.find((k) => k.ply > ply) ?? moments[0]).ply)
  }, [moments, ply, goTo])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return
      const step = (d: number) =>
        line ? setLine({ ...line, idx: Math.max(0, Math.min(line.sans.length, line.idx + d)) }) : goTo(ply + d)
      if (e.key === 'ArrowLeft') step(-1)
      else if (e.key === 'ArrowRight') step(1)
      else if (e.key === 'ArrowUp') goTo(0)
      else if (e.key === 'ArrowDown') goTo(total)
      else if (e.key === 'b') toggleLine()
      else if (e.key === 'r') retry()
      else if (e.key === 'n') nextMoment()
      else if (e.key === 'f') setFlipped((f) => !f)
      else if (e.key === 'Escape') line ? setLine(null) : closeReview()
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [line, ply, total, goTo, toggleLine, retry, nextMoment, closeReview])

  // What the board shows: a position from the game, or a step along the engine's best line.
  const shown = useMemo(() => {
    if (!record) return null
    if (line) {
      const uci = line.idx > 0 ? line.ucis[line.idx - 1] : undefined
      const fen = line.fens[line.idx]
      return { fen, lastMove: uci ? ([uci.slice(0, 2), uci.slice(2, 4)] as [string, string]) : undefined, ...inspectFen(fen) }
    }
    const rec = record.plies[ply - 1]
    const fen = rec ? rec.fenAfter : (record.plies[0]?.fenBefore ?? record.startFen)
    return { fen, lastMove: rec ? ([rec.uci.slice(0, 2), rec.uci.slice(2, 4)] as [string, string]) : undefined, ...inspectFen(fen) }
  }, [record, line, ply])

  const shapes = useMemo<DrawShape[]>(() => {
    if (line) {
      const next = line.ucis[line.idx]
      return next ? [{ orig: next.slice(0, 2) as Key, dest: next.slice(2, 4) as Key, brush: 'green' }] : []
    }
    if (!move) return []
    const meta = CLASS_META[move.classification]
    const out: DrawShape[] = [{ orig: move.uci.slice(2, 4) as Key, label: { text: meta.symbol, fill: meta.color } }]
    if (move.bestUci && move.bestUci !== move.uci && move.classification !== 'book') {
      out.push({ orig: move.bestUci.slice(0, 2) as Key, dest: move.bestUci.slice(2, 4) as Key, brush: 'green' })
    }
    return out
  }, [line, move])

  const counts = useMemo(() => {
    const c = { w: {} as Record<MoveClass, number>, b: {} as Record<MoveClass, number> }
    for (const m of analysis?.moves ?? []) c[m.side][m.classification] = (c[m.side][m.classification] ?? 0) + 1
    return c
  }, [analysis])

  if (!record || !shown) {
    return (
      <main className="review-missing">
        <p>That game is no longer saved.</p>
        <button className="btn" onClick={closeReview}>Back to play</button>
      </main>
    )
  }

  const you = record.playerColor
  const bot = you === 'w' ? 'b' : 'w'
  const orientation = (you === 'w') !== flipped ? 'white' : 'black'
  const shownEval = line ? undefined : evals?.[ply]

  const exportPgn = () => {
    const pgn = analysis && evals ? annotatedPgn(record.pgn, record.startFen, analysis, evals) : record.pgn
    const url = URL.createObjectURL(new Blob([pgn], { type: 'application/x-chess-pgn' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `chess-sensei-${new Date(record.createdAt).toLocaleDateString('sv')}-vs-${record.botElo}.pgn`
    a.click()
    URL.revokeObjectURL(url)
    void navigator.clipboard?.writeText(pgn).then(
      () => setToast('PGN downloaded and copied to the clipboard.'),
      () => setToast('PGN downloaded.'),
    )
  }

  const moveList = (
        <MoveList
          history={record.plies}
          currentPly={line ? -1 : ply}
          onSelect={goTo}
          annotate={
            analysis
              ? (p) => {
                  const c = analysis.moves[p - 1].classification
                  return c === 'best' || c === 'excellent' || c === 'good' ? undefined : CLASS_META[c]
                }
              : undefined
          }
        />
  )

  return (
    <main className="review">
      <section className="review-board">
        <EvalBar evaluation={shownEval} orientation={orientation} />
        <div className="board-frame">
          <Board
            fen={shown.fen}
            orientation={orientation}
            turn={shown.turn}
            inCheck={shown.inCheck}
            lastMove={shown.lastMove}
            dests={NO_DESTS}
            shapes={shapes}
          />
        </div>
      </section>

      <aside className="side review-side">
        <div className="review-head">
          <div>
            <div className="review-title">{resultText(record)}</div>
            <div className="review-sub">
              {analysis?.opening ? `${analysis.opening.eco} ${analysis.opening.name}` : 'Opening: —'} · vs Bot {record.botElo}
              {record.rated
                ? ` · rating ${record.playerEloBefore} → ${record.playerEloAfter}`
                : ` · unrated (${record.unratedReason})`}
            </div>
          </div>
          <button className="btn" onClick={closeReview}>Back</button>
        </div>

        {!analysis ? (
          <div className="analysis-wait">
            {progress ? (
              <>
                <div>Analyzing move {Math.ceil(progress.done / 2)} of {Math.ceil(progress.total / 2)}…</div>
                <div className="progress"><div style={{ width: `${(progress.done / progress.total) * 100}%` }} /></div>
              </>
            ) : (
              <>
                <div>This game hasn't been analyzed yet.</div>
                <button className="btn primary" onClick={() => analyze(record.id)}>Analyze now</button>
              </>
            )}
            <small>You can step through the moves while you wait.</small>
            {moveList}
          </div>
        ) : (
          <>
            <div className="accuracy-row">
              <div className="acc you">
                <span>You</span>
                <strong>{analysis.accuracy[you].toFixed(1)}</strong>
                <small>played like ~{analysis.estimatedElo[you]}</small>
              </div>
              <div className="acc">
                <span>Bot {record.botElo}</span>
                <strong>{analysis.accuracy[bot].toFixed(1)}</strong>
                <small>played like ~{analysis.estimatedElo[bot]}</small>
              </div>
            </div>

            <EvalGraph evals={evals!} moves={analysis.moves} current={ply} keyPlies={moments.map((k) => k.ply)} onSelect={goTo} />

            <div className="coach">
              {line ? (
                <>
                  <div className="coach-head">
                    <span className="badge" style={{ background: CLASS_META.best.color }}>★</span>
                    <strong>Engine's best line from move {Math.ceil(line.fromPly / 2)}</strong>
                  </div>
                  <div className="line-sans">
                    {line.sans.map((san, i) => (
                      <button key={i} className={`san${i + 1 === line.idx ? ' active' : ''}`} onClick={() => setLine({ ...line, idx: i + 1 })}>
                        {san}
                      </button>
                    ))}
                  </div>
                  <small>← → step through · b or Esc to return to the game</small>
                </>
              ) : move ? (
                <>
                  <div className="coach-head">
                    <span className="badge" style={{ background: CLASS_META[move.classification].color }}>
                      {CLASS_META[move.classification].symbol}
                    </span>
                    <strong>
                      {moveNo(move)} {move.san} · {CLASS_META[move.classification].label}
                    </strong>
                    <span className="coach-eval">
                      {formatScore(evals![ply - 1].score, evals![ply - 1].winWhite)} → {formatScore(evals![ply].score, evals![ply].winWhite)}
                    </span>
                  </div>
                  <p>{explain(move, mine, analysis.moves[ply - 2])}</p>
                  {moments.find((k) => k.ply === ply) && <p className="moment-tag">{moments.find((k) => k.ply === ply)!.label}</p>}
                </>
              ) : (
                <p>Step through the game with ← →, or jump to a key moment.</p>
              )}
              <div className="coach-actions">
                <button className="btn" onClick={toggleLine} disabled={ply === 0} title="b">
                  {line ? 'Back to game' : 'Show best line'}
                </button>
                <button className="btn" onClick={retry} disabled={!mine} title="Play this position again against the same bot (r)">
                  Retry from here
                </button>
                <button className="btn" onClick={nextMoment} disabled={moments.length === 0} title="n">
                  Next key moment
                </button>
              </div>
            </div>

            {moveList}

            {moments.length > 0 && (
              <div className="moments">
                {moments.map((k) => (
                  <button key={k.ply} className={`moment${k.ply === ply ? ' active' : ''}`} onClick={() => goTo(k.ply)}>
                    <span>{moveNo(analysis.moves[k.ply - 1])} {analysis.moves[k.ply - 1].san}</span>
                    {k.label}
                  </button>
                ))}
              </div>
            )}

            <table className="summary">
              <thead>
                <tr><th>You</th><th /><th>Bot</th></tr>
              </thead>
              <tbody>
                {SUMMARY_ORDER.map((c) => (
                  <tr key={c}>
                    <td>{counts[you][c] ?? 0}</td>
                    <td style={{ color: CLASS_META[c].color }}>
                      <span className="badge small" style={{ background: CLASS_META[c].color }}>{CLASS_META[c].symbol}</span>
                      {CLASS_META[c].label}
                    </td>
                    <td>{counts[bot][c] ?? 0}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}

        <div className="controls">
          <button className="btn" onClick={() => setFlipped((f) => !f)} title="f">Flip</button>
          <button className="btn" onClick={exportPgn}>Export PGN</button>
        </div>
      </aside>
    </main>
  )
}
