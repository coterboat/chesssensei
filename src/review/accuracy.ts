// Lichess-style accuracy: a function of win-% lost, NOT of raw centipawn loss.

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x))

/** Accuracy (0–100) of one move given how many win-% points it gave away. */
export function moveAccuracy(winLoss: number): number {
  return clamp(103.1668 * Math.exp(-0.04354 * Math.max(0, winLoss)) - 3.1668, 0, 100)
}

/** Blend of arithmetic and harmonic means, so a couple of blunders hurt more than a plain average. */
export function gameAccuracy(moveAccuracies: number[]): number {
  if (moveAccuracies.length === 0) return 0
  const n = moveAccuracies.length
  const arithmetic = moveAccuracies.reduce((a, b) => a + b, 0) / n
  const harmonic = n / moveAccuracies.reduce((a, b) => a + 1 / Math.max(b, 1), 0)
  return (arithmetic + harmonic) / 2
}

// Rough anchors only. Tune after real games; always label the result as an estimate.
const ACCURACY_TO_ELO: [number, number][] = [
  [50, 400],
  [60, 700],
  [70, 1000],
  [77, 1300],
  [84, 1600],
  [90, 2000],
  [95, 2400],
  [99, 2800],
]

function interpolate(points: [number, number][], x: number): number {
  if (x <= points[0][0]) return points[0][1]
  for (let i = 1; i < points.length; i++) {
    if (x <= points[i][0]) {
      const [x0, y0] = points[i - 1]
      const [x1, y1] = points[i]
      return y0 + ((x - x0) / (x1 - x0)) * (y1 - y0)
    }
  }
  return points[points.length - 1][1]
}

export function estimateElo(accuracy: number): number {
  return Math.round(interpolate(ACCURACY_TO_ELO, accuracy) / 50) * 50
}

export function expectedAccuracy(elo: number): number {
  return interpolate(ACCURACY_TO_ELO.map(([a, e]) => [e, a] as [number, number]), elo)
}
