import { Chess } from 'chess.js'
import { create } from 'zustand'
import { newClock, press, remaining, stop, timeControl, type ClockState } from '../chess/clock'
import {
  GameController,
  START_FEN,
  type Color,
  type GameSnapshot,
  type PromotionPiece,
} from '../chess/gameController'
import { Engine, ENGINE_URL, workerTransport } from '../engine/engine'
import { BOT_ELO_MAX, BOT_ELO_MIN, chooseBotMove } from '../engine/play'
import type { Score } from '../engine/uci'
import { loadOpeningBook } from '../chess/openings'
import { analyzePositions } from '../engine/analyze'
import { deleteAllGames, deleteGame, getGame, listGames, saveGame, type GameRecord } from '../persist/db'
import { expectedAccuracy } from '../review/accuracy'
import { classifyGame } from '../review/classify'
import { DEFAULT_SETTINGS, loadLiveGame, loadSettings, saveLiveGame, saveSettings, type Settings } from '../persist/settings'
import { playSound, setSoundEnabled, soundForSan } from '../ui/sound'
import { nextBotElo, qualityNudge, unratedReason, updateRating, type BotOffset } from '../review/adaptive'

// The chess.js instance and the engine live outside the store; the store only holds snapshots.
export const controller = new GameController()
export const playEngine = new Engine(() => workerTransport())
export const analysisEngine = new Engine(() => workerTransport())

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
  timeControl?: string
  retry?: { parentId: string; ply: number }
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
  timeControlId: string
  clock: ClockState | null

  settings: Settings
  /** Rating outcome of the game that just finished, shown until the next game starts. */
  lastRating: { before: number; after: number; unrated: string | null } | null
  savedGames: GameRecord[]
  screen: 'play' | 'review'
  reviewId: string | null
  /** Ply to show when the review screen opens (returning from a retry). */
  reviewPly: number | null
  analysisProgress: { id: string; done: number; total: number } | null
  /** Set while replaying a position from a reviewed game. */
  retry: { parentId: string; ply: number } | null
  /** Id of the most recently finished game, for the "Review game" button. */
  lastGameId: string | null

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
  setBotOffset: (offset: BotOffset) => void
  setBotLock: (elo: number | null) => void
  resetRating: () => void
  openReview: (id: string, ply?: number) => void
  closeReview: () => void
  startRetry: (record: GameRecord, ply: number) => void
  analyze: (id: string) => void
  updateSettings: (patch: Partial<Settings>) => void
  retryEngine: () => void
  importPgn: (pgn: string, playerColor: Color) => Promise<void>
  removeGame: (id: string) => Promise<void>
  removeAllGames: () => Promise<void>
}

export const useStore = create<AppState>((set, get) => {
  // Identifies the current game so a search that finishes after New game / takeback is dropped.
  let gameToken = 0
  // The bot's honest evals (its POV) from its most recent moves, for draw offers.
  let botEvals: Score[] = []

  // Guards against saving the same finished game twice.
  let recorded = false

  const sync = () => {
    set((s) => ({ game: controller.snapshot(), boardRev: s.boardRev + 1 }))
    const s = get()
    if (s.game.status.over) {
      if (s.clock?.running) set({ clock: stop(s.clock, Date.now()) })
      saveLiveGame(null)
      if (!recorded) {
        playSound('game-end')
        void recordGame()
      }
      return
    }
    saveLiveGame(
      s.game.history.length === 0
        ? null
        : {
            startFen: controller.startingFen(),
            ucis: s.game.history.map((p) => p.uci),
            playerColor: s.playerColor,
            opponent: s.opponent,
            botElo: s.botElo,
            takebacks: s.takebacks,
            timeControl: s.timeControlId,
            clock: s.clock ? { w: remaining(s.clock, 'w', Date.now()), b: remaining(s.clock, 'b', Date.now()) } : null,
            retry: s.retry,
          },
    )
  }

  /** A move was just made on the controller: sound + clock. */
  const afterMove = () => {
    const last = controller.history().at(-1)
    if (!last) return
    playSound(soundForSan(last.san))
    const { clock, timeControlId } = get()
    if (clock) set({ clock: press(clock, last.color, timeControl(timeControlId).increment, Date.now()) })
  }

  // Flag fall + low-time warning. The display itself ticks inside the Clock component.
  let warnedLowTime = false
  setInterval(() => {
    const s = get()
    if (!s.clock?.running || s.game.status.over) return
    const side = s.clock.running
    const left = remaining(s.clock, side, Date.now())
    if (left <= 0) {
      gameToken++
      playEngine.stop()
      controller.end(side === 'w' ? '0-1' : '1-0', 'time')
      set({ thinking: false, viewPly: null, pendingPromotion: null })
      sync()
    } else if (left < 20_000 && side === s.playerColor && !warnedLowTime) {
      warnedLowTime = true
      playSound('low-time')
    }
  }, 100)

  const updateSettings = (patch: Partial<Settings>) => {
    const settings = { ...get().settings, ...patch }
    saveSettings(settings)
    setSoundEnabled(settings.sound)
    set({ settings })
  }

  const adaptiveBotElo = (s: Settings) => s.botLock ?? nextBotElo(s.playerElo, s.botOffset, BOT_ELO_MIN, BOT_ELO_MAX)

  const recordGame = async () => {
    recorded = true
    const s = get()
    const { result, termination } = s.game.status
    if (s.opponent !== 'engine' || !result || !termination || s.game.history.length === 0) return

    const unrated = unratedReason({
      vsEngine: true,
      takebacks: s.takebacks,
      fromStartPosition: controller.startingFen() === START_FEN,
      plies: s.game.history.length,
      termination,
    })
    const playerWon = (result === '1-0') === (s.playerColor === 'w')
    const score = result === '1/2-1/2' ? 0.5 : playerWon ? 1 : 0
    const before = s.settings.playerElo
    const after = unrated ? before : updateRating(before, s.botElo, score, s.settings.gamesPlayed)

    const record: GameRecord = {
      id: crypto.randomUUID(),
      createdAt: Date.now(),
      playerColor: s.playerColor,
      botElo: s.botElo,
      playerEloBefore: before,
      playerEloAfter: after,
      rated: !unrated,
      unratedReason: unrated ?? undefined,
      timeControl: s.timeControlId === 'off' ? '-' : s.timeControlId,
      result,
      termination,
      startFen: controller.startingFen(),
      pgn: controller.pgn(),
      plies: s.game.history,
      analysisComplete: false,
      parentId: s.retry?.parentId,
      parentPly: s.retry?.ply,
    }

    if (!unrated) {
      updateSettings({
        playerElo: after,
        gamesPlayed: s.settings.gamesPlayed + 1,
        ratingHistory: [...s.settings.ratingHistory, { at: record.createdAt, elo: after }].slice(-500),
      })
    }
    set({ lastRating: { before, after, unrated } })
    try {
      await saveGame(record)
      set({ savedGames: await listGames(), lastGameId: record.id })
      if (!record.parentId) enqueueAnalysis(record.id)
    } catch (err) {
      set({ toast: `Could not save game: ${(err as Error).message}` })
    }
  }

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
      afterMove()
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

  // --- post-game analysis: one game at a time on its own engine ---
  const queue: string[] = []
  const cancelled = new Set<string>()
  let analysing = false

  const enqueueAnalysis = (id: string) => {
    if (!queue.includes(id)) queue.push(id)
    void pump()
  }

  const pump = async () => {
    if (analysing) return
    analysing = true
    try {
      for (let id = queue.shift(); id; id = queue.shift()) await analyseOne(id)
    } finally {
      analysing = false
      set({ analysisProgress: null })
    }
  }

  const analyseOne = async (id: string) => {
    const record = await getGame(id)
    if (!record || record.analysisComplete || record.plies.length === 0) return
    const fens = [record.plies[0].fenBefore, ...record.plies.map((p) => p.fenAfter)]
    set({ analysisProgress: { id, done: 0, total: fens.length } })
    try {
      const evals = await analyzePositions(analysisEngine, fens, {
        partial: record.evals,
        shouldCancel: () => cancelled.has(id),
        onProgress: (done, total, partial) => {
          set({ analysisProgress: { id, done, total } })
          // Checkpoint so closing the tab mid-analysis doesn't lose the work.
          if (done % 8 === 0) void saveGame({ ...record, evals: [...partial] }).catch(() => undefined)
        },
      })
      if (!evals || cancelled.has(id)) return

      const book = record.startFen === START_FEN ? await loadOpeningBook() : undefined
      const analysis = classifyGame(record.plies, evals, book)
      const done: GameRecord = { ...record, evals, analysis, analysisComplete: true }

      // Quality-of-play nudge, once, for rated games only.
      if (record.rated && record.qualityDelta === undefined) {
        const mine = analysis.accuracy[record.playerColor]
        done.qualityDelta = qualityNudge(mine, expectedAccuracy(record.playerEloBefore), record.plies.length)
        done.playerEloAfter = record.playerEloAfter + done.qualityDelta
        if (done.qualityDelta !== 0) {
          const s = get().settings
          const playerElo = s.playerElo + done.qualityDelta
          updateSettings({ playerElo, ratingHistory: [...s.ratingHistory.slice(0, -1), { at: Date.now(), elo: playerElo }] })
        }
      }
      await saveGame(done)
      set({ savedGames: await listGames() })
    } catch (err) {
      set({ toast: `Analysis failed: ${(err as Error).message}` })
    }
  }

  listGames().then(
    (savedGames) => {
      set({ savedGames })
      // Pick up anything a closed tab left unfinished, oldest first.
      ;[...savedGames].reverse().forEach((g) => !g.analysisComplete && !g.parentId && enqueueAnalysis(g.id))
    },
    () => undefined,
  )

  const initialSettings = loadSettings()
  setSoundEnabled(initialSettings.sound)

  playEngine.onRestart = () => set({ toast: 'Engine crashed and was restarted.' })
  playEngine.init().then(
    () => {
      set({ engineState: 'ready' })
      void maybeBotMove()
    },
    (err: Error) => set({ engineState: 'failed', toast: `Engine failed to load (${ENGINE_URL}): ${err.message}` }),
  )

  // Restore a game that was in progress when the tab last closed.
  const live = loadLiveGame()
  if (live) {
    try {
      controller.reset(live.startFen)
      for (const uci of live.ucis) if (!controller.moveUci(uci)) throw new Error('bad move')
    } catch {
      controller.reset()
      saveLiveGame(null)
    }
  }
  const restored = live && controller.history().length > 0 ? live : null
  const restoredClock: ClockState | null = restored?.clock
    ? { ...restored.clock, running: controller.turn(), since: Date.now() }
    : null

  return {
    game: controller.snapshot(),
    viewPly: null,
    orientation: (restored?.playerColor ?? initialSettings.colorChoice) === 'b' ? 'black' : 'white',
    pendingPromotion: null,
    boardRev: 0,

    opponent: restored?.opponent ?? 'engine',
    colorChoice: initialSettings.colorChoice === 'random' ? 'w' : initialSettings.colorChoice,
    playerColor: restored?.playerColor ?? (initialSettings.colorChoice === 'b' ? 'b' : 'w'),
    botElo: restored?.botElo ?? adaptiveBotElo(initialSettings),
    engineState: 'loading',
    thinking: false,
    takebacks: restored?.takebacks ?? 0,
    toast: null,
    timeControlId: restored?.timeControl ?? 'off',
    clock: restoredClock,

    settings: initialSettings,
    lastRating: null,
    savedGames: [],
    screen: 'play',
    reviewId: null,
    reviewPly: null,
    analysisProgress: null,
    retry: restored?.retry ?? null,
    lastGameId: null,

    userMove: (from, to) => {
      const s = get()
      if (s.viewPly !== null || s.game.status.over) return
      if (s.opponent === 'engine' && s.game.turn !== s.playerColor) return sync()
      if (controller.isPromotion(from, to)) {
        set({ pendingPromotion: { from, to, color: controller.turn() } })
        return
      }
      if (controller.move(from, to)) afterMove()
      else playSound('illegal', 0.4)
      // Sync even on failure so the board snaps back to the real position.
      afterUserMove()
    },

    choosePromotion: (piece) => {
      const p = get().pendingPromotion
      if (!p) return
      if (controller.move(p.from, p.to, piece)) afterMove()
      set({ pendingPromotion: null })
      afterUserMove()
    },

    cancelPromotion: () => set((s) => ({ pendingPromotion: null, boardRev: s.boardRev + 1 })),

    newGame: (options = {}) => {
      const s = get()
      const colorChoice = options.color ?? s.colorChoice
      const opponent = options.opponent ?? s.opponent
      const botElo = Math.min(BOT_ELO_MAX, Math.max(BOT_ELO_MIN, Math.round(options.botElo ?? adaptiveBotElo(s.settings))))
      const tcId = options.retry ? 'off' : (options.timeControl ?? s.settings.timeControl)
      const playerColor: Color = colorChoice === 'random' ? (Math.random() < 0.5 ? 'w' : 'b') : colorChoice

      controller.reset(options.fen) // throws on an invalid FEN, before any state changes
      gameToken++
      botEvals = []
      recorded = false
      warnedLowTime = false
      if (!options.retry && tcId !== s.settings.timeControl) updateSettings({ timeControl: tcId })
      if (!options.retry && colorChoice !== s.settings.colorChoice) updateSettings({ colorChoice })
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
        colorChoice: options.retry ? s.colorChoice : colorChoice,
        opponent,
        botElo,
        playerColor,
        orientation: playerColor === 'w' ? 'white' : 'black',
        viewPly: null,
        pendingPromotion: null,
        thinking: false,
        takebacks: 0,
        lastRating: null,
        lastGameId: null,
        timeControlId: tcId,
        clock: newClock(timeControl(tcId)),
        retry: options.retry ?? null,
        screen: 'play',
      })
      sync()
      playSound('game-start', 0.5)
      void maybeBotMove()
    },

    takeback: () => {
      const s = get()
      if (s.game.history.length === 0 || s.game.status.over || s.clock) return
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

    setBotOffset: (botOffset) => updateSettings({ botOffset }),
    setBotLock: (botLock) => updateSettings({ botLock }),

    resetRating: () =>
      updateSettings({
        playerElo: DEFAULT_SETTINGS.playerElo,
        gamesPlayed: 0,
        ratingHistory: [],
      }),

    openReview: (id, ply) => set({ screen: 'review', reviewId: id, reviewPly: ply ?? null }),
    closeReview: () => set({ screen: 'play' }),

    startRetry: (record, ply) => {
      const from = record.plies[ply - 1]
      if (!from) return
      get().newGame({
        fen: from.fenBefore,
        color: from.color,
        botElo: record.botElo,
        opponent: 'engine',
        retry: { parentId: record.id, ply },
      })
    },

    analyze: (id) => enqueueAnalysis(id),
    updateSettings: (patch) => updateSettings(patch),

    retryEngine: () => {
      set({ engineState: 'loading', toast: null })
      playEngine.quit()
      playEngine.init().then(
        () => {
          set({ engineState: 'ready' })
          void maybeBotMove()
        },
        (err: Error) => set({ engineState: 'failed', toast: `Engine failed to load (${ENGINE_URL}): ${err.message}` }),
      )
    },

    importPgn: async (pgn, playerColor) => {
      const parsed = new Chess()
      parsed.loadPgn(pgn) // throws on garbage; the caller shows the message
      const headers = parsed.getHeaders()
      const startFen = headers.FEN ?? START_FEN
      const replay = new GameController(startFen)
      for (const m of parsed.history({ verbose: true })) replay.moveUci(m.from + m.to + (m.promotion ?? ''))
      const plies = replay.history()
      if (plies.length === 0) throw new Error('That PGN has no moves.')

      const status = replay.status()
      const headerResult = headers.Result === '1-0' || headers.Result === '0-1' || headers.Result === '1/2-1/2' ? headers.Result : undefined
      const record: GameRecord = {
        id: crypto.randomUUID(),
        createdAt: Date.now(),
        playerColor,
        botElo: Number(playerColor === 'w' ? headers.BlackElo : headers.WhiteElo) || 0,
        playerEloBefore: get().settings.playerElo,
        playerEloAfter: get().settings.playerElo,
        rated: false,
        unratedReason: 'imported game',
        timeControl: headers.TimeControl ?? '-',
        result: status.result ?? headerResult ?? '1/2-1/2',
        termination: status.termination ?? (headerResult && headerResult !== '1/2-1/2' ? 'resign' : 'draw-agree'),
        startFen,
        pgn,
        plies,
        analysisComplete: false,
        imported: { white: headers.White ?? 'White', black: headers.Black ?? 'Black' },
      }
      await saveGame(record)
      set({ savedGames: await listGames() })
      enqueueAnalysis(record.id)
      get().openReview(record.id)
    },

    removeGame: async (id) => {
      cancelled.add(id)
      await deleteGame(id)
      if (get().reviewId === id) set({ screen: 'play', reviewId: null })
      set({ savedGames: await listGames() })
    },

    removeAllGames: async () => {
      get().savedGames.forEach((g) => cancelled.add(g.id))
      await deleteAllGames()
      set({ savedGames: [], screen: 'play', reviewId: null })
    },
  }
})

if (import.meta.env.DEV) {
  // Debug/test hook: lets the game be driven from the console.
  ;(window as unknown as Record<string, unknown>).__cs = { controller, store: useStore, playEngine }
}
