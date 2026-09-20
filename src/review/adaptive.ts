// Synthetic rating: an Elo update against the bot's nominal rating. Not FIDE, not Chess.com.

export const PLAYER_ELO_START = 1400
export const PLAYER_ELO_MIN = 200
export const PLAYER_ELO_MAX = 2800
export const BOT_OFFSETS = [0, 60, 120, 200] as const
export type BotOffset = (typeof BOT_OFFSETS)[number]

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x))

export function expectedScore(playerElo: number, botElo: number): number {
  return 1 / (1 + 10 ** ((botElo - playerElo) / 400))
}

/** Larger steps for the first ten games so the rating finds its level quickly. */
export function kFactor(gamesPlayed: number): number {
  return gamesPlayed < 10 ? 40 : 24
}

export function updateRating(playerElo: number, botElo: number, score: 0 | 0.5 | 1, gamesPlayed: number): number {
  const next = playerElo + kFactor(gamesPlayed) * (score - expectedScore(playerElo, botElo))
  return Math.round(clamp(next, PLAYER_ELO_MIN, PLAYER_ELO_MAX))
}

/** Small bonus/penalty for how well the game was played, independent of the result. */
export function qualityNudge(accuracy: number, expectedAccuracy: number, plies: number): number {
  if (plies < 20) return 0
  return Math.round(clamp((accuracy - expectedAccuracy) * 0.5, -10, 10))
}

export function nextBotElo(playerElo: number, offset: number, botMin: number, botMax: number): number {
  return clamp(Math.round(playerElo + offset), botMin, botMax)
}

export interface RatedCheck {
  vsEngine: boolean
  takebacks: number
  fromStartPosition: boolean
  plies: number
  termination: string
}

/** Why a finished game doesn't count for rating, or null if it does. */
export function unratedReason(g: RatedCheck): string | null {
  if (!g.vsEngine) return 'not against the bot'
  if (!g.fromStartPosition) return 'custom starting position'
  if (g.takebacks > 0) return 'takebacks used'
  // Stops an accidental early resignation from tanking the rating; a real checkmate always counts.
  if (g.plies < 20 && g.termination !== 'checkmate') return 'fewer than 10 moves'
  return null
}
