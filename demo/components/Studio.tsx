'use client'

// Core
import { useMemo, useState } from 'react'
// Components
import { BatchDemo } from '@/components/BatchDemo'
import { CapabilitiesBadges } from '@/components/CapabilitiesBadges'
import { Histogram } from '@/components/Histogram'
import { JsonPreview } from '@/components/JsonPreview'
import { RvBuilder } from '@/components/RvBuilder'
// Hooks
import { useSampler } from '@/hooks/useSampler'
// Services
import { capabilities, logProb, moments, parseDocument, DISCRETE_DISTS, type Capabilities, type RVNode } from 'rvx'
// Utils
import { buildDocument } from '@/lib/build-doc'
import { curve, histogram, sampleRange } from '@/lib/histogram'
import { fmt, fmtMoment } from '@/lib/format'
// Consts
import { PRESETS } from '@/lib/presets'
// Types
import type { Engine } from '@/types/rv-form'

interface Analysis {
  node: RVNode | null
  caps: Capabilities | null
  moments: { mean: number | number[]; variance: number | number[] } | null
  error: string | null
}

function analyze(doc: unknown): Analysis {
  try {
    const node = parseDocument(doc)
    const caps = capabilities(node)
    let moms: Analysis['moments'] = null
    try {
      const [mean, variance] = moments(node)
      moms = { mean, variance }
    } catch {
      /* no closed-form moments (e.g. exp transform); fall back to the sample stats */
    }
    return { node, caps, moments: moms, error: null }
  } catch (e) {
    return { node: null, caps: null, moments: null, error: e instanceof Error ? e.message : String(e) }
  }
}

const SAMPLE_SIZES = [10_000, 50_000, 200_000]

/** Discrete RVs carry probability mass, not density - the analytic overlay would be misleading. */
function containsDiscrete(node: RVNode): boolean {
  switch (node.kind) {
    case 'leaf':
      return DISCRETE_DISTS.has(node.dist)
    case 'joint':
      return node.dims.some(containsDiscrete)
    case 'mixture':
      return node.components.some(containsDiscrete)
    case 'transform':
      return containsDiscrete(node.base)
  }
}

export function Studio() {
  const [state, setState] = useState(PRESETS[0].state)
  const [n, setN] = useState(50_000)
  const [seed, setSeed] = useState(12345)
  const [engine, setEngine] = useState<Engine>('ts')

  const doc = useMemo(() => buildDocument(state), [state])
  const docKey = useMemo(() => JSON.stringify(doc), [doc])
  // Cheap analytics on the main thread; heavy sampling in the worker.
  const analysis = useMemo(() => analyze(doc), [docKey])
  const { samples, mean, variance, loading, error: sampleError } = useSampler(doc, n, seed, engine)

  const range = useMemo(() => (samples ? sampleRange(samples) : { min: 0, max: 1 }), [samples])
  const bins = useMemo(() => (samples ? histogram(samples, range) : []), [samples, range])
  const isDiscrete = useMemo(() => (analysis.node ? containsDiscrete(analysis.node) : false), [analysis])
  const densityCurve = useMemo(() => {
    if (!analysis.node || !analysis.caps?.can_log_prob || isDiscrete) return []
    const node = analysis.node
    return curve(range, 160, (x) => Math.exp(logProb(node, x)))
  }, [analysis, range, isDiscrete])

  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:gap-6 lg:grid-cols-[minmax(0,420px)_1fr]">
        <section className="rounded-2xl bg-slate-900/40 p-4 ring-1 ring-slate-800 sm:p-6">
          <h2 className="mb-4 text-lg font-semibold text-white">Build a random variable</h2>
          <RvBuilder state={state} setState={setState} />
          <div className="mt-6">
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">
              Portable document (.rv.json)
            </h3>
            <JsonPreview value={doc} />
          </div>
        </section>

        <section className="space-y-5 rounded-2xl bg-slate-900/40 p-4 ring-1 ring-slate-800 sm:p-6">
          {analysis.error ? (
            <Banner tone="error">Invalid document: {analysis.error}</Banner>
          ) : (
            <>
              <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
                <CapabilitiesBadges capabilities={analysis.caps!} />
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <div className="inline-flex rounded-md bg-slate-800 p-0.5 ring-1 ring-slate-700" title="Sample with the TypeScript reference or the Rust core compiled to WebAssembly">
                    {(['ts', 'wasm'] as Engine[]).map((eng) => (
                      <button
                        key={eng}
                        onClick={() => setEngine(eng)}
                        className={`rounded px-2.5 py-1 text-xs font-medium transition ${
                          engine === eng ? 'bg-sky-500 text-white' : 'text-slate-300 hover:text-white'
                        }`}
                      >
                        {eng === 'ts' ? 'TypeScript' : 'Rust · WASM'}
                      </button>
                    ))}
                  </div>
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
              </div>

              {sampleError ? (
                <Banner tone="error">Sampling failed: {sampleError}</Banner>
              ) : (
                <div className={loading ? 'opacity-60 transition' : 'transition'}>
                  <Histogram bins={bins} curve={densityCurve} range={range} />
                </div>
              )}

              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Stat label="sample mean" value={fmt(mean)} />
                <Stat label="sample var" value={fmt(variance)} />
                <Stat label="analytic mean" value={analysis.moments ? fmtMoment(analysis.moments.mean) : '-'} />
                <Stat label="analytic var" value={analysis.moments ? fmtMoment(analysis.moments.variance) : '-'} />
              </div>
              <p className="text-xs text-slate-500">
                Histogram drawn from {n.toLocaleString()} samples in a Web Worker (seed {seed}) by the{' '}
                <span className="text-slate-300">{engine === 'wasm' ? 'Rust core (WebAssembly)' : 'TypeScript engine'}</span>.
                The amber curve is the analytic density from the TypeScript engine
                {isDiscrete
                  ? ' - hidden for discrete RVs (log_prob is a probability mass, not a density).'
                  : analysis.caps?.can_log_prob
                    ? ' - switch engines and the histogram is unchanged.'
                    : ' - unavailable for this RV, so only the histogram is shown.'}
              </p>
            </>
          )}
        </section>
      </div>
      <BatchDemo />
    </div>
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

function Banner({ tone, children }: { tone: 'error'; children: React.ReactNode }) {
  return (
    <div className={`rounded-lg px-4 py-3 text-sm ${tone === 'error' ? 'bg-red-500/10 text-red-300 ring-1 ring-red-500/30' : ''}`}>
      {children}
    </div>
  )
}
