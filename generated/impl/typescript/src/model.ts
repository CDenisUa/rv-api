/**
 * Core model: the random-variable ADT as a discriminated union (Composite tree).
 *
 * An RV is one of four node kinds (Leaf | Joint | Mixture | Transform), discriminated by `kind`.
 * Operations are kept out of the nodes and implemented as Visitors (see operations.ts), so a new
 * operation can be added without touching the model (Open/Closed). The `visit` dispatcher uses a
 * `never` exhaustiveness check: adding a kind without handling it becomes a compile error.
 */

// Types
import type { Op } from './ops'

export interface Capabilities {
  can_sample: boolean
  can_log_prob: boolean
  can_cdf: boolean
}

export function allCapabilities(): Capabilities {
  return { can_sample: true, can_log_prob: true, can_cdf: true }
}

export function capabilitiesEqual(a: Capabilities, b: Capabilities): boolean {
  return (
    a.can_sample === b.can_sample &&
    a.can_log_prob === b.can_log_prob &&
    a.can_cdf === b.can_cdf
  )
}

export interface Support {
  lower?: number
  upper?: number
  lower_inclusive: boolean
  upper_inclusive: boolean
}

interface NodeBase {
  /** Capabilities as stated in the document (if any); the parser validates them against the
   *  recomputed values. */
  declared?: Capabilities
}

export interface Leaf extends NodeBase {
  kind: 'leaf'
  dist: string
  params: Record<string, unknown>
  support?: Support
}

export interface Joint extends NodeBase {
  kind: 'joint'
  dims: RVNode[]
}

export interface Mixture extends NodeBase {
  kind: 'mixture'
  weights: number[]
  components: RVNode[]
}

export interface Transform extends NodeBase {
  kind: 'transform'
  base: RVNode
  op: Op
}

export type RVNode = Leaf | Joint | Mixture | Transform

/**
 * Visitor over the four node kinds. Each operation (sample, log_prob, cdf, ...) is one visitor;
 * adding an operation does not modify the model.
 */
export interface RVVisitor<R> {
  leaf(node: Leaf): R
  joint(node: Joint): R
  mixture(node: Mixture): R
  transform(node: Transform): R
}

/** Double-dispatch over the union with compile-time exhaustiveness (`never`). */
export function visit<R>(node: RVNode, visitor: RVVisitor<R>): R {
  switch (node.kind) {
    case 'leaf':
      return visitor.leaf(node)
    case 'joint':
      return visitor.joint(node)
    case 'mixture':
      return visitor.mixture(node)
    case 'transform':
      return visitor.transform(node)
    default:
      return assertNever(node)
  }
}

function assertNever(node: never): never {
  throw new Error(`unhandled RV node kind: ${JSON.stringify(node)}`)
}
