import type { Color } from '../chess/gameController'
import type { GameAnalysis } from './types'

export interface KeyMoment {
  ply: number
  kind: 'book-exit' | 'swing' | 'first-error' | 'no-return' | 'highlight' | 'mate'
  label: string
}

/** The handful of plies worth jumping to, in game order. Earlier entries win when plies collide. */
export function keyMoments(analysis: GameAnalysis, playerColor: Color): KeyMoment[] {
  const { moves, bookPlies } = analysis
  const found: KeyMoment[] = []
  const mine = moves.filter((m) => m.side === playerColor)

  const firstError = mine.find((m) => m.classification === 'blunder') ?? mine.find((m) => m.classification === 'mistake')
  if (firstError) {
    found.push({ ply: firstError.ply, kind: 'first-error', label: `Your first ${firstError.classification}` })
  }

  const swing = moves.reduce<(typeof moves)[number] | undefined>((a, m) => (m.winLoss > (a?.winLoss ?? 10) ? m : a), undefined)
  if (swing) found.push({ ply: swing.ply, kind: 'swing', label: 'Biggest swing of the game' })

  // Last moment the player was still in the game before an error put it out of reach.
  const last = moves[moves.length - 1]
  const playerLostGround = last && (last.side === playerColor ? last.winAfter : 100 - last.winAfter) < 25
  if (playerLostGround) {
    const turning = [...mine].reverse().find((m) => m.winBefore >= 35 && m.winLoss >= 10)
    if (turning) found.push({ ply: turning.ply, kind: 'no-return', label: 'Last chance to save the game' })
  }

  for (const m of mine) {
    if (m.classification === 'brilliant' || m.classification === 'great') {
      found.push({ ply: m.ply, kind: 'highlight', label: m.classification === 'brilliant' ? 'Brilliant move' : 'Great move' })
    }
    if (m.classification === 'miss') found.push({ ply: m.ply, kind: 'highlight', label: 'Missed opportunity' })
  }

  if (bookPlies > 0 && bookPlies < moves.length) {
    found.push({ ply: bookPlies + 1, kind: 'book-exit', label: 'Out of the opening book' })
  }
  if (last?.san.endsWith('#')) found.push({ ply: last.ply, kind: 'mate', label: 'Checkmate' })

  const seen = new Set<number>()
  return found.filter((k) => !seen.has(k.ply) && seen.add(k.ply)).sort((a, b) => a.ply - b.ply)
}
