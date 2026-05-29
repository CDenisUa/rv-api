/**
 * Property-based tests (fast-check): round-trip identity, statistical equivalence, and the
 * structural/semantic invariants that JSON Schema cannot express.
 */

// Core
import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
// Under test
import {
  capabilities,
  cdf,
  parseDocument,
  sample,
  toDict,
  RNG,
  CapabilityError,
  CapabilityMismatch,
  ValidationError,
} from '../src/index'

function normalDoc(mu: number, sigma: number) {
  return { format_version: '1.0.0', rv: { kind: 'leaf', dist: 'normal', params: { mu, sigma } } }
}

function ksStatistic(xs: Float64Array, F: (x: number) => number): number {
  const sorted = Float64Array.from(xs).sort()
  const n = sorted.length
  let d = 0
  for (let i = 0; i < n; i++) {
    const f = F(sorted[i]!)
    d = Math.max(d, (i + 1) / n - f, f - i / n)
  }
  return d
}

describe('round-trip identity', () => {
  it('parse → serialize → parse → serialize is idempotent (canonical form)', () => {
    fc.assert(
      fc.property(
        fc.double({ min: -10, max: 10, noNaN: true }),
        fc.double({ min: 0.1, max: 5, noNaN: true }),
        (mu, sigma) => {
          const once = toDict(parseDocument(normalDoc(mu, sigma)))
          const twice = toDict(parseDocument({ format_version: '1.0.0', rv: once }))
          expect(twice).toEqual(once)
        },
      ),
      { numRuns: 50 },
    )
  })

  it('round-trips a mixture of two normals', () => {
    fc.assert(
      fc.property(fc.double({ min: 0.05, max: 0.95, noNaN: true }), (w) => {
        const doc = {
          format_version: '1.0.0',
          rv: {
            kind: 'mixture',
            weights: [w, 1 - w],
            components: [
              { kind: 'leaf', dist: 'normal', params: { mu: 0, sigma: 1 } },
              { kind: 'leaf', dist: 'normal', params: { mu: 3, sigma: 2 } },
            ],
          },
        }
        const once = toDict(parseDocument(doc))
        const twice = toDict(parseDocument({ format_version: '1.0.0', rv: once }))
        expect(twice).toEqual(once)
      }),
      { numRuns: 30 },
    )
  })
})

describe('statistical equivalence', () => {
  it('samples agree with the reconstructed RV’s own CDF (KS)', () => {
    fc.assert(
      fc.property(
        fc.double({ min: -3, max: 3, noNaN: true }),
        fc.double({ min: 0.5, max: 3, noNaN: true }),
        (mu, sigma) => {
          const node = parseDocument(normalDoc(mu, sigma))
          const xs = sample(node, new RNG(0), 20000) as Float64Array
          const ks = ksStatistic(xs, (a) => cdf(node, a))
          expect(ks).toBeLessThan(0.03)
        },
      ),
      { numRuns: 20 },
    )
  })
})

describe('semantic invariants', () => {
  it('rejects mixture weights that do not sum to one', () => {
    const bad = {
      format_version: '1.0.0',
      rv: {
        kind: 'mixture',
        weights: [0.5, 0.4],
        components: [
          { kind: 'leaf', dist: 'normal', params: { mu: 0, sigma: 1 } },
          { kind: 'leaf', dist: 'normal', params: { mu: 1, sigma: 1 } },
        ],
      },
    }
    expect(() => parseDocument(bad)).toThrow(ValidationError)
  })

  it('drops log_prob for a non-invertible transform (abs)', () => {
    const doc = {
      format_version: '1.0.0',
      rv: {
        kind: 'transform',
        op: { name: 'abs' },
        base: { kind: 'leaf', dist: 'normal', params: { mu: 0, sigma: 1 } },
      },
    }
    const node = parseDocument(doc)
    expect(capabilities(node).can_log_prob).toBe(false)
    expect(() => cdf(node, 1)).toThrow(CapabilityError)
  })

  it('rejects declared capabilities that contradict structure', () => {
    const doc = {
      format_version: '1.0.0',
      rv: {
        kind: 'leaf',
        dist: 'normal',
        params: { mu: 0, sigma: 1 },
        capabilities: { can_sample: true, can_log_prob: false, can_cdf: true },
      },
    }
    expect(() => parseDocument(doc)).toThrow(CapabilityMismatch)
  })

  it('rejects an invalid distribution parameter (sigma ≤ 0)', () => {
    const doc = { format_version: '1.0.0', rv: { kind: 'leaf', dist: 'normal', params: { mu: 0, sigma: -1 } } }
    expect(() => parseDocument(doc)).toThrow(ValidationError)
  })
})
