/**
 * Leaf distribution catalog (Registry/Factory pattern).
 *
 * Each distribution is created by name from canonical, library-independent parameters (SPEC.md §5)
 * and exposes a uniform interface (logProb, cdf, sample, moments, capabilities). Adding a
 * distribution = one `register(...)` - no existing code changes (Open/Closed). The analytic leaves
 * implement the same closed forms scipy.stats uses, via the special functions in special.ts.
 */

// Services
import { decodeBulk, type BulkRef } from './bulk'
import { AliasSampler, logSumExp } from './numerics'
import { erf, lgamma, normalCdf, regIncBeta, regLowerGamma } from './special'
// Types
import { allCapabilities, type Capabilities } from './model'
import type { RNG } from './rng'
// Errors
import { ValidationError } from './errors'

const LOG_2PI = Math.log(2 * Math.PI)
const NEG_INF = -Infinity

export interface Distribution {
  logProb(x: number): number
  cdf(x: number): number
  sample(rng: RNG, n: number): Float64Array
  moments(): [number, number]
  capabilities(): Capabilities
  /** Natural support as [lower, upper]; ±Infinity when unbounded (SPEC.md §5.1, §6.1). */
  support(): [number, number]
}

abstract class BaseDistribution implements Distribution {
  abstract logProb(x: number): number
  abstract cdf(x: number): number
  abstract sample(rng: RNG, n: number): Float64Array
  abstract moments(): [number, number]
  capabilities(): Capabilities {
    return allCapabilities()
  }
  support(): [number, number] {
    return [-Infinity, Infinity]
  }
}

class Normal extends BaseDistribution {
  constructor(
    private readonly mu: number,
    private readonly sigma: number,
  ) {
    super()
  }
  logProb(x: number): number {
    const z = (x - this.mu) / this.sigma
    return -Math.log(this.sigma) - 0.5 * LOG_2PI - 0.5 * z * z
  }
  cdf(x: number): number {
    return normalCdf((x - this.mu) / this.sigma)
  }
  sample(rng: RNG, n: number): Float64Array {
    const out = new Float64Array(n)
    for (let i = 0; i < n; i++) out[i] = this.mu + this.sigma * rng.normal()
    return out
  }
  moments(): [number, number] {
    return [this.mu, this.sigma * this.sigma]
  }
}

class LogNormal extends BaseDistribution {
  constructor(
    private readonly mu: number,
    private readonly sigma: number,
  ) {
    super()
  }
  logProb(x: number): number {
    if (x <= 0) return NEG_INF
    const z = (Math.log(x) - this.mu) / this.sigma
    return -Math.log(x) - Math.log(this.sigma) - 0.5 * LOG_2PI - 0.5 * z * z
  }
  cdf(x: number): number {
    if (x <= 0) return 0
    return normalCdf((Math.log(x) - this.mu) / this.sigma)
  }
  sample(rng: RNG, n: number): Float64Array {
    const out = new Float64Array(n)
    for (let i = 0; i < n; i++) out[i] = Math.exp(this.mu + this.sigma * rng.normal())
    return out
  }
  moments(): [number, number] {
    const s2 = this.sigma * this.sigma
    const mean = Math.exp(this.mu + s2 / 2)
    const variance = (Math.exp(s2) - 1) * Math.exp(2 * this.mu + s2)
    return [mean, variance]
  }
  override support(): [number, number] {
    return [0, Infinity]
  }
}

class Weibull extends BaseDistribution {
  constructor(
    private readonly shape: number,
    private readonly scale: number,
  ) {
    super()
  }
  logProb(x: number): number {
    const { shape: k, scale: lam } = this
    if (x < 0) return NEG_INF
    if (x === 0) return k > 1 ? NEG_INF : k === 1 ? -Math.log(lam) : Infinity
    return (
      Math.log(k) - Math.log(lam) + (k - 1) * (Math.log(x) - Math.log(lam)) - Math.pow(x / lam, k)
    )
  }
  cdf(x: number): number {
    if (x <= 0) return 0
    return 1 - Math.exp(-Math.pow(x / this.scale, this.shape))
  }
  sample(rng: RNG, n: number): Float64Array {
    const out = new Float64Array(n)
    for (let i = 0; i < n; i++) {
      out[i] = this.scale * Math.pow(rng.standardExponential(), 1 / this.shape)
    }
    return out
  }
  moments(): [number, number] {
    const g1 = Math.exp(lgamma(1 + 1 / this.shape))
    const g2 = Math.exp(lgamma(1 + 2 / this.shape))
    const mean = this.scale * g1
    const variance = this.scale * this.scale * (g2 - g1 * g1)
    return [mean, variance]
  }
  override support(): [number, number] {
    return [0, Infinity]
  }
}

class Uniform extends BaseDistribution {
  private readonly width: number
  constructor(
    private readonly low: number,
    private readonly high: number,
  ) {
    super()
    this.width = high - low
  }
  logProb(x: number): number {
    return x >= this.low && x <= this.high ? -Math.log(this.width) : NEG_INF
  }
  cdf(x: number): number {
    if (x < this.low) return 0
    if (x > this.high) return 1
    return (x - this.low) / this.width
  }
  sample(rng: RNG, n: number): Float64Array {
    const out = new Float64Array(n)
    for (let i = 0; i < n; i++) out[i] = rng.range(this.low, this.high)
    return out
  }
  moments(): [number, number] {
    return [(this.low + this.high) / 2, (this.width * this.width) / 12]
  }
  override support(): [number, number] {
    return [this.low, this.high]
  }
}

class Exponential extends BaseDistribution {
  constructor(private readonly rate: number) {
    super()
  }
  logProb(x: number): number {
    return x < 0 ? NEG_INF : Math.log(this.rate) - this.rate * x
  }
  cdf(x: number): number {
    return x < 0 ? 0 : 1 - Math.exp(-this.rate * x)
  }
  sample(rng: RNG, n: number): Float64Array {
    const out = new Float64Array(n)
    for (let i = 0; i < n; i++) out[i] = rng.standardExponential() / this.rate
    return out
  }
  moments(): [number, number] {
    return [1 / this.rate, 1 / (this.rate * this.rate)]
  }
  override support(): [number, number] {
    return [0, Infinity]
  }
}

class Gamma extends BaseDistribution {
  constructor(
    private readonly shape: number,
    private readonly scale: number,
  ) {
    super()
  }
  logProb(x: number): number {
    const { shape: a, scale: th } = this
    if (x < 0) return NEG_INF
    if (x === 0) return a < 1 ? Infinity : a === 1 ? -Math.log(th) : NEG_INF
    return -lgamma(a) - a * Math.log(th) + (a - 1) * Math.log(x) - x / th
  }
  cdf(x: number): number {
    if (x <= 0) return 0
    return regLowerGamma(this.shape, x / this.scale)
  }
  sample(rng: RNG, n: number): Float64Array {
    const out = new Float64Array(n)
    for (let i = 0; i < n; i++) out[i] = this.scale * rng.standardGamma(this.shape)
    return out
  }
  moments(): [number, number] {
    return [this.shape * this.scale, this.shape * this.scale * this.scale]
  }
  override support(): [number, number] {
    return [0, Infinity]
  }
}

class Beta extends BaseDistribution {
  private readonly logB: number
  constructor(
    private readonly alpha: number,
    private readonly beta: number,
  ) {
    super()
    this.logB = lgamma(alpha) + lgamma(beta) - lgamma(alpha + beta)
  }
  logProb(x: number): number {
    if (x <= 0 || x >= 1) return NEG_INF
    return (this.alpha - 1) * Math.log(x) + (this.beta - 1) * Math.log(1 - x) - this.logB
  }
  cdf(x: number): number {
    return regIncBeta(this.alpha, this.beta, x)
  }
  sample(rng: RNG, n: number): Float64Array {
    const out = new Float64Array(n)
    for (let i = 0; i < n; i++) {
      const ga = rng.standardGamma(this.alpha)
      const gb = rng.standardGamma(this.beta)
      out[i] = ga / (ga + gb)
    }
    return out
  }
  moments(): [number, number] {
    const s = this.alpha + this.beta
    const mean = this.alpha / s
    const variance = (this.alpha * this.beta) / (s * s * (s + 1))
    return [mean, variance]
  }
  override support(): [number, number] {
    return [0, 1]
  }
}

class Categorical extends BaseDistribution {
  private readonly catsSorted: number[]
  private readonly cumSorted: number[]
  private readonly alias: AliasSampler
  constructor(
    private readonly categories: number[],
    private readonly probs: number[],
  ) {
    super()
    const order = categories.map((_, i) => i).sort((a, b) => categories[a]! - categories[b]!)
    this.catsSorted = order.map((i) => categories[i]!)
    let acc = 0
    this.cumSorted = order.map((i) => (acc += probs[i]!))
    this.alias = new AliasSampler(probs)
  }
  logProb(x: number): number {
    for (let i = 0; i < this.categories.length; i++) {
      const c = this.categories[i]!
      if (Math.abs(x - c) <= 1e-8 + 1e-5 * Math.abs(c)) return Math.log(this.probs[i]!)
    }
    return NEG_INF
  }
  cdf(x: number): number {
    // Count of categories ≤ x (searchsorted, side="right"); cumulative prob up to that index.
    let lo = 0
    let hi = this.catsSorted.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (this.catsSorted[mid]! <= x) lo = mid + 1
      else hi = mid
    }
    return lo === 0 ? 0 : this.cumSorted[lo - 1]!
  }
  sample(rng: RNG, n: number): Float64Array {
    const idx = this.alias.sample(rng, n)
    const out = new Float64Array(n)
    for (let i = 0; i < n; i++) out[i] = this.categories[idx[i]!]!
    return out
  }
  moments(): [number, number] {
    let mean = 0
    for (let i = 0; i < this.categories.length; i++) mean += this.categories[i]! * this.probs[i]!
    let variance = 0
    for (let i = 0; i < this.categories.length; i++) {
      const d = this.categories[i]! - mean
      variance += this.probs[i]! * d * d
    }
    return [mean, variance]
  }
  override support(): [number, number] {
    return [Math.min(...this.categories), Math.max(...this.categories)]
  }
}

class Empirical extends BaseDistribution {
  private readonly n: number
  private readonly sorted: Float64Array
  private readonly meanVal: number
  private readonly cov: number
  constructor(private readonly samples: Float64Array) {
    super()
    const n = samples.length
    this.n = n
    this.sorted = Float64Array.from(samples).sort()
    let sum = 0
    for (const v of samples) sum += v
    this.meanVal = sum / n
    let ss = 0
    for (const v of samples) {
      const d = v - this.meanVal
      ss += d * d
    }
    // Scott's-rule bandwidth: h² = factor²·Var(ddof=1), factor = n^(−1/5) (SPEC.md §8.5).
    const var1 = ss / (n - 1)
    const factor = Math.pow(n, -1 / 5)
    this.cov = var1 * factor * factor
  }
  logProb(x: number): number {
    const terms = new Array<number>(this.n)
    const inv2cov = 0.5 / this.cov
    for (let i = 0; i < this.n; i++) {
      const d = x - this.samples[i]!
      terms[i] = -d * d * inv2cov
    }
    return logSumExp(terms) - Math.log(this.n) - 0.5 * Math.log(2 * Math.PI * this.cov)
  }
  cdf(x: number): number {
    // Empirical CDF: (count of samples ≤ x) / n.
    let lo = 0
    let hi = this.n
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (this.sorted[mid]! <= x) lo = mid + 1
      else hi = mid
    }
    return lo / this.n
  }
  sample(rng: RNG, n: number): Float64Array {
    const out = new Float64Array(n)
    for (let i = 0; i < n; i++) out[i] = this.samples[rng.int(this.n)]!
    return out
  }
  moments(): [number, number] {
    let ss = 0
    for (const v of this.samples) {
      const d = v - this.meanVal
      ss += d * d
    }
    return [this.meanVal, ss / this.n] // population variance (ddof=0)
  }
}

// --- Registry --------------------------------------------------------------------------------
type DistFactory = (params: Record<string, unknown>) => Distribution
const REGISTRY = new Map<string, DistFactory>()

export function register(name: string, factory: DistFactory): void {
  REGISTRY.set(name, factory)
}

export function createDistribution(dist: string, params: Record<string, unknown>): Distribution {
  const factory = REGISTRY.get(dist)
  if (!factory) throw new ValidationError(`unknown distribution '${dist}'`)
  return factory(params)
}

export function registeredNames(): ReadonlySet<string> {
  return new Set(REGISTRY.keys())
}

function num(params: Record<string, unknown>, key: string, dist: string): number {
  const v = params[key]
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    throw new ValidationError(`distribution '${dist}' requires numeric param '${key}'`)
  }
  return v
}

function positive(params: Record<string, unknown>, key: string, dist: string): number {
  const v = num(params, key, dist)
  if (v <= 0) throw new ValidationError(`distribution '${dist}' param '${key}' must be > 0`)
  return v
}

function numArray(params: Record<string, unknown>, key: string, dist: string): number[] {
  const v = params[key]
  if (!Array.isArray(v) || v.some((e) => typeof e !== 'number' || !Number.isFinite(e))) {
    throw new ValidationError(`distribution '${dist}' requires numeric array param '${key}'`)
  }
  return v as number[]
}

register('normal', (p) => new Normal(num(p, 'mu', 'normal'), positive(p, 'sigma', 'normal')))
register('lognormal', (p) => new LogNormal(num(p, 'mu', 'lognormal'), positive(p, 'sigma', 'lognormal')))
register('weibull', (p) => new Weibull(positive(p, 'shape', 'weibull'), positive(p, 'scale', 'weibull')))
register('uniform', (p) => {
  const low = num(p, 'low', 'uniform')
  const high = num(p, 'high', 'uniform')
  if (high <= low) throw new ValidationError("uniform requires high > low")
  return new Uniform(low, high)
})
register('exponential', (p) => new Exponential(positive(p, 'rate', 'exponential')))
register('gamma', (p) => new Gamma(positive(p, 'shape', 'gamma'), positive(p, 'scale', 'gamma')))
register('beta', (p) => new Beta(positive(p, 'alpha', 'beta'), positive(p, 'beta', 'beta')))
register('categorical', (p) => new Categorical(numArray(p, 'categories', 'categorical'), numArray(p, 'probs', 'categorical')))
register('empirical', (p) => new Empirical(decodeBulk(p['samples'] as BulkRef)))
