/**
 * Negative conformance suite: every document under conformance/invalid/ MUST be rejected.
 *
 * This is the cross-language negative contract that complements the happy-path golden suite. Error
 * messages differ by language, so the assertion is "rejected", not "rejected with message X".
 */

// Core
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
// Under test
import { parseDocument } from '../src/index'
import { ValidationError } from '../src/errors'

const HERE = dirname(fileURLToPath(import.meta.url))
const INVALID = resolve(HERE, '../../../..', 'conformance', 'invalid')

function loadJson(path: string): any {
  return JSON.parse(readFileSync(path, 'utf-8'))
}

interface InvalidEntry {
  name: string
  doc: string
  reason: string
}

const manifest = loadJson(resolve(INVALID, 'manifest.json'))
const cases: Array<{ name: string; doc: unknown }> = (manifest.cases as InvalidEntry[]).map((e) => ({
  name: e.name,
  doc: loadJson(resolve(INVALID, e.doc)),
}))

describe('negative conformance (conformance/invalid)', () => {
  it.each(cases.map((c) => [c.name, c.doc] as const))('rejects %s', (_name, doc) => {
    expect(() => parseDocument(doc)).toThrow(ValidationError)
  })
})
