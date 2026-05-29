// Emit a JSON conformance + timing report for the TypeScript reference (evidence pack).
// For each conformance case: how many deterministic values were checked and the worst absolute
// deviation from golden; then micro-benchmark the hot paths. Run from the repo root:
//     npx tsx evidence/report.ts

// Core
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { performance } from 'node:perf_hooks'
// Services
import { capabilities, cdf, logProb, moments, parseDocument, sample, RNG, type RVNode } from '../impl/typescript/src/index'

const CONF = resolve(process.cwd(), 'conformance')
const load = (p: string): any => JSON.parse(readFileSync(p, 'utf-8'))
const vals = (x: number | number[]): number[] => (Array.isArray(x) ? x : [x])

function caseReport(doc: unknown, golden: any): { comparisons: number; max_abs_error: number } {
  const node = parseDocument(doc)
  let maxErr = 0
  let count = 0
  const track = (got: number, want: number) => {
    maxErr = Math.max(maxErr, Math.abs(got - want))
    count += 1
  }
  for (const pt of golden.log_prob ?? []) track(logProb(node, pt.x), pt.value)
  for (const pt of golden.cdf ?? []) track(cdf(node, pt.x), pt.value)
  if (golden.moments != null) {
    try {
      const [mean, variance] = moments(node)
      vals(mean).forEach((g, i) => track(g, vals(golden.moments.mean)[i]!))
      vals(variance).forEach((g, i) => track(g, vals(golden.moments.variance)[i]!))
    } catch {
      /* no closed-form moments */
    }
  }
  return { comparisons: count, max_abs_error: maxErr }
}

function timings() {
  const normal = parseDocument({ format_version: '1.0.0', rv: { kind: 'leaf', dist: 'normal', params: { mu: 0, sigma: 1 } } })
  const gamma = parseDocument({ format_version: '1.0.0', rv: { kind: 'leaf', dist: 'gamma', params: { shape: 2, scale: 2 } } })

  const n = 200_000
  let t = performance.now()
  sample(normal, new RNG(1), n)
  const sampleNs = ((performance.now() - t) / n) * 1e6

  const iters = 2_000_000
  t = performance.now()
  let acc = 0
  for (let i = 0; i < iters; i++) acc += logProb(normal as RVNode, i * 1e-6)
  const logProbNs = ((performance.now() - t) / iters) * 1e6
  if (acc === Infinity) console.error('unreachable')

  t = performance.now()
  acc = 0
  for (let i = 0; i < iters; i++) acc += cdf(gamma as RVNode, i * 1e-6)
  const cdfNs = ((performance.now() - t) / iters) * 1e6
  if (acc === Infinity) console.error('unreachable')

  return { sample_ns_per_draw: sampleNs, normal_log_prob_ns: logProbNs, gamma_cdf_ns: cdfNs }
}

function main() {
  const manifest = load(resolve(CONF, 'manifest.json'))
  const cases = manifest.cases.map((entry: any) => ({
    name: entry.name,
    ...caseReport(load(resolve(CONF, entry.case)), load(resolve(CONF, entry.golden))),
  }))
  process.stdout.write(JSON.stringify({ language: 'TypeScript', version: '1.0.0', cases, timings: timings() }))
}

main()
