/**
 * Deterministic, seedable pseudo-random generator and the standard sampling primitives built on it.
 *
 * JavaScript's `Math.random` cannot be seeded, so we ship our own generator (`sfc32`, a small fast
 * counter-based PRNG of good statistical quality) seeded via `splitmix32`. RNG streams differ across
 * languages by design, so the conformance suite checks sampling statistically (KS + moments), not
 * byte-for-byte - this generator only needs to be correct in distribution, which it is.
 */

export class RNG {
  private a: number
  private b: number
  private c: number
  private d: number
  private spareNormal: number | null = null

  constructor(seed: number) {
    let s = seed >>> 0
    const mix = (): number => {
      s = (s + 0x9e3779b9) >>> 0
      let t = s
      t = Math.imul(t ^ (t >>> 16), 0x21f0aaad)
      t = Math.imul(t ^ (t >>> 15), 0x735a2d97)
      return (t ^ (t >>> 15)) >>> 0
    }
    this.a = mix()
    this.b = mix()
    this.c = mix()
    this.d = mix()
    // Warm up to decorrelate the seed-derived state.
    for (let i = 0; i < 16; i++) this.u32()
  }

  /** Raw 32-bit unsigned step (sfc32). */
  private u32(): number {
    this.a |= 0
    this.b |= 0
    this.c |= 0
    this.d |= 0
    const t = (((this.a + this.b) | 0) + this.d) | 0
    this.d = (this.d + 1) | 0
    this.a = this.b ^ (this.b >>> 9)
    this.b = (this.c + (this.c << 3)) | 0
    this.c = (this.c << 21) | (this.c >>> 11)
    this.c = (this.c + t) | 0
    return t >>> 0
  }

  /** Uniform double in [0, 1). */
  uniform(): number {
    return this.u32() / 4294967296
  }

  /** Uniform double in [lo, hi). */
  range(lo: number, hi: number): number {
    return lo + this.uniform() * (hi - lo)
  }

  /** Uniform integer in [0, k). */
  int(k: number): number {
    return Math.floor(this.uniform() * k)
  }

  /** Standard normal via Box-Muller (caches the second deviate). */
  normal(): number {
    if (this.spareNormal !== null) {
      const v = this.spareNormal
      this.spareNormal = null
      return v
    }
    let u1 = this.uniform()
    if (u1 < 1e-300) u1 = 1e-300
    const u2 = this.uniform()
    const r = Math.sqrt(-2 * Math.log(u1))
    this.spareNormal = r * Math.sin(2 * Math.PI * u2)
    return r * Math.cos(2 * Math.PI * u2)
  }

  /** Standard exponential (rate 1) via inverse CDF. */
  standardExponential(): number {
    return -Math.log(1 - this.uniform())
  }

  /** Standard gamma (scale 1) via Marsaglia-Tsang, with the U^(1/k) boost for shape < 1. */
  standardGamma(shape: number): number {
    if (shape < 1) {
      const u = this.uniform()
      return this.standardGamma(shape + 1) * Math.pow(u, 1 / shape)
    }
    const d = shape - 1 / 3
    const c = 1 / Math.sqrt(9 * d)
    for (;;) {
      let x: number
      let v: number
      do {
        x = this.normal()
        v = 1 + c * x
      } while (v <= 0)
      v = v * v * v
      const u = this.uniform()
      const x2 = x * x
      if (u < 1 - 0.0331 * x2 * x2) return d * v
      if (Math.log(u) < 0.5 * x2 + d * (1 - v + Math.log(v))) return d * v
    }
  }
}
