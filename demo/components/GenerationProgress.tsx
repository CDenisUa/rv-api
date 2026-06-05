'use client'

// Live feedback for one generation: an approximate progress bar, an elapsed-time counter, the
// streamed character count (with a rough token estimate) while running, and the exact token usage +
// cost once finished. On failure it shows the error in place instead.

// Core
import { useEffect, useRef } from 'react'
// Types
import type { GenState } from '@/hooks/useGeneration'

export function GenerationProgress({ state }: { state: GenState }) {
  if (state.status === 'idle') return null

  if (state.status === 'error') {
    return (
      <div className="space-y-2">
        <div className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-300 ring-1 ring-red-500/30">
          <span className="font-medium">Generation failed.</span> {state.error}
          <span className="mt-0.5 block text-xs text-red-300/70">
            Try again, or switch to Replay to use the committed canonical output.
          </span>
        </div>
        {!!state.liveText && <LiveOutput text={state.liveText} />}
      </div>
    )
  }

  const running = state.status === 'running'
  const estTokens = Math.round(state.chars / 4)

  return (
    <div className="space-y-2 rounded-lg bg-slate-900/60 px-3 py-2.5 ring-1 ring-slate-800">
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
        <div
          className={`h-full rounded-full transition-all duration-200 ${running ? 'bg-sky-500' : 'bg-emerald-500'}`}
          style={{ width: `${state.progress}%` }}
        />
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs tabular-nums text-slate-400">
        <span className="inline-flex items-center gap-1.5">
          {running && <span className="h-2 w-2 animate-pulse rounded-full bg-sky-400" />}
          <span className="text-slate-300">{(state.elapsedMs / 1000).toFixed(1)}s</span>
        </span>

        {running ? (
          <>
            <Metric label="streamed" value={`${state.chars.toLocaleString()} chars`} />
            <Metric label="~tokens" value={estTokens.toLocaleString()} />
            <span className="text-slate-500">generating…</span>
          </>
        ) : (
          <>
            {state.model && <Metric label="model" value={state.model} />}
            <Metric label="in" value={`${(state.usage?.input ?? 0).toLocaleString()} tok`} />
            <Metric label="out" value={`${(state.usage?.output ?? 0).toLocaleString()} tok`} />
            {!!state.usage?.cacheRead && <Metric label="cache" value={`${state.usage.cacheRead.toLocaleString()} tok`} />}
            {!!state.usage?.cacheCreate && (
              <Metric label="cache+" value={`${state.usage.cacheCreate.toLocaleString()} tok`} />
            )}
            {!!state.durationMs && <Metric label="api" value={`${(state.durationMs / 1000).toFixed(1)}s`} />}
            <Metric label="cost" value={`$${(state.costUsd ?? 0).toFixed(4)}`} />
            <span className="font-medium text-emerald-400">done</span>
          </>
        )}
      </div>

      <LiveOutput text={state.liveText} />
    </div>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <span>
      <span className="text-slate-500">{label} </span>
      <span className="text-slate-300">{value}</span>
    </span>
  )
}

function LiveOutput({ text }: { text: string }) {
  const preRef = useRef<HTMLPreElement | null>(null)
  const shown = text || 'Waiting for model output...'

  useEffect(() => {
    const pre = preRef.current
    if (pre) pre.scrollTop = pre.scrollHeight
  }, [text])

  return (
    <div className="rounded-lg bg-slate-950 ring-1 ring-slate-800">
      <div className="flex items-center justify-between border-b border-slate-800 px-3 py-2 text-xs">
        <span className="font-medium text-slate-300">Live generated output</span>
        <span className="tabular-nums text-slate-500">{text.length.toLocaleString()} chars</span>
      </div>
      <pre ref={preRef} className="max-h-80 overflow-auto p-3 font-mono text-xs leading-relaxed text-slate-300">
        <code>{shown}</code>
      </pre>
    </div>
  )
}
