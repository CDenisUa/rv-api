/**
 * Operations over the RV tree, each implemented as a Visitor (model.RVVisitor).
 *
 * Adding an operation here never touches the model or the distribution catalog (Open/Closed).
 * Public convenience functions are exposed at the bottom and re-exported from the package root.
 */

// Services
import { createDistribution, type Distribution } from './distributions'
import { AliasSampler, logSumExp } from './numerics'
// Types
import {
  allCapabilities,
  visit,
  type Capabilities,
  type Joint,
  type Leaf,
  type Mixture,
  type RVNode,
  type RVVisitor,
  type Transform,
} from './model'
import { Affine } from './ops'
import type { RNG } from './rng'
// Errors
import { CapabilityError, MomentsNotAvailable } from './errors'

const NEG_INF = -Infinity

/**
 * Lazily build (and cache) the Distribution adapter for a Leaf. Operations on the same tree are
 * called repeatedly (e.g. a KS sweep evaluates cdf at every sample), so without this the empirical
 * KDE / base64 decode would be rebuilt per point. The cache is keyed on the parsed node identity.
 */
const distCache = new WeakMap<Leaf, Distribution>()
function leafDist(node: Leaf): Distribution {
  let d = distCache.get(node)
  if (d === undefined) {
    d = createDistribution(node.dist, node.params)
    distCache.set(node, d)
  }
  return d
}

/** Moments are scalar for univariate RVs and per-dimension arrays for Joint. */
export type Moment = number | number[]

/** Recompute capabilities bottom-up (SPEC.md §7). */
class CapabilitiesVisitor implements RVVisitor<Capabilities> {
  leaf(node: Leaf): Capabilities {
    return leafDist(node).capabilities()
  }
  joint(node: Joint): Capabilities {
    return this.and(node.dims)
  }
  mixture(node: Mixture): Capabilities {
    return this.and(node.components)
  }
  transform(node: Transform): Capabilities {
    const base = visit(node.base, this)
    return {
      can_sample: base.can_sample,
      can_log_prob: base.can_log_prob && node.op.invertible,
      can_cdf: base.can_cdf && node.op.monotone,
    }
  }
  private and(children: readonly RVNode[]): Capabilities {
    const caps = children.map((c) => visit(c, this))
    return {
      can_sample: caps.every((c) => c.can_sample),
      can_log_prob: caps.every((c) => c.can_log_prob),
      can_cdf: caps.every((c) => c.can_cdf),
    }
  }
}

/** Evaluate log-density/mass at a point. `x` is a scalar (or a vector for Joint). */
class LogProbVisitor implements RVVisitor<number> {
  constructor(private readonly x: number | number[]) {}
  leaf(node: Leaf): number {
    return leafDist(node).logProb(this.x as number)
  }
  joint(node: Joint): number {
    const xs = this.x as number[]
    let sum = 0
    for (let i = 0; i < node.dims.length; i++) sum += visit(node.dims[i]!, new LogProbVisitor(xs[i]!))
    return sum
  }
  mixture(node: Mixture): number {
    const terms = node.components.map(
      (comp, i) => Math.log(node.weights[i]!) + visit(comp, new LogProbVisitor(this.x)),
    )
    return logSumExp(terms)
  }
  transform(node: Transform): number {
    const op = node.op
    if (!op.invertible) {
      throw new CapabilityError(`log_prob unavailable: op '${op.name}' is not invertible`)
    }
    const y = this.x as number
    const xInv = op.inverse(y)
    const baseLp = visit(node.base, new LogProbVisitor(xInv))
    const out = baseLp + op.logAbsDInverse(y)
    return Number.isFinite(out) ? out : NEG_INF
  }
}

/** Evaluate P(X ≤ x). `x` is a scalar (or a vector for Joint). */
class CdfVisitor implements RVVisitor<number> {
  constructor(private readonly x: number | number[]) {}
  leaf(node: Leaf): number {
    return leafDist(node).cdf(this.x as number)
  }
  joint(node: Joint): number {
    const xs = this.x as number[]
    let prod = 1
    for (let i = 0; i < node.dims.length; i++) prod *= visit(node.dims[i]!, new CdfVisitor(xs[i]!))
    return prod
  }
  mixture(node: Mixture): number {
    let sum = 0
    for (let i = 0; i < node.components.length; i++) {
      sum += node.weights[i]! * visit(node.components[i]!, new CdfVisitor(this.x))
    }
    return sum
  }
  transform(node: Transform): number {
    const op = node.op
    if (!op.monotone) {
      throw new CapabilityError(`cdf unavailable: op '${op.name}' is not monotonic`)
    }
    const y = this.x as number
    const xInv = op.inverse(y)
    if (Number.isNaN(xInv)) {
      // Points below the op's image map to the appropriate tail (e.g. exp(x) ≤ 0 → cdf 0).
      return op.increasing ? 0 : 1
    }
    const baseCdf = visit(node.base, new CdfVisitor(xInv))
    return op.increasing ? baseCdf : 1 - baseCdf
  }
}

/** Sample output: univariate nodes yield a Float64Array; Joint yields one array per dimension. */
export type SampleResult = Float64Array | Float64Array[]

/** Draw `n` samples. */
class SampleVisitor implements RVVisitor<SampleResult> {
  constructor(
    private readonly rng: RNG,
    private readonly n: number,
  ) {}
  leaf(node: Leaf): SampleResult {
    return leafDist(node).sample(this.rng, this.n)
  }
  joint(node: Joint): SampleResult {
    return node.dims.map((dim) => visit(dim, this) as Float64Array)
  }
  mixture(node: Mixture): SampleResult {
    // Bucket draw positions by component in one O(n) pass, then sample each component once and
    // scatter back - O(n + k) rather than scanning all n per component.
    const idx = new AliasSampler(node.weights).sample(this.rng, this.n)
    const buckets: number[][] = node.components.map(() => [])
    for (let j = 0; j < this.n; j++) buckets[idx[j]!]!.push(j)
    const out = new Float64Array(this.n)
    for (let i = 0; i < node.components.length; i++) {
      const positions = buckets[i]!
      if (positions.length === 0) continue
      const drawn = visit(node.components[i]!, new SampleVisitor(this.rng, positions.length)) as Float64Array
      for (let j = 0; j < positions.length; j++) out[positions[j]!] = drawn[j]!
    }
    return out
  }
  transform(node: Transform): SampleResult {
    const base = visit(node.base, this) as Float64Array
    const out = new Float64Array(base.length)
    for (let i = 0; i < base.length; i++) out[i] = node.op.forward(base[i]!)
    return out
  }
}

/** Closed-form (mean, variance) where known; throws MomentsNotAvailable otherwise. */
class MomentsVisitor implements RVVisitor<[Moment, Moment]> {
  leaf(node: Leaf): [Moment, Moment] {
    return leafDist(node).moments()
  }
  joint(node: Joint): [Moment, Moment] {
    const means: number[] = []
    const vars: number[] = []
    for (const dim of node.dims) {
      const [m, v] = visit(dim, this)
      means.push(m as number)
      vars.push(v as number)
    }
    return [means, vars]
  }
  mixture(node: Mixture): [Moment, Moment] {
    let mean = 0
    let ex2 = 0
    for (let i = 0; i < node.components.length; i++) {
      const [m, v] = visit(node.components[i]!, this) as [number, number]
      const w = node.weights[i]!
      mean += w * m
      ex2 += w * (v + m * m)
    }
    return [mean, ex2 - mean * mean]
  }
  transform(node: Transform): [Moment, Moment] {
    if (node.op instanceof Affine) {
      const [m, v] = visit(node.base, this) as [number, number]
      return [node.op.a * m + node.op.b, node.op.a * node.op.a * v]
    }
    throw new MomentsNotAvailable(`no closed-form moments for transform op '${node.op.name}'`)
  }
}

// --- Public API ------------------------------------------------------------------------------

export function capabilities(node: RVNode): Capabilities {
  return visit(node, new CapabilitiesVisitor())
}

export function logProb(node: RVNode, x: number | number[]): number {
  return visit(node, new LogProbVisitor(x))
}

export function cdf(node: RVNode, x: number | number[]): number {
  return visit(node, new CdfVisitor(x))
}

export function sample(node: RVNode, rng: RNG, n: number): SampleResult {
  return visit(node, new SampleVisitor(rng, n))
}

export function moments(node: RVNode): [Moment, Moment] {
  return visit(node, new MomentsVisitor())
}

export { allCapabilities }
