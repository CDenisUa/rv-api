/**
 * Run the language-neutral conformance suite against the rvx TypeScript implementation.
 *
 * Deterministic outputs (log_prob, cdf, analytic moments) must match golden within 1e-9. Stochastic
 * sampling is checked statistically (KS against the case's own CDF + moment tolerances). Each case is
 * also validated against the canonical JSON Schema (generated/spec/rv.schema.json) with ajv, independently of
 * the library's own Zod door - proving the fixtures and the contract agree.
 */

// Core
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import Ajv2020 from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'
// Under test
import { capabilities, cdf, logProb, moments, parseDocument, sample, RNG } from '../src/index'
import { MomentsNotAvailable } from '../src/errors'
// Utils
import { ksStatistic, populationStats } from './helpers'

const ABS_TOL = 1e-9
const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(HERE, '../../../..')
const CONFORMANCE = resolve(REPO_ROOT, 'conformance')
const SPEC = resolve(REPO_ROOT, 'generated', 'spec')

function loadJson(path: string): any {
  return JSON.parse(readFileSync(path, 'utf-8'))
}

interface CaseEntry {
  name: string
  case: string
  golden: string
}

const manifest = loadJson(resolve(CONFORMANCE, 'manifest.json'))
const cases: Array<{ name: string; doc: any; golden: any }> = (manifest.cases as CaseEntry[]).map(
  (entry) => ({
    name: entry.name,
    doc: loadJson(resolve(CONFORMANCE, entry.case)),
    golden: loadJson(resolve(CONFORMANCE, entry.golden)),
  }),
)

const schema = loadJson(resolve(SPEC, 'rv.schema.json'))
const ajv = new Ajv2020({ strict: false, allErrors: true })
addFormats(ajv as any)
const validateSchema = ajv.compile(schema)

function asArray(m: number | number[]): number[] {
  return Array.isArray(m) ? m : [m]
}

describe('conformance suite', () => {
  for (const { name, doc, golden } of cases) {
    describe(name, () => {
      it('validates against the canonical JSON Schema', () => {
        const ok = validateSchema(doc)
        expect(ok, ajv.errorsText(validateSchema.errors)).toBe(true)
      })

      it('passes semantic validation and matches golden capabilities', () => {
        const node = parseDocument(doc) // also semantically validates (incl. capability match)
        expect(capabilities(node)).toEqual(golden.capabilities)
      })

      it('reproduces log_prob within 1e-9', () => {
        if (golden.log_prob == null) {
          // Operation must be reported as unavailable.
          expect(golden.capabilities.can_log_prob).toBe(false)
          const node = parseDocument(doc)
          expect(() => logProb(node, 0)).toThrow()
          return
        }
        const node = parseDocument(doc)
        for (const pt of golden.log_prob) {
          expect(logProb(node, pt.x)).toBeCloseTo(pt.value, 9)
        }
      })

      it('reproduces cdf within 1e-9', () => {
        if (golden.cdf == null) {
          expect(golden.capabilities.can_cdf).toBe(false)
          const node = parseDocument(doc)
          expect(() => cdf(node, 0)).toThrow()
          return
        }
        const node = parseDocument(doc)
        for (const pt of golden.cdf) {
          expect(cdf(node, pt.x)).toBeCloseTo(pt.value, 9)
        }
      })

      it('reproduces moments', () => {
        const mom = golden.moments
        if (mom == null) return // no golden moments
        const node = parseDocument(doc)
        const samp = golden.sampling
        let mean: number | number[]
        let variance: number | number[]
        try {
          ;[mean, variance] = moments(node)
        } catch (e) {
          if (!(e instanceof MomentsNotAvailable)) throw e
          // No closed form → validate against golden via Monte Carlo (sampling tolerances).
          const xs = sample(node, new RNG(samp.seed), samp.n) as Float64Array
          const stats = populationStats(xs)
          expect(Math.abs(stats.mean - mom.mean)).toBeLessThanOrEqual(samp.mean_atol)
          expect(Math.abs(stats.variance - mom.variance)).toBeLessThanOrEqual(
            samp.var_rtol * Math.abs(mom.variance),
          )
          return
        }
        const means = asArray(mean)
        const vars = asArray(variance)
        const gMeans = asArray(mom.mean)
        const gVars = asArray(mom.variance)
        means.forEach((m, i) => expect(m).toBeCloseTo(gMeans[i]!, 9))
        vars.forEach((v, i) => expect(v).toBeCloseTo(gVars[i]!, 9))
      })

      it('produces samples consistent with its own CDF (KS + moments)', () => {
        const node = parseDocument(doc)
        const samp = golden.sampling
        const kind = doc.rv.kind
        const isCategorical = kind === 'leaf' && doc.rv.dist === 'categorical'
        const drawn = sample(node, new RNG(samp.seed), samp.n)

        if (kind === 'joint') {
          // Joint: sampling exercised, but KS/moments are checked per-dimension elsewhere.
          expect((drawn as Float64Array[]).length).toBe(doc.rv.dims.length)
          return
        }
        const xs = drawn as Float64Array

        if (samp.ks_stat_max != null && !isCategorical) {
          const ks = ksStatistic(xs, (a) => cdf(node, a))
          expect(ks, `KS=${ks}`).toBeLessThanOrEqual(samp.ks_stat_max)
        }

        const mom = golden.moments
        if (mom != null) {
          const stats = populationStats(xs)
          expect(Math.abs(stats.mean - mom.mean)).toBeLessThanOrEqual(samp.mean_atol)
          expect(Math.abs(stats.variance - mom.variance)).toBeLessThanOrEqual(
            samp.var_rtol * Math.abs(mom.variance),
          )
        }
      })
    })
  }
})
