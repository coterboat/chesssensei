// Zero-dependency local server for the built app (dist/). Used by the macOS launcher:
//   node scripts/serve.mjs [port]
// Binds to 127.0.0.1 only. Has its own port (default 5180) rather than the dev server's 5173:
// the production build installs a service worker, which would otherwise hijack `npm run dev`.
import { spawn } from 'node:child_process'
import { createReadStream, existsSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { homedir, tmpdir } from 'node:os'
import { dirname, extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '../dist')
const port = Number(process.argv[2] ?? process.env.PORT ?? 5180)

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.wasm': 'application/wasm',
  '.png': 'image/png',
  '.wav': 'audio/wav',
  '.svg': 'image/svg+xml',
}

if (!existsSync(join(root, 'index.html'))) {
  console.error(`No build found in ${root}. Run "npm run build" first.`)
  process.exit(1)
}

// ---------- /api/coach: optional move explanations from a local LLM CLI ----------
// Nothing leaves this machine except through the CLI you are already logged into. The model only
// rephrases facts the app computed; it never sees the board through anything but those facts.
const COACH = {
  cmd: process.env.COACH_CMD ?? 'grok',
  // Low reasoning effort: ~4s a reply instead of ~12s, and the task is rephrasing, not analysis.
  args: (prompt, system) => [
    '-p', prompt, '--reasoning-effort', 'low', '--max-turns', '1', '--tools', '', '--disable-web-search',
    '--no-memory', '--no-subagents', '--no-plan', '--cwd', tmpdir(), '--system-prompt-override', system,
  ],
  system:
    'You are a concise, encouraging chess coach talking to the player. You are given FACTS computed by ' +
    'Stockfish. Explain in 2 or 3 short plain-text sentences why the move earned its label: what the ' +
    'refutation line does to the player, and what the best move achieves instead. Use ONLY moves that ' +
    'appear in the facts, and attribute each move to the right side: lines use standard numbering, so ' +
    '"14. Bd3" is a White move and "13... Qxd4" or the second move after a number is a Black move. ' +
    'Say "you" only for the player. Never invent variations, never change or question the label, no markdown, ' +
    'no engine jargon like centipawns.',
  timeoutMs: 45_000,
  maxConcurrent: 2,
}

// GUI-launched processes get a bare PATH, so look in the usual install spots too.
function resolveCmd(cmd) {
  if (cmd.includes('/')) return existsSync(cmd) ? cmd : null
  const dirs = [...(process.env.PATH ?? '').split(':'), '/opt/homebrew/bin', '/usr/local/bin', join(homedir(), '.local/bin')]
  return dirs.map((d) => join(d, cmd)).find((p) => existsSync(p)) ?? null
}
const coachBin = resolveCmd(COACH.cmd)
let coachRunning = 0

const localOrigin = (o) => !o || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(o)

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
  res.end(JSON.stringify(body))
}

function handleCoach(req, res) {
  // Only pages served from this machine may spawn the CLI.
  if (!localOrigin(req.headers.origin)) return json(res, 403, { error: 'forbidden' })
  if (req.method === 'GET') return json(res, 200, { available: coachBin !== null, provider: COACH.cmd })
  if (req.method !== 'POST') return json(res, 405, { error: 'method not allowed' })
  if (!coachBin) return json(res, 503, { error: `${COACH.cmd} CLI not found` })
  if (coachRunning >= COACH.maxConcurrent) return json(res, 429, { error: 'busy' })

  let body = ''
  req.on('data', (chunk) => {
    body += chunk
    if (body.length > 8192) req.destroy()
  })
  req.on('end', () => {
    let facts
    try {
      facts = JSON.parse(body).facts
      if (!facts || typeof facts !== 'object') throw new Error('no facts')
    } catch {
      return json(res, 400, { error: 'bad request' })
    }
    coachRunning++
    const started = Date.now()
    // argv, not a shell string: nothing in the facts can be interpreted as a command.
    const child = spawn(coachBin, COACH.args(`FACTS: ${JSON.stringify(facts)}`, COACH.system), { stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    let err = ''
    const timer = setTimeout(() => child.kill(), COACH.timeoutMs)
    // The reader moved on to another move before the reply came: don't finish the call for nothing.
    res.on('close', () => !res.writableEnded && child.kill())
    child.stdout.on('data', (d) => (out += d))
    child.stderr.on('data', (d) => (err += d))
    child.on('error', (e) => (err += e.message))
    child.on('close', (code) => {
      clearTimeout(timer)
      coachRunning--
      const text = out.trim()
      if (code === 0 && text) return json(res, 200, { text, ms: Date.now() - started })
      console.error(`coach failed (${code}): ${err.trim().slice(0, 300)}`)
      json(res, 502, { error: 'coach failed' })
    })
  })
}

createServer((req, res) => {
  if (req.url?.startsWith('/api/coach')) return handleCoach(req, res)
  const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname))
  let file = join(root, path)
  // Stay inside dist/, and fall back to the app shell for anything that isn't a real file.
  if (!file.startsWith(root) || !existsSync(file) || statSync(file).isDirectory()) file = join(root, 'index.html')
  const immutable = path.startsWith('/assets/')
  res.writeHead(200, {
    'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream',
    'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
  })
  createReadStream(file).pipe(res)
}).listen(port, '127.0.0.1', () => console.log(`Chess Sensei on http://localhost:${port}`))
