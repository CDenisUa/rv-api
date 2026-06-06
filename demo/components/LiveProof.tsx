'use client'

// Step 4 in LIVE mode: proof that the engine Claude just generated agrees with the frozen reference.
// Each golden value was produced by scipy (Python) and verified by the Rust suite; here the
// *generated JavaScript* recomputes the deterministic ones (log_prob, cdf, analytic moments) for the
// normal/uniform leaf cases - the scope of the compact live spec - and we show the worst deviation.
// This is intentionally narrower than the canonical ConformancePanel.

// Core
import { useMemo } from 'react'
// Types
import type { LiveEngine } from '@/lib/live-engine'
import type { LiveProofCase } from '@/lib/conformance'

// Looser than the canonical 1e-9 bar on purpose: log_prob and analytic moments come out exact
// (~1e-15), but the normal CDF needs an `erf`, and a hand-written JavaScript erf (Abramowitz-Stegun
// and friends) is only ~1e-7 accurate. 1e-6 reliably accepts a correct from-scratch engine while
// still catching a genuinely wrong formula. The committed engines reach 1e-9 with a higher-order erf.
const TOLERANCE = 1e-6

interface CaseResult {
  name: string
  dist: string
  comparisons: number
  maxAbsError: number
  passed: boolean
  error: string | null
}

function checkCase(engine: LiveEngine, c: LiveProofCase): CaseResult {
  let maxErr = 0
  let count = 0
  try {
    engine.validate(c.doc)
    const track = (got: number, want: number) => {
      maxErr = Math.max(maxErr, Math.abs(got - want))
      count += 1
    }
    for (const pt of c.logProb) track(engine.logProb(c.doc, pt.x), pt.value)
    for (const pt of c.cdf) track(engine.cdf(c.doc, pt.x), pt.value)
    if (c.moments) {
      track(engine.mean(c.doc), c.moments.mean)
      track(engine.variance(c.doc), c.moments.variance)
    }
    return { name: c.name, dist: c.dist, comparisons: count, maxAbsError: maxErr, passed: maxErr <= TOLERANCE, error: null }
  } catch (e) {
    return {
      name: c.name,
      dist: c.dist,
      comparisons: count,
      maxAbsError: maxErr,
      passed: false,
      error: e instanceof Error ? e.message : String(e),
    }
  }
}

export function LiveProof({ engine, cases }: { engine: LiveEngine; cases: LiveProofCase[] }) {
  const results = useMemo(() => cases.map((c) => checkCase(engine, c)), [engine, cases])
  const total = results.reduce((a, r) => a + r.comparisons, 0)
  const worst = results.reduce((a, r) => Math.max(a, r.maxAbsError), 0)
  const allPassed = results.length > 0 && results.every((r) => r.passed)

  return (
    <section className="rounded-2xl bg-slate-900/40 p-4 ring-1 ring-slate-800 sm:p-6">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold text-white">Compact generated engine == Python == Rust</h2>
        <p className="text-sm text-slate-400">
          {results.length} cases · {total} deterministic values · worst error{' '}
          <span className="tabular-nums text-slate-200">{worst === 0 ? '0' : worst.toExponential(1)}</span>
        </p>
      </div>

      <p className="mb-4 text-sm leading-relaxed text-slate-400">
        Every golden value below was produced by <strong className="text-slate-200">scipy</strong> (the
        Python reference) and independently verified by the <strong className="text-slate-200">Rust</strong>{' '}
        conformance suite. The <strong className="text-slate-200">JavaScript engine Claude just generated</strong>{' '}
        recomputed all {total} of them in your browser - the <code className="text-slate-300">normal</code> and{' '}
        <code className="text-slate-300">uniform</code> cases in scope for the compact live spec.{' '}
        <code>log_prob</code> and the analytic moments come out exact; the residual you see on{' '}
        <code className="text-slate-300">normal</code> is its hand-written <code>erf</code> in the CDF (~1e-7),
        so the bar here is {TOLERANCE.toExponential(0)} rather than the 1e-9 the committed engines reach.
      </p>

      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="text-xs uppercase tracking-wider text-slate-500">
            <tr>
              <th className="py-2 pr-4 font-medium">case</th>
              <th className="py-2 pr-4 font-medium">dist</th>
              <th className="py-2 pr-4 font-medium">values</th>
              <th className="py-2 pr-4 font-medium">max |generated − golden|</th>
              <th className="py-2 font-medium">agree</th>
            </tr>
          </thead>
          <tbody>
            {results.map((r) => (
              <tr key={r.name} className="border-t border-slate-800">
                <td className="py-2 pr-4 font-mono text-xs text-slate-300">{r.name}</td>
                <td className="py-2 pr-4 text-slate-400">{r.dist}</td>
                <td className="py-2 pr-4 tabular-nums text-slate-400">{r.comparisons}</td>
                <td className="py-2 pr-4 tabular-nums text-slate-200">
                  {r.error ? <span className="text-red-300">{r.error}</span> : r.maxAbsError === 0 ? '0' : r.maxAbsError.toExponential(1)}
                </td>
                <td className="py-2">
                  {r.passed ? (
                    <span className="text-emerald-400">✓</span>
                  ) : (
                    <span className="text-red-400">✗</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div
        className={`mt-4 rounded-lg px-4 py-3 text-sm ${
          allPassed
            ? 'bg-emerald-500/10 text-emerald-300 ring-1 ring-emerald-500/30'
            : 'bg-red-500/10 text-red-300 ring-1 ring-red-500/30'
        }`}
      >
        {allPassed ? (
          <>
            <strong>All {total} values match within {TOLERANCE.toExponential(0)}.</strong> Code Claude
            wrote moments ago reproduces the Python/Rust reference.
          </>
        ) : (
          <>
            <strong>Some values did not match.</strong> A live generation can occasionally produce a
            subtly wrong formula - regenerate the engine in step 2, or switch to Replay for the proven
            canonical implementations.
          </>
        )}
      </div>
    </section>
  )
}
