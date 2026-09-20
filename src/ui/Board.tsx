import { useEffect, useRef } from 'react'
import { Chessground } from '@lichess-org/chessground'
import type { Api } from '@lichess-org/chessground/api'
import type { DrawShape } from '@lichess-org/chessground/draw'
import type { Key } from '@lichess-org/chessground/types'
import '@lichess-org/chessground/assets/chessground.base.css'
import '@lichess-org/chessground/assets/chessground.brown.css'
import '@lichess-org/chessground/assets/chessground.cburnett.css'

export interface BoardProps {
  fen: string
  orientation: 'white' | 'black'
  turn: 'w' | 'b'
  inCheck: boolean
  lastMove?: [string, string]
  dests: Map<string, string[]>
  /** Which side(s) may be moved by the user. undefined = read-only. */
  movable?: 'white' | 'black' | 'both'
  shapes?: DrawShape[]
  /** Change to force a resync when fen is unchanged (e.g. cancelled promotion). */
  rev?: number
  onMove?: (from: string, to: string) => void
}

/** Thin imperative wrapper: Chessground is created once and only ever updated via set(). */
export function Board(props: BoardProps) {
  const el = useRef<HTMLDivElement>(null)
  const api = useRef<Api | null>(null)
  const onMove = useRef(props.onMove)
  onMove.current = props.onMove

  useEffect(() => {
    if (!el.current) return
    api.current = Chessground(el.current, {
      animation: { duration: 180 },
      highlight: { lastMove: true, check: true },
      movable: { free: false, showDests: true },
      premovable: { enabled: false },
      draggable: { showGhost: true },
      drawable: { enabled: true },
      events: {
        move: (from, to) => onMove.current?.(from, to),
      },
    })
    return () => {
      api.current?.destroy()
      api.current = null
    }
  }, [])

  useEffect(() => {
    const turnColor = props.turn === 'w' ? 'white' : 'black'
    api.current?.set({
      fen: props.fen,
      orientation: props.orientation,
      turnColor,
      check: props.inCheck ? turnColor : false,
      lastMove: props.lastMove as Key[] | undefined,
      viewOnly: false,
      movable: {
        color: props.movable,
        dests: props.movable ? (props.dests as Map<Key, Key[]>) : new Map(),
      },
    })
    api.current?.setAutoShapes(props.shapes ?? [])
  }, [
    props.fen,
    props.orientation,
    props.turn,
    props.inCheck,
    props.lastMove,
    props.dests,
    props.movable,
    props.shapes,
    props.rev,
  ])

  return <div ref={el} className="board" />
}
