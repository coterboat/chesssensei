const VALUES: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 }

/** Material balance in pawns from White's point of view (1/3/3/5/9). */
export function materialBalance(fen: string): number {
  let balance = 0
  for (const ch of fen.split(' ')[0]) {
    const v = VALUES[ch.toLowerCase()]
    if (v === undefined) continue
    balance += ch === ch.toLowerCase() ? -v : v
  }
  return balance
}
