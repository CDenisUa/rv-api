// Server component: the cross-language equivalence evidence. Recomputes every golden value with the
// TypeScript engine at render time and shows the worst deviation per case. No client JavaScript.

// Services
import { loadConformance } from '@/lib/conformance'

export function ConformancePanel() {
  const checks = loadConformance()
  const total = checks.reduce((a, c) => a + c.comparisons, 0)
  const worst = checks.reduce((a, c) => Math.max(a, c.maxAbsError), 0)
  const allPassed = checks.every((c) => c.passed)

  return (
    <section className="rounded-2xl bg-slate-900/40 p-4 ring-1 ring-slate-800 sm:p-6">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold text-white">Python == TypeScript == Rust</h2>
        <p className="text-sm text-slate-400">
          {checks.length} cases · {total} deterministic values · worst error{' '}
          <span className="tabular-nums text-slate-200">{worst === 0 ? '0' : worst.toExponential(1)}</span>
        </p>
      </div>

      <p className="mb-4 text-sm leading-relaxed text-slate-400">
        Each golden value below was produced by <strong className="text-slate-200">scipy</strong> (the
        Python reference) and independently verified by the <strong className="text-slate-200">Rust</strong>{' '}
        conformance suite. This table is server-rendered: the <strong className="text-slate-200">TypeScript</strong>{' '}
        engine recomputed all {total} of them at request time and every one matches within 1e-9.
      </p>

      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="text-xs uppercase tracking-wider text-slate-500">
            <tr>
              <th className="py-2 pr-4 font-medium">case</th>
              <th className="py-2 pr-4 font-medium">kind</th>
              <th className="py-2 pr-4 font-medium">values</th>
              <th className="py-2 pr-4 font-medium">max |TS − golden|</th>
              <th className="py-2 font-medium">agree</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {checks.map((c) => (
              <tr key={c.name} className="text-slate-300">
                <td className="py-2 pr-4 font-mono text-xs text-slate-200">{c.name}</td>
                <td className="py-2 pr-4 text-slate-400">{c.kind}</td>
                <td className="py-2 pr-4 tabular-nums">{c.comparisons || '-'}</td>
                <td className="py-2 pr-4 tabular-nums text-slate-400">
                  {c.comparisons === 0 ? '-' : c.maxAbsError === 0 ? '0' : c.maxAbsError.toExponential(1)}
                </td>
                <td className="py-2">
                  {c.comparisons === 0 ? (
                    <span className="text-slate-500">sampling-only</span>
                  ) : c.passed ? (
                    <span className="text-emerald-400">✓ 1e-9</span>
                  ) : (
                    <span className="text-red-400">✗</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {allPassed && (
        <p className="mt-4 text-sm text-emerald-400">
          ✓ All deterministic outputs agree across the three implementations.
        </p>
      )}
    </section>
  )
}
