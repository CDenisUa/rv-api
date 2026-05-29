// Shows the recomputed capabilities of the current RV. The point of the demo: capabilities are not
// cosmetic — a non-invertible transform (abs) honestly drops log_prob/cdf.

// Types
import type { Capabilities } from 'rvx'

const LABELS: { key: keyof Capabilities; label: string }[] = [
  { key: 'can_sample', label: 'sample' },
  { key: 'can_log_prob', label: 'log_prob' },
  { key: 'can_cdf', label: 'cdf' },
]

export function CapabilitiesBadges({ capabilities }: { capabilities: Capabilities }) {
  return (
    <div className="flex flex-wrap gap-2">
      {LABELS.map(({ key, label }) => {
        const on = capabilities[key]
        return (
          <span
            key={key}
            className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-medium ${
              on ? 'bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/30' : 'bg-slate-700/40 text-slate-500 ring-1 ring-slate-600/40 line-through'
            }`}
          >
            <span className={`h-1.5 w-1.5 rounded-full ${on ? 'bg-emerald-400' : 'bg-slate-500'}`} />
            {label}
          </span>
        )
      })}
    </div>
  )
}
