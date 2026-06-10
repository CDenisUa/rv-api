// Headless half of the formal task demo: import (read) an `.rv-list.json` bundle written by
// another language (e.g. demo/cli/write_rv_list.py) with the TypeScript reference, validate every
// document, and sample it. Exits non-zero if any document fails to read.
//
// Run from the repo root:  npx tsx demo/cli/read_rv_list.ts demo/cli/rv-batch.rv-list.json

// Core
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
// Services
import { capabilities, moments, parseDocument, sample, RNG } from '../../generated/impl/typescript/src/index'

const SAMPLE_N = 100_000
const SEED = 4242

const path = process.argv[2]
if (!path) {
  console.error('usage: npx tsx demo/cli/read_rv_list.ts <bundle.rv-list.json>')
  process.exit(2)
}

const bundle = JSON.parse(readFileSync(resolve(path), 'utf-8'))
if (bundle?.kind !== 'rv_list' || !Array.isArray(bundle.items)) {
  console.error('not an .rv-list.json bundle (expected kind="rv_list" with items[])')
  process.exit(2)
}

const producer = bundle.producer?.language ?? 'unknown'
console.log(`reading ${bundle.items.length} RV documents written by ${producer} with TypeScript/rvx\n`)

let failures = 0
for (const item of bundle.items) {
  try {
    const node = parseDocument(item.document) // structural + semantic validation
    const caps = capabilities(node)
    const drawn = sample(node, new RNG(SEED), SAMPLE_N)
    const xs = drawn instanceof Float64Array ? drawn : drawn[0] // Joint: report dim 0
    let sum = 0
    for (const x of xs) sum += x
    const mean = sum / xs.length
    let analytic = ''
    try {
      const [m] = moments(node)
      analytic = ` (analytic mean ${JSON.stringify(m)})`
    } catch {
      analytic = ''
    }
    const capsText = Object.entries(caps)
      .filter(([, v]) => v)
      .map(([k]) => k.replace('can_', ''))
      .join('+')
    console.log(`  ok   ${item.id} [${item.type}] ${capsText} - sample mean ${mean.toFixed(4)}${analytic}`)
  } catch (e) {
    failures++
    console.log(`  FAIL ${item.id}: ${e instanceof Error ? e.message : String(e)}`)
  }
}

console.log(`\n${bundle.items.length - failures}/${bundle.items.length} documents read + sampled`)
process.exit(failures === 0 ? 0 : 1)
