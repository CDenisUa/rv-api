/**
 * rvx - reference TypeScript implementation of the RV Exchange Format v1.
 *
 * Typical use:
 *
 *     import { parseDocument, logProb, sample, RNG } from 'rvx'
 *     const node = parseDocument(JSON.parse(text))
 *     logProb(node, 0)
 *     sample(node, new RNG(0), 1000)
 */

// Types
export {
  allCapabilities,
  capabilitiesEqual,
  visit,
  type Capabilities,
  type Joint,
  type Leaf,
  type Mixture,
  type RVNode,
  type RVVisitor,
  type Support,
  type Transform,
} from './model'
// Services
export {
  parseDocument,
  parseNode,
  validateSemantics,
  toDict,
  toDocument,
  type ParseOptions,
  type ToDocumentOptions,
} from './parse'
export { capabilities, cdf, logProb, moments, sample, type Moment } from './operations'
export {
  createDistribution,
  register,
  registeredNames,
  DISCRETE_DISTS,
  type Distribution,
} from './distributions'
export { zDocument, zNode, type RawDocument, type RawNode } from './schema'
export { buildOp, Affine, Exp, Log, Pow, Abs, type Op, type OpJSON } from './ops'
export { decodeBulk, encodeBulkBase64, type BulkRef } from './bulk'
export { RNG } from './rng'
export { AliasSampler, logSumExp } from './numerics'
// Errors
export {
  RVError,
  ValidationError,
  CapabilityError,
  CapabilityMismatch,
  MomentsNotAvailable,
  NotInvertibleError,
} from './errors'

export const VERSION = '1.1.0'
