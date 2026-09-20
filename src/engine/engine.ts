import { parseBestMove, parseInfo, type InfoLine } from './uci'

/** Line-based pipe to a UCI engine. Browser: Web Worker. Node (calibration): child process. */
export interface Transport {
  send(cmd: string): void
  onLine(cb: (line: string) => void): void
  onError(cb: (err: Error) => void): void
  terminate(): void
}

export interface SearchLimits {
  movetime?: number
  depth?: number
  nodes?: number
}

export interface SearchResult {
  bestmove: string | null
  /** Latest info per multipv index, best first. Scores are side-to-move relative. */
  lines: InfoLine[]
}

export type EngineOptions = Record<string, string | number | boolean>

const INIT_TIMEOUT_MS = 20000
const SEARCH_GRACE_MS = 8000

/** Serializes UCI commands so searches never overlap, and restarts a dead engine once. */
export class Engine {
  private transport: Transport | null = null
  private chain: Promise<unknown> = Promise.resolve()
  private lineHandler: ((line: string) => void) | null = null
  private failCurrent: ((err: Error) => void) | null = null
  private applied: EngineOptions = {}
  private restarted = false
  private searching = false

  /** Called after the engine died and was successfully restarted. */
  onRestart?: () => void

  constructor(private makeTransport: () => Transport) {}

  init(): Promise<void> {
    return this.enqueue(() => this.boot())
  }

  setOptions(options: EngineOptions): Promise<void> {
    return this.enqueue(async () => {
      let changed = false
      for (const [name, value] of Object.entries(options)) {
        if (this.applied[name] === value) continue
        this.post(`setoption name ${name} value ${value}`)
        this.applied[name] = value
        changed = true
      }
      if (changed) await this.ready()
    })
  }

  newGame(): Promise<void> {
    return this.enqueue(async () => {
      this.post('ucinewgame')
      await this.ready()
    })
  }

  search(fen: string, limits: SearchLimits, multipv = 1): Promise<SearchResult> {
    return this.enqueue(async () => {
      if ((this.applied.MultiPV ?? 1) !== multipv) {
        this.post(`setoption name MultiPV value ${multipv}`)
        this.applied.MultiPV = multipv
      }
      this.post(`position fen ${fen}`)
      await this.ready()

      const go = ['go']
      if (limits.depth) go.push('depth', String(limits.depth))
      if (limits.nodes) go.push('nodes', String(limits.nodes))
      if (limits.movetime) go.push('movetime', String(limits.movetime))
      if (go.length === 1) go.push('depth', '12')

      const byPv = new Map<number, InfoLine>()
      this.searching = true
      try {
        const bestmove = await this.waitFor<string | null>(
          (line, done) => {
            const info = parseInfo(line)
            if (info) {
              // A bound line is the engine's newest opinion (often a refutation found just before
              // the time limit), so its score wins; its PV is truncated, so keep the fuller one.
              const prev = byPv.get(info.multipv)
              const keepPv = info.bound && prev && prev.pv[0] === info.pv[0] && prev.pv.length > info.pv.length
              byPv.set(info.multipv, keepPv ? { ...info, pv: prev.pv } : info)
              return
            }
            const best = parseBestMove(line)
            if (best) done(best.bestmove)
          },
          (limits.movetime ?? 0) + (limits.movetime ? SEARCH_GRACE_MS : 120000),
          () => this.post(go.join(' ')),
        )
        const lines = [...byPv.values()].sort((a, b) => a.multipv - b.multipv)
        // After a late fail-low the move the engine actually commits to may not be line 1.
        const chosen = lines.findIndex((l) => l.pv[0] === bestmove)
        if (chosen > 0) lines.unshift(...lines.splice(chosen, 1))
        return { bestmove, lines }
      } finally {
        this.searching = false
      }
    })
  }

  /** Ends the in-flight search early; its promise resolves with whatever was found. */
  stop(): void {
    if (this.searching) this.post('stop')
  }

  quit(): void {
    this.failCurrent?.(new Error('engine quit'))
    this.transport?.terminate()
    this.transport = null
  }

  // --- internals ---

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = async (): Promise<T> => {
      try {
        if (!this.transport) await this.boot()
        return await task()
      } catch (err) {
        if (this.restarted) throw err
        // One restart per engine lifetime, then retry the task that failed.
        this.restarted = true
        await this.boot()
        this.onRestart?.()
        return task()
      }
    }
    const result = this.chain.then(run, run)
    this.chain = result.catch(() => undefined)
    return result
  }

  private async boot(): Promise<void> {
    this.transport?.terminate()
    const t = this.makeTransport()
    this.transport = t
    t.onLine((line) => this.lineHandler?.(line.trim()))
    t.onError((err) => this.failCurrent?.(err))

    const wanted = this.applied
    this.applied = {}
    await this.waitFor<void>((line, done) => line === 'uciok' && done(), INIT_TIMEOUT_MS, () => this.post('uci'))
    for (const [name, value] of Object.entries(wanted)) {
      this.post(`setoption name ${name} value ${value}`)
      this.applied[name] = value
    }
    await this.ready()
  }

  private ready(): Promise<void> {
    return this.waitFor<void>((line, done) => line === 'readyok' && done(), INIT_TIMEOUT_MS, () => this.post('isready'))
  }

  private post(cmd: string): void {
    if (!this.transport) throw new Error('engine not running')
    this.transport.send(cmd)
  }

  private waitFor<T>(
    onLine: (line: string, done: (value: T) => void) => void,
    timeoutMs: number,
    start: () => void,
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const finish = () => {
        clearTimeout(timer)
        this.lineHandler = null
        this.failCurrent = null
      }
      const timer = setTimeout(() => {
        finish()
        reject(new Error('engine timed out'))
      }, timeoutMs)
      this.failCurrent = (err) => {
        finish()
        reject(err)
      }
      this.lineHandler = (line) =>
        onLine(line, (value) => {
          finish()
          resolve(value)
        })
      try {
        start()
      } catch (err) {
        finish()
        reject(err as Error)
      }
    })
  }
}

export const ENGINE_URL = '/stockfish/stockfish-19-lite-single.js'

export function workerTransport(url: string = ENGINE_URL): Transport {
  const worker = new Worker(url)
  return {
    send: (cmd) => worker.postMessage(cmd),
    onLine: (cb) => {
      worker.onmessage = (e: MessageEvent) => {
        if (typeof e.data === 'string') for (const line of e.data.split('\n')) cb(line)
      }
    },
    onError: (cb) => {
      worker.onerror = (e) => cb(new Error(e.message || `engine worker failed to load: ${url}`))
    },
    terminate: () => worker.terminate(),
  }
}
