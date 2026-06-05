/**
 * Numerically-careful primitives used across operations.
 *  - `logSumExp`: stable log(Σ exp(a)) for mixture log-prob (SPEC.md §8.3).
 *  - `AliasSampler`: Vose's alias method, O(1) per draw after O(k) setup; used for categorical
 *    leaves and for mixture component selection (SPEC.md §8.3, §8.6).
 */

// Services
import type { RNG } from './rng'

/**
 * log(Σ exp(vᵢ)) computed as m + log(Σ exp(vᵢ − m)), m = max(v). Avoids overflow/underflow.
 * Treats −∞ entries correctly; returns −∞ when every entry is −∞.
 */
export function logSumExp(values: readonly number[]): number {
  let m = -Infinity
  for (const v of values) if (v > m) m = v
  if (!Number.isFinite(m)) return m // all −∞ → −∞; +∞ → +∞
  let sum = 0
  for (const v of values) sum += Math.exp(v - m)
  return m + Math.log(sum)
}

/**
 * Vose's alias method for sampling from a finite categorical distribution.
 * Setup is O(k); each draw is O(1). Returns category *indices*.
 */
export class AliasSampler {
  private readonly k: number
  private readonly prob: Float64Array
  private readonly alias: Int32Array

  constructor(weights: readonly number[]) {
    let total = 0
    for (const w of weights) {
      if (w < 0) throw new Error('weights must be non-negative')
      total += w
    }
    if (total <= 0) throw new Error('weights must sum to a positive value')

    const k = weights.length
    this.k = k
    this.prob = new Float64Array(k)
    this.alias = new Int32Array(k)

    const scaled = weights.map((w) => (w * k) / total)
    const small: number[] = []
    const large: number[] = []
    for (let i = 0; i < k; i++) (scaled[i]! < 1 ? small : large).push(i)

    while (small.length && large.length) {
      const s = small.pop()!
      const l = large.pop()!
      this.prob[s] = scaled[s]!
      this.alias[s] = l
      scaled[l] = scaled[l]! + scaled[s]! - 1
      ;(scaled[l]! < 1 ? small : large).push(l)
    }
    for (const i of large) this.prob[i] = 1
    for (const i of small) this.prob[i] = 1
  }

  /** Draw `n` category indices. */
  sample(rng: RNG, n: number): Int32Array {
    const out = new Int32Array(n)
    for (let i = 0; i < n; i++) {
      const col = rng.int(this.k)
      out[i] = rng.uniform() < this.prob[col]! ? col : this.alias[col]!
    }
    return out
  }
}
