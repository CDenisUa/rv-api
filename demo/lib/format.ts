// Number formatting helpers shared across the UI.

/** Compact, readable formatting for stats and axis labels. */
export function fmt(x: number, sig = 4): string {
  if (!Number.isFinite(x)) return x > 0 ? '∞' : x < 0 ? '−∞' : 'NaN'
  if (x === 0) return '0'
  const abs = Math.abs(x)
  if (abs >= 1e5 || abs < 1e-3) return x.toExponential(2)
  return Number(x.toPrecision(sig)).toString()
}

/** Format a value that may be a scalar or a per-dimension vector. */
export function fmtMoment(m: number | number[]): string {
  return Array.isArray(m) ? `[${m.map((v) => fmt(v)).join(', ')}]` : fmt(m)
}
