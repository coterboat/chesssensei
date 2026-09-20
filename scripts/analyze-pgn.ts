// Headless game review, for sanity-checking the analyzer:  npx tsx scripts/analyze-pgn.ts game.pgn
import { readFileSync } from 'node:fs'
import { Chess } from 'chess.js'
import { GameController } from '../src/chess/gameController'
import { bookFromTable } from '../src/chess/openings'
import { analyzePositions } from '../src/engine/analyze'
import { Engine } from '../src/engine/engine'
import { classifyGame } from '../src/review/classify'
import { nodeTransport } from './nodeTransport'

const parsed = new Chess()
parsed.loadPgn(readFileSync(process.argv[2], 'utf8'))
const game = new GameController()
for (const m of parsed.history({ verbose: true })) game.moveUci(m.from + m.to + (m.promotion ?? ''))
const plies = game.history()

const engine = new Engine(nodeTransport)
const started = Date.now()
const evals = await analyzePositions(engine, [plies[0].fenBefore, ...plies.map((p) => p.fenAfter)])
engine.quit()
const book = bookFromTable(JSON.parse(readFileSync('public/openings.json', 'utf8')))
const a = classifyGame(plies, evals!, book)

for (const m of a.moves) {
  const no = m.side === 'w' ? `${Math.ceil(m.ply / 2)}.` : '   …'
  console.log(
    `${no.padEnd(5)}${m.san.padEnd(8)}${m.classification.padEnd(11)} loss ${m.winLoss.toFixed(1).padStart(5)}  win ${m.winBefore.toFixed(0).padStart(3)}→${m.winAfter.toFixed(0).padStart(3)}  ${m.bestSan && m.bestUci !== m.uci ? 'best ' + m.bestSan : ''}`,
  )
}
console.log(`\nOpening: ${a.opening ? `${a.opening.eco} ${a.opening.name}` : '-'} (book through ply ${a.bookPlies})`)
console.log(`Accuracy  W ${a.accuracy.w.toFixed(1)} (~${a.estimatedElo.w})   B ${a.accuracy.b.toFixed(1)} (~${a.estimatedElo.b})`)
console.log(`${evals!.length} positions in ${((Date.now() - started) / 1000).toFixed(1)}s`)
