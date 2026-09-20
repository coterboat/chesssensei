import { spawn } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Transport } from '../src/engine/engine'

const ENGINE_JS = join(dirname(fileURLToPath(import.meta.url)), '../node_modules/stockfish/bin/stockfish-19-lite-single.js')

/** Runs the same lite Stockfish build as the browser, as a child process. */
export function nodeTransport(): Transport {
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
