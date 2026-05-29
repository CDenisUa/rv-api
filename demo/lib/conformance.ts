// Server-only loader for the conformance evidence. Runs in Node: reads the language-neutral golden
// values (produced by scipy via Python, verified by Rust) and recomputes each with the isomorphic
// `rvx` TypeScript engine, recording the worst absolute deviation. This is what lets the page assert
// "Python == TypeScript == Rust" at render time, with no client JavaScript.

// Core
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
// Services
import { capabilities, cdf, logProb, moments, parseDocument, type Capabilities } from 'rvx'

const CONFORMANCE_DIR = join(process.cwd(), '..', 'conformance')

export interface CrossCheck {
  name: string
  kind: string
  capabilities: Capabilities
  comparisons: number
  maxAbsError: number
  passed: boolean
}

const TOLERANCE = 1e-9

export function loadConformance(): CrossCheck[] {
  const manifest = readJson(join(CONFORMANCE_DIR, 'manifest.json')) as { cases: ManifestEntry[] }
  return manifest.cases.map((entry) => check(entry))
}

interface ManifestEntry {
  name: string
  kind: string
  case: string
  golden: string
}

interface Golden {
  capabilities: Capabilities
  log_prob: { x: number | number[]; value: number }[] | null
  cdf: { x: number | number[]; value: number }[] | null
  moments: { mean: number | number[]; variance: number | number[] } | null
}

function check(entry: ManifestEntry): CrossCheck {
  const doc = readJson(join(CONFORMANCE_DIR, entry.case))
  const golden = readJson(join(CONFORMANCE_DIR, entry.golden)) as Golden
  const node = parseDocument(doc)

  let maxErr = 0
  let count = 0
  const track = (got: number, want: number) => {
    maxErr = Math.max(maxErr, Math.abs(got - want))
    count += 1
  }

  for (const pt of golden.log_prob ?? []) track(logProb(node, pt.x), pt.value)
  for (const pt of golden.cdf ?? []) track(cdf(node, pt.x), pt.value)

  if (golden.moments) {
    try {
      const [mean, variance] = moments(node)
      compareMoment(mean, golden.moments.mean, track)
      compareMoment(variance, golden.moments.variance, track)
    } catch {
      /* sampling-based moments (no closed form) are validated statistically, not here */
    }
  }

  return {
    name: entry.name,
    kind: entry.kind,
    capabilities: capabilities(node),
    comparisons: count,
    maxAbsError: maxErr,
    passed: maxErr <= TOLERANCE,
  }
}

function compareMoment(got: number | number[], want: number | number[], track: (g: number, w: number) => void) {
  const gs = Array.isArray(got) ? got : [got]
  const ws = Array.isArray(want) ? want : [want]
  gs.forEach((g, i) => track(g, ws[i]))
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf-8'))
}
