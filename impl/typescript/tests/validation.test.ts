/**
 * Negative-path validation: format-version rejection (SPEC.md §9) and support consistency (§6.1).
 */

// Core
import { describe, expect, it } from 'vitest'
// Under test
import { parseDocument } from '../src/index'
import { ValidationError } from '../src/errors'

const doc = (rv: unknown, format_version = '1.0.0') => ({ format_version, rv })
const leaf = (dist: string, params: Record<string, unknown>, support?: Record<string, unknown>) => ({
  kind: 'leaf',
  dist,
  params,
  ...(support ? { support } : {}),
})

describe('format version (SPEC.md §9)', () => {
  it('accepts the current major', () => {
    expect(parseDocument(doc(leaf('normal', { mu: 0, sigma: 1 }), '1.4.2'))).toBeTruthy()
  })
  it('rejects a future major', () => {
    expect(() => parseDocument(doc(leaf('normal', { mu: 0, sigma: 1 }), '2.0.0'))).toThrow(
      ValidationError,
    )
  })
})

describe('support consistency (SPEC.md §6.1)', () => {
  it('accepts a support within the natural support', () => {
    expect(
      parseDocument(doc(leaf('exponential', { rate: 1 }, { lower: 0.5, upper: 10 }))),
    ).toBeTruthy()
  })
  it('rejects a lower bound below the natural support', () => {
    expect(() => parseDocument(doc(leaf('exponential', { rate: 1 }, { lower: -1 })))).toThrow(
      /lower/,
    )
  })
  it('rejects an upper bound above the natural support', () => {
    expect(() =>
      parseDocument(doc(leaf('uniform', { low: 0, high: 1 }, { upper: 2 }))),
    ).toThrow(/upper/)
  })
})
