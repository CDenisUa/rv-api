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

// --- Live proof ---------------------------------------------------------------------------------
// The frozen golden cases a generated engine can be checked against in the browser: only the leaf
// `normal`/`uniform` cases, since that is the scope of the compact live spec. Each carries the
// normalized compact document (canonical extras like `capabilities` stripped) plus the scalar golden
// values, so the client can run the just-generated compact engine over them. LiveProof owns its looser
// browser-generated tolerance; canonical replay remains at 1e-9.

export interface LiveProofPoint {
  x: number
  value: number
}

export interface LiveProofCase {
  name: string
  dist: 'normal' | 'uniform'
  /** Normalized to the compact format: { format_version, metadata, rv: { kind, dist, params } }. */
  doc: { format_version: string; metadata?: unknown; rv: { kind: 'leaf'; dist: string; params: Record<string, number> } }
  logProb: LiveProofPoint[]
  cdf: LiveProofPoint[]
  moments: { mean: number; variance: number } | null
}

export function loadLiveProofCases(): LiveProofCase[] {
  const manifest = readJson(join(CONFORMANCE_DIR, 'manifest.json')) as { cases: ManifestEntry[] }
  const cases: LiveProofCase[] = []
  for (const entry of manifest.cases) {
    if (entry.kind !== 'leaf') continue
    const raw = readJson(join(CONFORMANCE_DIR, entry.case)) as {
      format_version: string
      metadata?: unknown
      rv: { dist: string; params: Record<string, number> }
    }
    const dist = raw.rv.dist
    if (dist !== 'normal' && dist !== 'uniform') continue
    const golden = readJson(join(CONFORMANCE_DIR, entry.golden)) as Golden
    cases.push({
      name: entry.name,
      dist,
      doc: {
        format_version: raw.format_version,
        metadata: raw.metadata,
        rv: { kind: 'leaf', dist, params: raw.rv.params },
      },
      logProb: scalarPoints(golden.log_prob),
      cdf: scalarPoints(golden.cdf),
      moments:
        golden.moments && typeof golden.moments.mean === 'number' && typeof golden.moments.variance === 'number'
          ? { mean: golden.moments.mean, variance: golden.moments.variance }
          : null,
    })
  }
  return cases
}

function scalarPoints(pts: Golden['log_prob']): LiveProofPoint[] {
  return (pts ?? [])
    .filter((p): p is { x: number; value: number } => typeof p.x === 'number')
    .map((p) => ({ x: p.x, value: p.value }))
}

function compareMoment(got: number | number[], want: number | number[], track: (g: number, w: number) => void) {
  const gs = Array.isArray(got) ? got : [got]
  const ws = Array.isArray(want) ? want : [want]
  gs.forEach((g, i) => track(g, ws[i]))
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf-8'))
}
