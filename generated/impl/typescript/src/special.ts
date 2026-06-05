/**
 * Special functions needed to reproduce scipy.stats closed forms to ~1e-12.
 *
 * The conformance golden values were produced by scipy (the trusted reference). Without scipy in the
 * JS runtime we must implement the same mathematics with comparable accuracy:
 *   - `lgamma`       - Lanczos approximation (≈1e-15).
 *   - `regLowerGamma`- regularized lower incomplete gamma P(a,x) via series + continued fraction.
 *   - `erf`          - derived from P(1/2, x²) (reuses the incomplete-gamma machinery).
 *   - `regIncBeta`   - regularized incomplete beta Iₓ(a,b) via Lentz continued fraction.
 *
 * Algorithms follow Numerical Recipes (gser/gcf/betacf); they are deterministic and converge well
 * inside the suite's 1e-9 tolerance.
 */

const LANCZOS_G = 7
const LANCZOS_C = [
  0.9999999999998099, 676.5203681218851, -1259.1392167224028,
  771.3234287776531, -176.6150291621406, 12.507343278686905,
  -0.13857109526572012, 9.984369578019572e-6, 1.5056327351493116e-7,
]

const ITMAX = 300
const EPS = 3e-16
const FPMIN = 1e-300
const SQRT2 = Math.SQRT2

/** Natural log of the gamma function, valid for all real x (reflection for x < 0.5). */
export function lgamma(x: number): number {
  if (x < 0.5) {
    // Reflection: Γ(x)Γ(1−x) = π / sin(πx)
    return Math.log(Math.PI / Math.sin(Math.PI * x)) - lgamma(1 - x)
  }
  x -= 1
  let a = LANCZOS_C[0]!
  const t = x + LANCZOS_G + 0.5
  for (let i = 1; i < LANCZOS_G + 2; i++) a += LANCZOS_C[i]! / (x + i)
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a)
}

/** Series expansion for P(a,x), accurate for x < a+1. */
function gser(a: number, x: number): number {
  if (x <= 0) return 0
  let ap = a
  let sum = 1 / a
  let del = sum
  for (let n = 0; n < ITMAX; n++) {
    ap += 1
    del *= x / ap
    sum += del
    if (Math.abs(del) < Math.abs(sum) * EPS) break
  }
  return sum * Math.exp(-x + a * Math.log(x) - lgamma(a))
}

/** Continued fraction for Q(a,x) = 1 − P(a,x), accurate for x ≥ a+1 (Lentz's method). */
function gcf(a: number, x: number): number {
  let b = x + 1 - a
  let c = 1 / FPMIN
  let d = 1 / b
  let h = d
  for (let i = 1; i < ITMAX; i++) {
    const an = -i * (i - a)
    b += 2
    d = an * d + b
    if (Math.abs(d) < FPMIN) d = FPMIN
    c = b + an / c
    if (Math.abs(c) < FPMIN) c = FPMIN
    d = 1 / d
    const del = d * c
    h *= del
    if (Math.abs(del - 1) < EPS) break
  }
  return Math.exp(-x + a * Math.log(x) - lgamma(a)) * h
}

/** Regularized lower incomplete gamma P(a,x) = γ(a,x)/Γ(a). */
export function regLowerGamma(a: number, x: number): number {
  if (x < 0 || a <= 0) throw new RangeError('regLowerGamma: require x ≥ 0 and a > 0')
  if (x === 0) return 0
  if (x < a + 1) return gser(a, x)
  return 1 - gcf(a, x)
}

/** Error function, computed as sign(x)·P(1/2, x²). */
export function erf(x: number): number {
  if (x === 0) return 0
  const p = regLowerGamma(0.5, x * x)
  return x >= 0 ? p : -p
}

/** Standard-normal CDF Φ(x) = ½·(1 + erf(x/√2)). */
export function normalCdf(x: number): number {
  return 0.5 * (1 + erf(x / SQRT2))
}

/** Continued fraction for the incomplete beta (Lentz's method). */
function betacf(a: number, b: number, x: number): number {
  const qab = a + b
  const qap = a + 1
  const qam = a - 1
  let c = 1
  let d = 1 - (qab * x) / qap
  if (Math.abs(d) < FPMIN) d = FPMIN
  d = 1 / d
  let h = d
  for (let m = 1; m < ITMAX; m++) {
    const m2 = 2 * m
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2))
    d = 1 + aa * d
    if (Math.abs(d) < FPMIN) d = FPMIN
    c = 1 + aa / c
    if (Math.abs(c) < FPMIN) c = FPMIN
    d = 1 / d
    h *= d * c
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2))
    d = 1 + aa * d
    if (Math.abs(d) < FPMIN) d = FPMIN
    c = 1 + aa / c
    if (Math.abs(c) < FPMIN) c = FPMIN
    d = 1 / d
    const del = d * c
    h *= del
    if (Math.abs(del - 1) < EPS) break
  }
  return h
}

/** Regularized incomplete beta Iₓ(a,b). */
export function regIncBeta(a: number, b: number, x: number): number {
  if (x <= 0) return 0
  if (x >= 1) return 1
  const bt = Math.exp(
    lgamma(a + b) - lgamma(a) - lgamma(b) + a * Math.log(x) + b * Math.log(1 - x),
  )
  if (x < (a + 1) / (a + b + 2)) return (bt * betacf(a, b, x)) / a
  return 1 - (bt * betacf(b, a, 1 - x)) / b
}
