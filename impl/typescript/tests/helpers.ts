/** Shared statistical helpers for the test suites (conformance + properties). */

/** One-sample Kolmogorov–Smirnov statistic of `xs` against the continuous CDF `F`. */
export function ksStatistic(xs: Float64Array, F: (x: number) => number): number {
  const sorted = Float64Array.from(xs).sort()
  const n = sorted.length
  let d = 0
  for (let i = 0; i < n; i++) {
    const f = F(sorted[i]!)
    d = Math.max(d, (i + 1) / n - f, f - i / n)
  }
  return d
}

/** Population mean and variance (ddof = 0). */
export function populationStats(xs: Float64Array): { mean: number; variance: number } {
  let sum = 0
  for (const v of xs) sum += v
  const mean = sum / xs.length
  let ss = 0
  for (const v of xs) ss += (v - mean) * (v - mean)
  return { mean, variance: ss / xs.length }
}
