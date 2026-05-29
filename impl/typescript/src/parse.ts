/**
 * Document ↔ model conversion plus semantic validation (SPEC.md §6.2).
 *
 * Stage 1 (structural) is Zod (schema.ts). Stage 2 (semantic) lives here: weight/alignment rules,
 * parameter sanity (via distribution construction), and capability re-validation — the declared
 * capabilities MUST equal the values recomputed from structure, or the document is rejected.
 */

// Core
import { z } from 'zod'
// Services
import { capabilities } from './operations'
import { createDistribution } from './distributions'
import { zDocument, type RawNode } from './schema'
// Types
import {
  capabilitiesEqual,
  type Capabilities,
  type Joint,
  type Leaf,
  type Mixture,
  type RVNode,
  type Support,
  type Transform,
} from './model'
import { buildOp } from './ops'
// Errors
import { CapabilityMismatch, ValidationError } from './errors'

const WEIGHT_TOL = 1e-9

export interface ParseOptions {
  /** Run semantic validation (weights, capability match) after structural parse. Default true. */
  validate?: boolean
}

/** Parse a document object into the RV model, running structural + (by default) semantic validation. */
export function parseDocument(doc: unknown, options: ParseOptions = {}): RVNode {
  const { validate = true } = options
  const parsed = zDocument.safeParse(doc)
  if (!parsed.success) {
    throw new ValidationError(`document failed structural validation: ${formatZod(parsed.error)}`)
  }
  const node = parseNode(parsed.data.rv)
  if (validate) validateSemantics(node)
  return node
}

/** Convert a structurally-valid raw node into the rich model (builds Strategy ops, etc.). */
export function parseNode(raw: RawNode): RVNode {
  switch (raw.kind) {
    case 'leaf':
      return {
        kind: 'leaf',
        dist: raw.dist,
        params: raw.params,
        ...(raw.support
          ? {
              support: {
                ...(raw.support.lower !== undefined ? { lower: raw.support.lower } : {}),
                ...(raw.support.upper !== undefined ? { upper: raw.support.upper } : {}),
                lower_inclusive: raw.support.lower_inclusive ?? true,
                upper_inclusive: raw.support.upper_inclusive ?? true,
              },
            }
          : {}),
        ...(raw.capabilities ? { declared: raw.capabilities } : {}),
      }
    case 'joint':
      return {
        kind: 'joint',
        dims: raw.dims.map(parseNode),
        ...(raw.capabilities ? { declared: raw.capabilities } : {}),
      }
    case 'mixture':
      return {
        kind: 'mixture',
        weights: raw.weights,
        components: raw.components.map(parseNode),
        ...(raw.capabilities ? { declared: raw.capabilities } : {}),
      }
    case 'transform':
      return {
        kind: 'transform',
        base: parseNode(raw.base),
        op: buildOp(raw.op.name, raw.op.params),
        ...(raw.capabilities ? { declared: raw.capabilities } : {}),
      }
  }
}

/** Recursively enforce semantic invariants and capability consistency (SPEC.md §6.2). */
export function validateSemantics(node: RVNode): void {
  switch (node.kind) {
    case 'leaf': {
      // Constructing the distribution validates parameters (and, for empirical, the bulk_ref).
      createDistribution(node.dist, node.params)
      if (node.dist === 'categorical') {
        const probs = node.params['probs'] as number[]
        const categories = node.params['categories'] as number[]
        checkWeights(probs, 'categorical probs')
        if (categories.length !== probs.length) {
          throw new ValidationError('categorical categories/probs length mismatch')
        }
      }
      break
    }
    case 'joint':
      node.dims.forEach(validateSemantics)
      break
    case 'mixture':
      if (node.weights.length !== node.components.length) {
        throw new ValidationError('mixture weights/components length mismatch')
      }
      checkWeights(node.weights, 'mixture weights')
      node.components.forEach(validateSemantics)
      break
    case 'transform':
      validateSemantics(node.base)
      break
  }

  if (node.declared) {
    const computed = capabilities(node)
    if (!capabilitiesEqual(node.declared, computed)) {
      throw new CapabilityMismatch(
        `declared capabilities ${JSON.stringify(node.declared)} != computed ${JSON.stringify(computed)}`,
      )
    }
  }
}

/** Serialize a model node back to a plain document object, emitting recomputed capabilities. */
export function toDict(node: RVNode): Record<string, unknown> {
  const caps: Capabilities = capabilities(node)
  switch (node.kind) {
    case 'leaf': {
      const out: Record<string, unknown> = {
        kind: 'leaf',
        dist: node.dist,
        params: node.params,
        capabilities: caps,
      }
      if (node.support) out['support'] = supportDict(node.support)
      return out
    }
    case 'joint':
      return { kind: 'joint', dims: node.dims.map(toDict), capabilities: caps }
    case 'mixture':
      return {
        kind: 'mixture',
        weights: node.weights,
        components: node.components.map(toDict),
        capabilities: caps,
      }
    case 'transform':
      return {
        kind: 'transform',
        base: toDict(node.base),
        op: node.op.toJSON(),
        capabilities: caps,
      }
  }
}

export interface ToDocumentOptions {
  format_version?: string
  metadata?: Record<string, unknown>
}

export function toDocument(node: RVNode, options: ToDocumentOptions = {}): Record<string, unknown> {
  const { format_version = '1.0.0', metadata } = options
  const doc: Record<string, unknown> = { format_version, rv: toDict(node) }
  if (metadata !== undefined) doc['metadata'] = metadata
  return doc
}

function supportDict(s: Support): Record<string, unknown> {
  const out: Record<string, unknown> = {
    lower_inclusive: s.lower_inclusive,
    upper_inclusive: s.upper_inclusive,
  }
  if (s.lower !== undefined) out['lower'] = s.lower
  if (s.upper !== undefined) out['upper'] = s.upper
  return out
}

function checkWeights(weights: readonly number[], label: string): void {
  if (weights.some((w) => w < 0)) throw new ValidationError(`${label} must be non-negative`)
  const sum = weights.reduce((a, b) => a + b, 0)
  if (Math.abs(sum - 1) > WEIGHT_TOL) {
    throw new ValidationError(`${label} must sum to 1 (got ${sum})`)
  }
}

function formatZod(error: z.ZodError): string {
  return error.issues
    .slice(0, 3)
    .map((i) => `${i.path.join('.') || '<root>'}: ${i.message}`)
    .join('; ')
}

// Re-export types referenced by consumers building nodes directly.
export type { Leaf, Joint, Mixture, Transform }
