// Calibrates the sub-1350 sampling bot against Stockfish's own UCI_Elo scale.
//
//   npm run calibrate -- --games 40 --temps 16,13,10,8,6.5,5,4,3 --write
//
// Every temperature level plays the UCI_Elo anchors and its neighbours; ratings are fitted with
// Bradley-Terry (anchors fixed), then inverted into src/engine/strengthTable.json.
import { spawn } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { cpus } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { GameController } from '../src/chess/gameController'
import { Engine, type Transport } from '../src/engine/engine'
import { chooseBotMove, type BotMove } from '../src/engine/play'
import { scoreToCp } from '../src/engine/uci'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const ENGINE_JS = join(root, 'node_modules/stockfish/bin/stockfish-19-lite-single.js')
const TABLE = join(root, 'src/engine/strengthTable.json')

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : fallback
}
const GAMES = Number(arg('games', '30'))
const TEMPS = arg('temps', '16,13,10,8,6.5,5,4,3').split(',').map(Number)
const ANCHORS = arg('anchors', '1320,1500,1800').split(',').filter(Boolean).map(Number)
// --fix T16=611 pins a sampling level to a rating from an earlier run (for extending the ladder).
const FIXED = arg('fix', '').split(',').filter(Boolean).map((kv) => kv.split('=') as [string, string])
const SLOTS = Number(arg('slots', String(Math.max(1, cpus().length - 2))))
const WRITE = process.argv.includes('--write')
const MAX_PLY = 240
const ADJUDICATE_CP = 900
const ADJUDICATE_COUNT = 5

type Player = { key: string; kind: 'sample'; temperature: number } | { key: string; kind: 'uci'; elo: number }

function nodeTransport(): Transport {
  const proc = spawn(process.execPath, [ENGINE_JS], { stdio: ['pipe', 'pipe', 'ignore'] })
  let buf = ''
  return {
    send: (cmd) => proc.stdin.write(cmd + '\n'),
    onLine: (cb) =>
      proc.stdout.on('data', (d: Buffer) => {
        buf += d.toString()
        const lines = buf.split('\n')
        buf = lines.pop() ?? ''
        lines.forEach(cb)
      }),
    onError: (cb) => {
      proc.on('error', cb)
      proc.on('exit', (code) => code && cb(new Error(`engine exited with ${code}`)))
    },
    terminate: () => proc.kill(),
  }
}

async function moveFor(p: Player, engine: Engine, fen: string): Promise<BotMove> {
  if (p.kind === 'sample') return chooseBotMove(engine, fen, 400, Math.random, { temperature: p.temperature })
  // Anchors talk to UCI_Elo directly: chooseBotMove would route anything under 1350 to the sampler.
  await engine.setOptions({ UCI_LimitStrength: true, UCI_Elo: p.elo })
  const res = await engine.search(fen, { movetime: 60 })
  if (!res.bestmove) throw new Error('anchor returned no move')
  return { uci: res.bestmove, score: null }
}

/** Returns White's score: 1, 0.5 or 0. */
async function playGame(white: Player, black: Player, engines: [Engine, Engine]): Promise<number> {
  const game = new GameController()
  await Promise.all(engines.map((e) => e.newGame()))
  let decided = 0 // signed count of consecutive decisive evals, + for White
  while (!game.status().over && game.history().length < MAX_PLY) {
    const whiteToMove = game.turn() === 'w'
    const mover = whiteToMove ? white : black
    const { uci, score } = await moveFor(mover, engines[whiteToMove ? 0 : 1], game.fen())
    if (!game.moveUci(uci)) throw new Error(`illegal engine move ${uci} in ${game.fen()}`)

    // Early adjudication on the sampling bot's honest full-strength eval (UCI_Elo scores are weakened).
    if (mover.kind === 'sample' && score) {
      const whiteCp = scoreToCp(score) * (whiteToMove ? 1 : -1)
      decided = Math.abs(whiteCp) >= ADJUDICATE_CP && Math.sign(whiteCp) === Math.sign(decided || whiteCp)
        ? decided + Math.sign(whiteCp)
        : 0
      if (Math.abs(decided) >= ADJUDICATE_COUNT && !game.status().over) return decided > 0 ? 1 : 0
    }
  }
  const status = game.status()
  if (status.over) return status.result === '1-0' ? 1 : status.result === '0-1' ? 0 : 0.5

  // Ply cap: adjudicate on a full-strength eval.
  await engines[0].setOptions({ UCI_LimitStrength: false })
  const res = await engines[0].search(game.fen(), { depth: 12 })
  const cp = res.lines[0] ? scoreToCp(res.lines[0].score) * (game.turn() === 'w' ? 1 : -1) : 0
  return cp > 300 ? 1 : cp < -300 ? 0 : 0.5
}

interface Pairing { a: Player; b: Player; scoreA: number; games: number }

/** Bradley-Terry / Elo maximum likelihood with anchor ratings held fixed. */
function fitRatings(pairings: Pairing[], fixed: Map<string, number>): Map<string, number> {
  const ratings = new Map<string, number>(fixed)
  for (const p of pairings) for (const pl of [p.a, p.b]) if (!ratings.has(pl.key)) ratings.set(pl.key, 1000)
  const expected = (ra: number, rb: number) => 1 / (1 + 10 ** ((rb - ra) / 400))
  for (let iter = 0; iter < 4000; iter++) {
    const grad = new Map<string, number>()
    for (const p of pairings) {
      const e = expected(ratings.get(p.a.key)!, ratings.get(p.b.key)!) * p.games
      grad.set(p.a.key, (grad.get(p.a.key) ?? 0) + (p.scoreA - e))
      grad.set(p.b.key, (grad.get(p.b.key) ?? 0) - (p.scoreA - e))
    }
    for (const [k, g] of grad) if (!fixed.has(k)) ratings.set(k, Math.max(-500, Math.min(3000, ratings.get(k)! + g * 2)))
  }
  return ratings
}

async function main() {
  const samples: Player[] = TEMPS.map((t) => ({ key: `T${t}`, kind: 'sample', temperature: t }))
  const anchors: Player[] = ANCHORS.map((elo) => ({ key: `uci${elo}`, kind: 'uci', elo }))
  const pairings: Pairing[] = []
  samples.forEach((s, i) => {
    for (const a of anchors) pairings.push({ a: s, b: a, scoreA: 0, games: 0 })
    if (i + 1 < samples.length) pairings.push({ a: s, b: samples[i + 1], scoreA: 0, games: 0 })
  })

  const jobs = pairings.flatMap((p) => Array.from({ length: GAMES }, (_, g) => ({ p, flip: g % 2 === 1 })))
  jobs.sort(() => Math.random() - 0.5)
  console.log(`${jobs.length} games, ${pairings.length} pairings, ${SLOTS} parallel slots`)

  let done = 0
  const started = Date.now()
  await Promise.all(
    Array.from({ length: SLOTS }, async () => {
      const engines: [Engine, Engine] = [new Engine(nodeTransport), new Engine(nodeTransport)]
      await Promise.all(engines.map((e) => e.init()))
      for (let job = jobs.pop(); job; job = jobs.pop()) {
        const { p, flip } = job
        const whiteScore = await playGame(flip ? p.b : p.a, flip ? p.a : p.b, engines)
        p.scoreA += flip ? 1 - whiteScore : whiteScore
        p.games++
        if (++done % 20 === 0) console.log(`  ${done} games, ${Math.round((Date.now() - started) / 1000)}s`)
      }
      engines.forEach((e) => e.quit())
    }),
  )

  for (const p of pairings) console.log(`${p.a.key.padEnd(6)} vs ${p.b.key.padEnd(8)} ${p.scoreA}/${p.games}`)
  const fixed = new Map<string, number>(anchors.map((a) => [a.key, (a as { elo: number }).elo]))
  for (const [key, elo] of FIXED) fixed.set(key, Number(elo))
  const ratings = fitRatings(pairings, fixed)
  const curve = samples
    .map((s) => ({ temperature: (s as { temperature: number }).temperature, elo: Math.round(ratings.get(s.key)!) }))
    .sort((x, y) => x.elo - y.elo)
  console.log('\nFitted:', curve)

  // Invert the (monotone-ish) curve to the Elo grid the app uses.
  const tempAt = (elo: number) => {
    if (elo <= curve[0].elo) return curve[0].temperature
    for (let i = 1; i < curve.length; i++) {
      if (elo <= curve[i].elo) {
        const [a, b] = [curve[i - 1], curve[i]]
        return a.temperature + ((elo - a.elo) / (b.elo - a.elo || 1)) * (b.temperature - a.temperature)
      }
    }
    return curve[curve.length - 1].temperature
  }
  const points = [400, 500, 600, 700, 800, 900, 1000, 1100, 1200, 1350].map((elo) => ({
    elo,
    temperature: Math.round(tempAt(elo) * 100) / 100,
  }))
  console.log('Table:', points)

  if (WRITE) {
    const table = JSON.parse(readFileSync(TABLE, 'utf8'))
    writeFileSync(TABLE, JSON.stringify({ ...table, calibrated: true, gamesPerPairing: GAMES, measured: curve, points }, null, 2) + '\n')
    console.log(`Wrote ${TABLE}`)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
