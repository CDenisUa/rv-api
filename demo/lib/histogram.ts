// Pure binning + curve sampling utilities for the chart. No DOM, no React.

export interface Bin {
  x0: number
  x1: number
  /** Probability density: count / (n · binWidth), so it overlays the analytic density directly. */
  density: number
}

export interface Range {
  min: number
  max: number
}

/** Robust plotting range from samples: clip to the 0.5–99.5 percentiles to ignore extreme tails. */
export function sampleRange(samples: Float64Array | number[]): Range {
  if (samples.length === 0) return { min: 0, max: 1 }
  const sorted = Float64Array.from(samples).sort()
  const lo = sorted[Math.floor(0.005 * (sorted.length - 1))]
  const hi = sorted[Math.ceil(0.995 * (sorted.length - 1))]
  if (hi <= lo) return { min: lo - 0.5, max: lo + 0.5 }
  return { min: lo, max: hi }
}

/** Bin samples into `count` equal-width density bins over `range`. */
export function histogram(samples: Float64Array | number[], range: Range, count = 40): Bin[] {
  const width = (range.max - range.min) / count
  const counts = new Array<number>(count).fill(0)
  for (const x of samples) {
    if (x < range.min || x > range.max) continue
    const idx = Math.min(count - 1, Math.floor((x - range.min) / width))
    counts[idx] += 1
  }
  const n = samples.length || 1
  return counts.map((c, i) => ({
    x0: range.min + i * width,
    x1: range.min + (i + 1) * width,
    density: c / (n * width),
  }))
}

export interface CurvePoint {
  x: number
  y: number
}

/** Evaluate `f` at `count` points across `range`, dropping non-finite values (out-of-support). */
export function curve(range: Range, count: number, f: (x: number) => number): CurvePoint[] {
  const step = (range.max - range.min) / (count - 1)
  const points: CurvePoint[] = []
  for (let i = 0; i < count; i++) {
    const x = range.min + i * step
    const y = f(x)
    if (Number.isFinite(y)) points.push({ x, y })
  }
  return points
}
