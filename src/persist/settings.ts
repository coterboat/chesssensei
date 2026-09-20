import { PLAYER_ELO_START, type BotOffset } from '../review/adaptive'

export interface RatingPoint {
  at: number
  elo: number
}

export interface Settings {
  playerElo: number
  gamesPlayed: number
  botOffset: BotOffset
  /** Fixed bot Elo, or null to follow the player's rating. */
  botLock: number | null
  colorChoice: 'w' | 'b' | 'random'
  ratingHistory: RatingPoint[]
}

const KEY = 'chesssensei.settings.v1'

export const DEFAULT_SETTINGS: Settings = {
  playerElo: PLAYER_ELO_START,
  gamesPlayed: 0,
  botOffset: 60,
  botLock: null,
  colorChoice: 'w',
  ratingHistory: [],
}

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? { ...DEFAULT_SETTINGS, ...JSON.parse(raw) } : { ...DEFAULT_SETTINGS }
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

export function saveSettings(settings: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings))
  } catch {
    // Storage full or blocked: the app still works, it just won't remember.
  }
}
