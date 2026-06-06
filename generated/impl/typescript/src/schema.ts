/**
 * Structural validation with Zod - the TypeScript-native door into the model.
 *
 * This mirrors the canonical JSON Schema (generated/spec/rv.schema.json) but in a form that yields static
 * types via inference, so the parser consumes a fully-typed document. The conformance suite
 * additionally checks every fixture against the canonical JSON Schema itself (with ajv), so the two
 * descriptions are kept honest against each other. Semantic rules that a schema cannot express
 * (weights sum to 1, capability propagation) live in parse.ts.
 */

// Core
import { z } from 'zod'

const zCapabilities = z
  .object({
    can_sample: z.boolean(),
    can_log_prob: z.boolean(),
    can_cdf: z.boolean(),
  })
  .strict()

const zSupport = z
  .object({
    lower: z.number().optional(),
    upper: z.number().optional(),
    lower_inclusive: z.boolean().optional(),
    upper_inclusive: z.boolean().optional(),
  })
  .strict()

const zBulkRef = z
  .object({
    format: z.enum(['npy', 'base64']),
    dtype: z.enum(['float32', 'float64', 'int32', 'int64']),
    shape: z.array(z.number().int().nonnegative()).length(1),
    path: z.string().optional(),
    data: z.string().optional(),
  })
  .strict()
  .refine((r) => (r.format === 'base64' ? r.data !== undefined : true), {
    message: 'base64 bulk_ref requires "data"',
  })
  .refine((r) => (r.format === 'npy' ? r.path !== undefined : true), {
    message: 'npy bulk_ref requires "path"',
  })

// Per-distribution parameter schemas (canonical names, SPEC.md §5.1).
const PARAM_SCHEMAS: Record<string, z.ZodTypeAny> = {
  normal: z.object({ mu: z.number(), sigma: z.number().positive() }).strict(),
  lognormal: z.object({ mu: z.number(), sigma: z.number().positive() }).strict(),
  weibull: z.object({ shape: z.number().positive(), scale: z.number().positive() }).strict(),
  uniform: z.object({ low: z.number(), high: z.number() }).strict(),
  exponential: z.object({ rate: z.number().positive() }).strict(),
  gamma: z.object({ shape: z.number().positive(), scale: z.number().positive() }).strict(),
  beta: z.object({ alpha: z.number().positive(), beta: z.number().positive() }).strict(),
  categorical: z
    .object({
      categories: z.array(z.number()).min(1),
      probs: z.array(z.number().nonnegative()).min(1),
    })
    .strict(),
  empirical: z.object({ samples: zBulkRef }).strict(),
}

const DIST_NAMES = Object.keys(PARAM_SCHEMAS) as [string, ...string[]]

const zLeaf = z
  .object({
    kind: z.literal('leaf'),
    dist: z.enum(DIST_NAMES),
    params: z.record(z.unknown()),
    capabilities: zCapabilities.optional(),
    support: zSupport.optional(),
    metadata: z.record(z.unknown()).optional(),
  })
  .strict()
  .superRefine((node, ctx) => {
    const result = PARAM_SCHEMAS[node.dist]!.safeParse(node.params)
    if (!result.success) {
      for (const issue of result.error.issues) {
        ctx.addIssue({ ...issue, path: ['params', ...issue.path] })
      }
    }
  })

const zOp = z
  .object({
    name: z.enum(['affine', 'exp', 'log', 'pow', 'abs']),
    params: z.record(z.number()).optional(),
  })
  .strict()
  .superRefine((op, ctx) => {
    if (op.name === 'affine') {
      if (op.params?.a === undefined || op.params?.b === undefined) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'affine requires params {a, b}' })
      } else if (op.params.a === 0) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'affine param a must be non-zero' })
      }
    }
    if (op.name === 'pow') {
      if (op.params?.exponent === undefined) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'pow requires params {exponent}' })
      } else if (op.params.exponent === 0) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'pow exponent must be non-zero' })
      }
    }
  })

// Recursive node union (z.lazy for the tree). The cast carries the hand-written RawNode type
// through the recursion, which Zod cannot infer for a self-referential schema.
export const zNode = z.lazy(() => z.union([zLeaf, zJoint, zMixture, zTransform])) as z.ZodType<RawNode>

const zJoint = z
  .object({
    kind: z.literal('joint'),
    dims: z.array(zNode).min(1),
    capabilities: zCapabilities.optional(),
    metadata: z.record(z.unknown()).optional(),
  })
  .strict()

const zMixture = z
  .object({
    kind: z.literal('mixture'),
    weights: z.array(z.number().nonnegative()).min(1),
    components: z.array(zNode).min(1),
    capabilities: zCapabilities.optional(),
    metadata: z.record(z.unknown()).optional(),
  })
  .strict()

const zTransform = z
  .object({
    kind: z.literal('transform'),
    base: zNode,
    op: zOp,
    capabilities: zCapabilities.optional(),
    metadata: z.record(z.unknown()).optional(),
  })
  .strict()

export const zDocument = z
  .object({
    format_version: z.string().regex(/^\d+\.\d+\.\d+$/),
    metadata: z.record(z.unknown()).optional(),
    rv: zNode,
  })
  .strict()

// Hand-written raw types (structural; the parser converts these into the rich model). Written by
// hand rather than inferred because the schema is self-referential (z.lazy cannot infer recursion).
export interface RawCapabilities {
  can_sample: boolean
  can_log_prob: boolean
  can_cdf: boolean
}
export interface RawSupport {
  lower?: number
  upper?: number
  lower_inclusive?: boolean
  upper_inclusive?: boolean
}
export interface RawOp {
  name: 'affine' | 'exp' | 'log' | 'pow' | 'abs'
  params?: Record<string, number>
}
export interface RawLeaf {
  kind: 'leaf'
  dist: string
  params: Record<string, unknown>
  capabilities?: RawCapabilities
  support?: RawSupport
  metadata?: Record<string, unknown>
}
export interface RawJoint {
  kind: 'joint'
  dims: RawNode[]
  capabilities?: RawCapabilities
  metadata?: Record<string, unknown>
}
export interface RawMixture {
  kind: 'mixture'
  weights: number[]
  components: RawNode[]
  capabilities?: RawCapabilities
  metadata?: Record<string, unknown>
}
export interface RawTransform {
  kind: 'transform'
  base: RawNode
  op: RawOp
  capabilities?: RawCapabilities
  metadata?: Record<string, unknown>
}
export type RawNode = RawLeaf | RawJoint | RawMixture | RawTransform
export interface RawDocument {
  format_version: string
  metadata?: Record<string, unknown>
  rv: RawNode
}
