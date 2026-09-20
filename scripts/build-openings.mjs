// Builds public/openings.json from the lichess-org/chess-openings dataset (CC0).
//   node scripts/build-openings.mjs
// Every position along every line is a book position; only positions that end a named line get a name.
import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Chess } from 'chess.js'

const BASE = 'https://raw.githubusercontent.com/lichess-org/chess-openings/master'
const out = join(dirname(fileURLToPath(import.meta.url)), '../public/openings.json')
const epd = (fen) => fen.split(' ').slice(0, 4).join(' ')

const table = {}
let lines = 0
for (const file of ['a', 'b', 'c', 'd', 'e']) {
  const res = await fetch(`${BASE}/${file}.tsv`)
  if (!res.ok) throw new Error(`${file}.tsv: ${res.status}`)
  const rows = (await res.text()).trim().split('\n').slice(1)
  for (const row of rows) {
    const [eco, name, pgn] = row.split('\t')
    const chess = new Chess()
    const sans = pgn.replace(/\d+\.\s*/g, '').split(/\s+/).filter(Boolean)
    for (const san of sans) {
      chess.move(san)
      table[epd(chess.fen())] ??= ''
    }
    table[epd(chess.fen())] = `${eco}|${name}`
    lines++
  }
}
writeFileSync(out, JSON.stringify(table))
console.log(`${lines} opening lines -> ${Object.keys(table).length} positions -> ${out}`)
