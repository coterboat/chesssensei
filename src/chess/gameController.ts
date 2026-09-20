import { Chess, type Move, type Square } from 'chess.js'

export type Color = 'w' | 'b'
export type PromotionPiece = 'q' | 'r' | 'b' | 'n'

export type Termination =
  | 'checkmate'
  | 'stalemate'
  | 'threefold'
  | 'fifty-move'
  | 'insufficient'

export interface GameStatus {
  over: boolean
  result?: '1-0' | '0-1' | '1/2-1/2'
  termination?: Termination
}

export interface PlyRecord {
  ply: number
  san: string
  uci: string
  color: Color
  fenBefore: string
  fenAfter: string
  captured: boolean
}

export interface GameSnapshot {
  fen: string
  turn: Color
  inCheck: boolean
  history: PlyRecord[]
  lastMove?: [string, string]
  dests: Map<string, string[]>
  status: GameStatus
}

export const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'

/** Thin wrapper over chess.js. chess.js is the single source of truth for rules. */
export class GameController {
  private chess: Chess
  private startFen: string

  constructor(fen: string = START_FEN) {
    this.startFen = fen
    this.chess = new Chess(fen)
  }

  reset(fen: string = START_FEN): void {
    this.startFen = fen
    this.chess = new Chess(fen)
  }

  fen(): string {
    return this.chess.fen()
  }

  turn(): Color {
    return this.chess.turn()
  }

  pgn(): string {
    return this.chess.pgn()
  }

  /** Legal destinations per origin square, in the shape Chessground wants. */
  dests(): Map<string, string[]> {
    const dests = new Map<string, string[]>()
    for (const m of this.chess.moves({ verbose: true })) {
      const list = dests.get(m.from)
      if (list) {
        if (!list.includes(m.to)) list.push(m.to)
      } else {
        dests.set(m.from, [m.to])
      }
    }
    return dests
  }

  isPromotion(from: string, to: string): boolean {
    return this.chess
      .moves({ square: from as Square, verbose: true })
      .some((m) => m.to === to && m.promotion !== undefined)
  }

  /** Returns the move if legal, null otherwise. Never throws on illegal input. */
  move(from: string, to: string, promotion?: PromotionPiece): Move | null {
    try {
      return this.chess.move({ from, to, promotion })
    } catch {
      return null
    }
  }

  moveUci(uci: string): Move | null {
    const promotion = uci.length > 4 ? (uci[4] as PromotionPiece) : undefined
    return this.move(uci.slice(0, 2), uci.slice(2, 4), promotion)
  }

  undo(): Move | null {
    return this.chess.undo()
  }

  status(): GameStatus {
    const c = this.chess
    if (c.isCheckmate()) {
      return { over: true, result: c.turn() === 'w' ? '0-1' : '1-0', termination: 'checkmate' }
    }
    if (c.isStalemate()) return { over: true, result: '1/2-1/2', termination: 'stalemate' }
    if (c.isInsufficientMaterial()) return { over: true, result: '1/2-1/2', termination: 'insufficient' }
    if (c.isThreefoldRepetition()) return { over: true, result: '1/2-1/2', termination: 'threefold' }
    if (c.isDrawByFiftyMoves()) return { over: true, result: '1/2-1/2', termination: 'fifty-move' }
    return { over: false }
  }

  history(): PlyRecord[] {
    return this.chess.history({ verbose: true }).map((m, i) => ({
      ply: i + 1,
      san: m.san,
      uci: m.from + m.to + (m.promotion ?? ''),
      color: m.color,
      fenBefore: m.before,
      fenAfter: m.after,
      captured: m.captured !== undefined,
    }))
  }

  snapshot(): GameSnapshot {
    const history = this.history()
    const last = history[history.length - 1]
    const status = this.status()
    return {
      fen: this.fen(),
      turn: this.turn(),
      inCheck: this.chess.inCheck(),
      history,
      lastMove: last ? [last.uci.slice(0, 2), last.uci.slice(2, 4)] : undefined,
      dests: status.over ? new Map() : this.dests(),
      status,
    }
  }

  startingFen(): string {
    return this.startFen
  }
}

/** Side to move + check state for an arbitrary FEN (used when previewing past positions). */
export function inspectFen(fen: string): { turn: Color; inCheck: boolean } {
  const c = new Chess(fen)
  return { turn: c.turn(), inCheck: c.inCheck() }
}
