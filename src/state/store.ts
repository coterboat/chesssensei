import { create } from 'zustand'
import {
  GameController,
  type Color,
  type GameSnapshot,
  type PromotionPiece,
} from '../chess/gameController'
import { Engine, ENGINE_URL, workerTransport } from '../engine/engine'
import { BOT_ELO_MAX, BOT_ELO_MIN, chooseBotMove } from '../engine/play'
import type { Score } from '../engine/uci'

// The chess.js instance and the engine live outside the store; the store only holds snapshots.
export const controller = new GameController()
export const playEngine = new Engine(() => workerTransport())

export type ColorChoice = 'w' | 'b' | 'random'
export type Opponent = 'engine' | 'human'
export type EngineState = 'loading' | 'ready' | 'failed'

interface PendingPromotion {
  from: string
  to: string
  color: Color
}

export interface NewGameOptions {
  color?: ColorChoice
  botElo?: number
  opponent?: Opponent
  fen?: string
}

// Draw offers: the engine agrees only in a level, settled position.
const DRAW_MAX_CP = 30
const DRAW_EVAL_COUNT = 3
const DRAW_MIN_PLY = 30

const MIN_THINK_MS = 350

interface AppState {
  game: GameSnapshot
  /** Ply being previewed (0 = start position). null = following the live game. */
  viewPly: number | null
  orientation: 'white' | 'black'
  pendingPromotion: PendingPromotion | null
  /** Bumped whenever the board must be force-synced (e.g. a cancelled promotion). */
  boardRev: number

  opponent: Opponent
  colorChoice: ColorChoice
  playerColor: Color
  botElo: number
  engineState: EngineState
  thinking: boolean
  takebacks: number
  toast: string | null

  userMove: (from: string, to: string) => void
  choosePromotion: (piece: PromotionPiece) => void
  cancelPromotion: () => void
  newGame: (options?: NewGameOptions) => void
  takeback: () => void
  resign: () => void
  offerDraw: () => void
  flip: () => void
  setViewPly: (ply: number | null) => void
  stepView: (delta: number) => void
  setToast: (toast: string | null) => void
}

export const useStore = create<AppState>((set, get) => {
  // Identifies the current game so a search that finishes after New game / takeback is dropped.
  let gameToken = 0
  // The bot's honest evals (its POV) from its most recent moves, for draw offers.
  let botEvals: Score[] = []

  const sync = () => set((s) => ({ game: controller.snapshot(), boardRev: s.boardRev + 1 }))

  const botToMove = () => {
    const s = get()
    return s.opponent === 'engine' && !s.game.status.over && s.game.turn !== s.playerColor
  }

  const maybeBotMove = async () => {
    if (!botToMove() || get().thinking) return
    const token = gameToken
    set({ thinking: true })
    try {
      // Weak bots answer in ~50 ms; hold the reply briefly so it doesn't feel like a reflex.
      const [move] = await Promise.all([
        chooseBotMove(playEngine, controller.fen(), get().botElo),
        new Promise((r) => setTimeout(r, MIN_THINK_MS)),
      ])
      if (token !== gameToken) return
      if (move.score) botEvals = [...botEvals, move.score].slice(-DRAW_EVAL_COUNT)
      if (!controller.moveUci(move.uci)) throw new Error(`engine played illegal move ${move.uci}`)
      finishIfOver()
      sync()
    } catch (err) {
      if (token === gameToken) set({ engineState: 'failed', toast: `Engine error: ${(err as Error).message}` })
    } finally {
      if (token === gameToken) set({ thinking: false })
      else if (!get().thinking) void maybeBotMove()
    }
  }

  const finishIfOver = () => {
    const { result } = controller.status()
    if (result) controller.setHeaders({ Result: result })
  }

  const afterUserMove = () => {
    finishIfOver()
    sync()
    void maybeBotMove()
  }

  playEngine.onRestart = () => set({ toast: 'Engine crashed and was restarted.' })
  playEngine.init().then(
    () => {
      set({ engineState: 'ready' })
      void maybeBotMove()
    },
    (err: Error) => set({ engineState: 'failed', toast: `Engine failed to load (${ENGINE_URL}): ${err.message}` }),
  )

  return {
    game: controller.snapshot(),
    viewPly: null,
    orientation: 'white',
    pendingPromotion: null,
    boardRev: 0,

    opponent: 'engine',
    colorChoice: 'w',
    playerColor: 'w',
    botElo: 800,
    engineState: 'loading',
    thinking: false,
    takebacks: 0,
    toast: null,

    userMove: (from, to) => {
      const s = get()
      if (s.viewPly !== null || s.game.status.over) return
      if (s.opponent === 'engine' && s.game.turn !== s.playerColor) return sync()
      if (controller.isPromotion(from, to)) {
        set({ pendingPromotion: { from, to, color: controller.turn() } })
        return
      }
      controller.move(from, to)
      // Sync even on failure so the board snaps back to the real position.
      afterUserMove()
    },

    choosePromotion: (piece) => {
      const p = get().pendingPromotion
      if (!p) return
      controller.move(p.from, p.to, piece)
      set({ pendingPromotion: null })
      afterUserMove()
    },

    cancelPromotion: () => set((s) => ({ pendingPromotion: null, boardRev: s.boardRev + 1 })),

    newGame: (options = {}) => {
      const s = get()
      const colorChoice = options.color ?? s.colorChoice
      const opponent = options.opponent ?? s.opponent
      const botElo = Math.min(BOT_ELO_MAX, Math.max(BOT_ELO_MIN, Math.round(options.botElo ?? s.botElo)))
      const playerColor: Color = colorChoice === 'random' ? (Math.random() < 0.5 ? 'w' : 'b') : colorChoice

      controller.reset(options.fen) // throws on an invalid FEN, before any state changes
      gameToken++
      botEvals = []
      playEngine.stop()
      void playEngine.newGame().catch(() => undefined)

      const you = 'You'
      const bot = opponent === 'engine' ? `Stockfish (${botElo})` : 'Opponent'
      controller.setHeaders({
        Event: 'Chess Sensei training game',
        Site: 'Local',
        Date: new Date().toLocaleDateString('sv').replace(/-/g, '.'), // sv = YYYY-MM-DD in local time
        White: playerColor === 'w' ? you : bot,
        Black: playerColor === 'w' ? bot : you,
      })

      set({
        colorChoice,
        opponent,
        botElo,
        playerColor,
        orientation: playerColor === 'w' ? 'white' : 'black',
        viewPly: null,
        pendingPromotion: null,
        thinking: false,
        takebacks: 0,
      })
      sync()
      void maybeBotMove()
    },

    takeback: () => {
      const s = get()
      if (s.game.history.length === 0) return
      gameToken++
      playEngine.stop()
      botEvals = []
      controller.undo()
      // Against the engine, take back the full move pair so it is the player's turn again.
      if (s.opponent === 'engine' && controller.turn() !== s.playerColor && controller.history().length > 0) {
        controller.undo()
      }
      set({ thinking: false, viewPly: null, pendingPromotion: null, takebacks: s.takebacks + 1 })
      sync()
      void maybeBotMove()
    },

    resign: () => {
      const s = get()
      if (s.game.status.over) return
      gameToken++
      playEngine.stop()
      const loser = s.opponent === 'engine' ? s.playerColor : s.game.turn
      controller.end(loser === 'w' ? '0-1' : '1-0', 'resign')
      set({ thinking: false, viewPly: null, pendingPromotion: null })
      sync()
    },

    offerDraw: () => {
      const s = get()
      if (s.game.status.over || s.opponent !== 'engine') return
      const level =
        botEvals.length >= DRAW_EVAL_COUNT &&
        botEvals.every((e) => e.type === 'cp' && Math.abs(e.value) <= DRAW_MAX_CP)
      if (s.game.history.length < DRAW_MIN_PLY || !level) {
        set({ toast: 'Draw offer declined.' })
        return
      }
      gameToken++
      playEngine.stop()
      controller.end('1/2-1/2', 'draw-agree')
      set({ thinking: false, viewPly: null, toast: 'Draw offer accepted.' })
      sync()
    },

    flip: () => set((s) => ({ orientation: s.orientation === 'white' ? 'black' : 'white' })),

    setViewPly: (ply) => {
      const total = get().game.history.length
      if (ply === null || ply >= total) set({ viewPly: null })
      else set({ viewPly: Math.max(0, ply), pendingPromotion: null })
    },

    stepView: (delta) => {
      const { viewPly, game } = get()
      const current = viewPly ?? game.history.length
      get().setViewPly(current + delta)
    },

    setToast: (toast) => set({ toast }),
  }
})

if (import.meta.env.DEV) {
  // Debug/test hook: lets the game be driven from the console.
  ;(window as unknown as Record<string, unknown>).__cs = { controller, store: useStore, playEngine }
}
