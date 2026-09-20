import { epd } from '../chess/openings'
import type { GameRecord } from '../persist/db'
import type { MoveClass } from '../review/types'

/** One of the player's own errors, turned into a find-the-best-move exercise. */
export interface Card {
  /** `${gameId}:${ply}` */
  id: string
  gameId: string
  ply: number
  /** Position before the error; the player is the side to move. */
  fen: string
  side: 'w' | 'b'
  playedUci: string
  playedSan: string
  bestUci: string
  bestSan: string
  /** Engine line starting with the best move (uci). */
  pv: string[]
  classification: MoveClass
  winLoss: number
  /** Mover's win-% if the best move is played; answers are graded against this. */
  bestWin: number
  createdAt: number
  /** Leitner box 1–5. */
  box: number
  due: number
  attempts: number
  correct: number
}

const DRILL_CLASSES: ReadonlySet<MoveClass> = new Set(['mistake', 'blunder', 'miss'])

const MINUTE = 60_000
const DAY = 24 * 60 * MINUTE
/** Delay before a card in box N comes back. A miss returns within the same session. */
export const BOX_INTERVALS = [10 * MINUTE, 1 * DAY, 3 * DAY, 7 * DAY, 21 * DAY]
export const RETRY_INTERVAL = 5 * MINUTE
export const MAX_BOX = BOX_INTERVALS.length

/** Errors made from positions worse than this (mover's win-%) are not worth drilling. */
export const MIN_WIN_TO_DRILL = 20

/** An answer within this many win-% points of the best move counts as correct. */
export const ACCEPT_LOSS = 3

/** Cards for the player's mistakes, blunders and misses in an analyzed game. */
export function extractCards(record: GameRecord, existing: Iterable<Card> = [], now = Date.now()): Card[] {
  if (!record.analysis || !record.evals) return []
  const seen = new Set([...existing].map((c) => epd(c.fen)))
  const cards: Card[] = []
  for (const m of record.analysis.moves) {
    if (m.side !== record.playerColor || !DRILL_CLASSES.has(m.classification)) continue
    if (!m.bestUci || !m.bestSan || m.bestUci === m.uci) continue
    if (m.winBefore < MIN_WIN_TO_DRILL) continue // already lost: nothing instructive to find
    const key = epd(m.fenBefore)
    if (seen.has(key)) continue // same position, e.g. from a retry or a repeated opening slip
    seen.add(key)
    cards.push({
      id: `${record.id}:${m.ply}`,
      gameId: record.id,
      ply: m.ply,
      fen: m.fenBefore,
      side: m.side,
      playedUci: m.uci,
      playedSan: m.san,
      bestUci: m.bestUci,
      bestSan: m.bestSan,
      pv: record.evals[m.ply - 1]?.pv ?? [m.bestUci],
      classification: m.classification,
      winLoss: m.winLoss,
      bestWin: m.winBefore,
      createdAt: now,
      box: 1,
      due: now,
      attempts: 0,
      correct: 0,
    })
  }
  return cards
}

/** Leitner: right → up a box and a longer wait; wrong → back to box 1, back soon. */
export function grade(card: Card, wasCorrect: boolean, now = Date.now()): Card {
  const box = wasCorrect ? Math.min(MAX_BOX, card.box + 1) : 1
  return {
    ...card,
    box,
    due: now + (wasCorrect ? BOX_INTERVALS[box - 1] : RETRY_INTERVAL),
    attempts: card.attempts + 1,
    correct: card.correct + (wasCorrect ? 1 : 0),
  }
}

/** Due cards, most overdue first; worse errors first among ties. */
export function dueCards(cards: Card[], now = Date.now()): Card[] {
  return cards.filter((c) => c.due <= now).sort((a, b) => a.due - b.due || b.winLoss - a.winLoss)
}

export function nextDue(cards: Card[], now = Date.now()): number | null {
  const future = cards.filter((c) => c.due > now).map((c) => c.due)
  return future.length ? Math.min(...future) : null
}
