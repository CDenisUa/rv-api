'use client'

// Step 3 in LIVE mode: the demo runs the engine Claude just generated (step 2), in the browser. Build
// a normal or uniform RV, serialize it to a .rv.json document, and let the generated engine sample it,
// evaluate its density, and report analytic moments - the same builder->serialize->sample loop as the
// canonical Studio, but powered by freshly generated code instead of the committed engine.

// Core
import { useMemo, useState } from 'react'
// Components
import { Histogram } from '@/components/Histogram'
import { JsonPreview } from '@/components/JsonPreview'
// Services
import type { LiveEngine, RvDoc } from '@/lib/live-engine'
// Utils
import { curve, histogram, sampleRange } from '@/lib/histogram'
import { fmt } from '@/lib/format'

type Dist = 'normal' | 'uniform'

interface Form {
  dist: Dist
  mu: number
  sigma: number
  low: number
  high: number
}

const DEFAULTS: Form = { dist: 'normal', mu: 0, sigma: 1, low: 0, high: 1 }
const SAMPLE_SIZES = [5_000, 20_000, 50_000]

function buildDoc(f: Form): RvDoc {
  const params: Record<string, number> =
    f.dist === 'normal' ? { mu: f.mu, sigma: f.sigma } : { low: f.low, high: f.high }
  return { format_version: '1.0.0', metadata: { name: `live_${f.dist}` }, rv: { kind: 'leaf', dist: f.dist, params } }
}

function sampleStats(samples: number[]): { mean: number; variance: number } {
  const n = samples.length || 1
  const mean = samples.reduce((a, x) => a + x, 0) / n
  const variance = samples.reduce((a, x) => a + (x - mean) ** 2, 0) / n
  return { mean, variance }
}

export function LiveDemo({ engine }: { engine: LiveEngine }) {
  const [form, setForm] = useState<Form>(DEFAULTS)
  const [n, setN] = useState(20_000)
  const [seed, setSeed] = useState(12345)

  const doc = useMemo(() => buildDoc(form), [form])

  // Everything below runs the *generated* engine; any thrown error (bad formula, failed validation)
  // is caught and shown in place rather than crashing the step.
  const result = useMemo(() => {
    try {
      engine.validate(doc)
      const samples = engine.sample(doc, n, seed)
      if (!Array.isArray(samples) || samples.length === 0) throw new Error('sample() returned no data')
      const range = sampleRange(samples)
      const bins = histogram(samples, range)
      const density = curve(range, 160, (x) => Math.exp(engine.logProb(doc, x)))
      const canonical = engine.toCanonical(doc)
      return {
        ok: true as const,
        range,
        bins,
        density,
        canonical,
        sample: sampleStats(samples),
        analytic: { mean: engine.mean(doc), variance: engine.variance(doc) },
      }
    } catch (e) {
      return { ok: false as const, error: e instanceof Error ? e.message : String(e) }
    }
  }, [engine, doc, n, seed])

  return (
    <div className="grid gap-4 sm:gap-6 lg:grid-cols-[minmax(0,360px)_1fr]">
      <section className="rounded-2xl bg-slate-900/40 p-4 ring-1 ring-slate-800 sm:p-6">
        <h3 className="mb-4 text-base font-semibold text-white">Build a random variable</h3>

        <div className="mb-4 inline-flex rounded-md bg-slate-800 p-0.5 text-sm ring-1 ring-slate-700">
          {(['normal', 'uniform'] as Dist[]).map((d) => (
            <button
              key={d}
              onClick={() => setForm((f) => ({ ...f, dist: d }))}
              className={`rounded px-3 py-1 font-medium transition ${
                form.dist === d ? 'bg-sky-500 text-white' : 'text-slate-300 hover:text-white'
              }`}
            >
              {d}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-3">
          {form.dist === 'normal' ? (
            <>
              <NumberField label="mu (mean)" value={form.mu} onChange={(v) => setForm((f) => ({ ...f, mu: v }))} />
              <NumberField label="sigma (std)" value={form.sigma} onChange={(v) => setForm((f) => ({ ...f, sigma: v }))} />
            </>
          ) : (
            <>
              <NumberField label="low" value={form.low} onChange={(v) => setForm((f) => ({ ...f, low: v }))} />
              <NumberField label="high" value={form.high} onChange={(v) => setForm((f) => ({ ...f, high: v }))} />
            </>
          )}
        </div>

        <div className="mt-6">
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">
            Portable document (.rv.json)
          </h4>
          <JsonPreview value={doc} />
        </div>
      </section>

      <section className="space-y-5 rounded-2xl bg-slate-900/40 p-4 ring-1 ring-slate-800 sm:p-6">
        {!result.ok ? (
          <div className="rounded-lg bg-red-500/10 px-4 py-3 text-sm text-red-300 ring-1 ring-red-500/30">
            Generated engine error: {result.error}
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-end gap-2 text-sm">
              <label className="text-slate-400">n</label>
              <select
                value={n}
                onChange={(e) => setN(Number(e.target.value))}
                className="rounded-md bg-slate-800 px-2 py-1 text-slate-100 ring-1 ring-slate-700"
              >
                {SAMPLE_SIZES.map((s) => (
                  <option key={s} value={s}>
                    {s.toLocaleString()}
                  </option>
                ))}
              </select>
              <button
                onClick={() => setSeed((s) => s + 1)}
                className="rounded-md bg-slate-800 px-3 py-1 text-slate-200 ring-1 ring-slate-700 hover:bg-slate-700"
              >
                reshuffle
              </button>
            </div>

            <Histogram bins={result.bins} curve={result.density} range={result.range} />

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat label="sample mean" value={fmt(result.sample.mean)} />
              <Stat label="sample var" value={fmt(result.sample.variance)} />
              <Stat label="analytic mean" value={fmt(result.analytic.mean)} />
              <Stat label="analytic var" value={fmt(result.analytic.variance)} />
            </div>

            <p className="text-xs text-slate-500">
              Histogram drawn from {n.toLocaleString()} samples (seed {seed}) by the{' '}
              <span className="text-slate-300">JavaScript engine Claude generated in step 2</span>. The amber
              curve is that engine&apos;s analytic density, and the canonical document on the left is its{' '}
              <code className="text-slate-300">toCanonical()</code> output.
            </p>
          </>
        )}
      </section>
    </div>
  )
}

function NumberField({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block text-xs text-slate-400">{label}</span>
      <input
        type="number"
        step="any"
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full rounded-md bg-slate-950 px-2 py-1.5 tabular-nums text-slate-100 ring-1 ring-slate-700 outline-none focus:ring-sky-500"
      />
    </label>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-slate-950/50 p-3 ring-1 ring-slate-800">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="mt-0.5 tabular-nums text-slate-100">{value}</div>
    </div>
  )
}
