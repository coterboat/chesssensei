import { create } from 'zustand'
import {
  GameController,
  type Color,
  type GameSnapshot,
  type PromotionPiece,
} from '../chess/gameController'

// The chess.js instance lives outside the store; the store only holds serializable snapshots.
export const controller = new GameController()

interface PendingPromotion {
  from: string
  to: string
  color: Color
}

interface AppState {
  game: GameSnapshot
  /** Ply being previewed (0 = start position). null = following the live game. */
  viewPly: number | null
  orientation: 'white' | 'black'
  pendingPromotion: PendingPromotion | null
  /** Bumped whenever the board must be force-synced (e.g. a cancelled promotion). */
  boardRev: number

  userMove: (from: string, to: string) => void
  choosePromotion: (piece: PromotionPiece) => void
  cancelPromotion: () => void
  newGame: (fen?: string) => void
  undo: () => void
  flip: () => void
  setViewPly: (ply: number | null) => void
  stepView: (delta: number) => void
}

export const useStore = create<AppState>((set, get) => {
  const sync = () => set({ game: controller.snapshot(), viewPly: null, pendingPromotion: null })

  return {
    game: controller.snapshot(),
    viewPly: null,
    orientation: 'white',
    pendingPromotion: null,
    boardRev: 0,

    userMove: (from, to) => {
      if (get().viewPly !== null || get().game.status.over) return
      if (controller.isPromotion(from, to)) {
        set({ pendingPromotion: { from, to, color: controller.turn() } })
        return
      }
      controller.move(from, to)
      // Sync even on failure so the board snaps back to the real position.
      set((s) => ({ game: controller.snapshot(), boardRev: s.boardRev + 1 }))
    },

    choosePromotion: (piece) => {
      const p = get().pendingPromotion
      if (!p) return
      controller.move(p.from, p.to, piece)
      set((s) => ({ boardRev: s.boardRev + 1 }))
      sync()
    },

    cancelPromotion: () => set((s) => ({ pendingPromotion: null, boardRev: s.boardRev + 1 })),

    newGame: (fen) => {
      controller.reset(fen)
      sync()
    },

    undo: () => {
      controller.undo()
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
  }
})

if (import.meta.env.DEV) {
  // Debug/test hook: lets the game be driven from the console.
  ;(window as unknown as Record<string, unknown>).__cs = { controller, store: useStore }
}
