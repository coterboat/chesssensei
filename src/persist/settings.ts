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
  sound: boolean
  /** Ask the local LLM CLI for a plain-English note on notable moves (needs the Dock app's server). */
  coach: boolean
  timeControl: string
}

const KEY = 'chesssensei.settings.v1'

export const DEFAULT_SETTINGS: Settings = {
  playerElo: PLAYER_ELO_START,
  gamesPlayed: 0,
  botOffset: 60,
  botLock: null,
  colorChoice: 'w',
  ratingHistory: [],
  sound: true,
  coach: true,
  timeControl: 'off',
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

// --- in-progress game, so a reload (or a crash) doesn't lose it ---

export interface LiveGame {
  startFen: string
  ucis: string[]
  playerColor: 'w' | 'b'
  opponent: 'engine' | 'human'
  botElo: number
  takebacks: number
  timeControl: string
  /** Clock values at the last move, stopped. */
  clock: { w: number; b: number } | null
  retry: { parentId: string; ply: number } | null
}

const LIVE_KEY = 'chesssensei.live.v1'

export function loadLiveGame(): LiveGame | null {
  try {
    const raw = localStorage.getItem(LIVE_KEY)
    return raw ? (JSON.parse(raw) as LiveGame) : null
  } catch {
    return null
  }
}

export function saveLiveGame(game: LiveGame | null): void {
  try {
    if (game) localStorage.setItem(LIVE_KEY, JSON.stringify(game))
    else localStorage.removeItem(LIVE_KEY)
  } catch {
    // see saveSettings
  }
}
