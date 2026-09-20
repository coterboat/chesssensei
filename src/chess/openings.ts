import type { OpeningBook } from '../review/classify'

/** EPD = the first four FEN fields: position identity without move counters. */
export function epd(fen: string): string {
  return fen.split(' ').slice(0, 4).join(' ')
}

/** Table format: { epd: "ECO|Name" } for named positions, "" for unnamed book positions. */
export function bookFromTable(table: Record<string, string>): OpeningBook {
  return (fen) => {
    const hit = table[epd(fen)]
    if (hit === undefined) return undefined
    if (hit === '') return ''
    const [eco, name] = hit.split('|')
    return { eco, name }
  }
}

let cached: Promise<OpeningBook | undefined> | null = null

/** Lazily fetches public/openings.json. Resolves undefined if missing: reviews still work, minus Book. */
export function loadOpeningBook(): Promise<OpeningBook | undefined> {
  cached ??= fetch('/openings.json')
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
    .then(bookFromTable)
    .catch(() => undefined)
  return cached
}
