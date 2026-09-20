// Tiny sound player. Files live in public/sounds (generated with Ludo.ai, see tools/).
export type SoundName = 'move' | 'capture' | 'check' | 'castle' | 'promote' | 'game-start' | 'game-end' | 'low-time' | 'illegal'

const cache = new Map<SoundName, HTMLAudioElement>()
let enabled = true

export function setSoundEnabled(on: boolean): void {
  enabled = on
}

export function playSound(name: SoundName, volume = 0.7): void {
  if (!enabled || typeof Audio === 'undefined') return
  let base = cache.get(name)
  if (!base) {
    base = new Audio(`/sounds/${name}.wav`)
    base.preload = 'auto'
    cache.set(name, base)
  }
  // Clone so quick successive moves can overlap instead of cutting each other off.
  const a = base.cloneNode() as HTMLAudioElement
  a.volume = volume
  // Browsers block audio until the first user gesture, and a missing file rejects too. Neither matters.
  void a.play().catch(() => undefined)
}

/** Picks the sound for a move from its SAN. */
export function soundForSan(san: string): SoundName {
  if (san.includes('#') || san.includes('+')) return 'check'
  if (san.includes('=')) return 'promote'
  if (san.startsWith('O-O')) return 'castle'
  if (san.includes('x')) return 'capture'
  return 'move'
}
