import { Chess } from 'chess.js'
import { materialBalance } from '../chess/material'
import type { GameRecord } from '../persist/db'
import type { MoveClass, PositionEval } from './types'

// Optional plain-English notes from a local LLM CLI (see scripts/serve.mjs). The model is handed
// facts the engine already established and only puts them into words; it never labels anything.

/** Moves worth a generated note. Best/excellent/good/book are covered fine by the templates. */
export const COACHED: ReadonlySet<MoveClass> = new Set(['brilliant', 'great', 'inaccuracy', 'mistake', 'miss', 'blunder'])

const LINE_PLIES = 6

/** A line in ordinary numbered notation ("13... Qxd4 14. Bd3 Qxb2"), so it is unambiguous who plays what. */
function numberedLine(fen: string, pv: string[]): { text: string; endFen: string } {
  const c = new Chess(fen)
  const out: string[] = []
  for (const uci of pv.slice(0, LINE_PLIES)) {
    const white = c.turn() === 'w'
    const no = c.moveNumber()
    try {
      const san = c.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] }).san
      out.push(white ? `${no}. ${san}` : out.length === 0 ? `${no}... ${san}` : san)
    } catch {
      break
    }
  }
  return { text: out.join(' '), endFen: c.fen() }
}

function materialNote(delta: number): string {
  if (delta === 0) return 'material stays level'
  return `the mover ends up ${Math.abs(delta)} point${Math.abs(delta) === 1 ? '' : 's'} of material ${delta > 0 ? 'ahead' : 'behind'} compared with before the move (pawn 1, knight/bishop 3, rook 5, queen 9)`
}

export function coachFacts(record: GameRecord, ply: number) {
  const m = record.analysis!.moves[ply - 1]
  const evals = record.evals as PositionEval[]
  const mine = m.side === record.playerColor
  const sign = m.side === 'w' ? 1 : -1
  const materialFor = (fen: string) => materialBalance(fen) * sign
  const best = numberedLine(m.fenBefore, evals[ply - 1].pv)
  const reply = numberedLine(m.fenAfter, evals[ply].pv)
  return {
    moveNumber: Math.ceil(ply / 2),
    movePlayed: `${Math.ceil(ply / 2)}${m.side === 'w' ? '.' : '...'} ${m.san}`,
    playedBy: `${mine ? 'the player' : 'the opponent bot'} (${m.side === 'w' ? 'White' : 'Black'})`,
    label: m.classification,
    moverWinningChances: `${Math.round(m.winBefore)}% before, ${Math.round(m.winAfter)}% after`,
    positionBeforeMoveFEN: m.fenBefore,
    engineBestMove: m.bestSan ?? m.san,
    lineAfterEngineBestMove: `${best.text} — ${materialNote(materialFor(best.endFen) - materialFor(m.fenBefore))}`,
    // What the engine expects now that the move has been played: the refutation, if it was an error.
    engineLineAfterMovePlayed: `${reply.text} — ${materialNote(materialFor(reply.endFen) - materialFor(m.fenBefore))}`,
    gameContinued: record.plies.slice(ply, ply + 3).map((p) => p.san).join(' '),
    opening: record.analysis!.opening?.name,
  }
}

let availability: Promise<boolean> | null = null

/** True when the page is served by (or proxied to) the local server and its CLI is installed. */
export function coachAvailable(): Promise<boolean> {
  availability ??= fetch('/api/coach')
    .then((r) => (r.ok ? r.json() : { available: false }))
    .then((j: { available?: boolean }) => j.available === true)
    .catch(() => false)
  return availability
}

export async function fetchCoachNote(record: GameRecord, ply: number, signal?: AbortSignal): Promise<string> {
  const res = await fetch('/api/coach', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ facts: coachFacts(record, ply) }),
    signal,
  })
  if (!res.ok) throw new Error(res.status === 429 ? 'busy' : `coach unavailable (${res.status})`)
  return ((await res.json()) as { text: string }).text
}
