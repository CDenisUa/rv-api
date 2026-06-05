'use client'

// Drives one live LLM generation against the streaming /api/generate route. It owns the elapsed-time
// ticker and the running progress (character count → an approximate bar), and exposes the exact token
// usage / cost once the `done` event arrives. Replay mode does not use this - it sets files directly.

// Core
import { useCallback, useRef, useState } from 'react'
// Types
import type { GenerateEvent, GenerateStage, Language, Usage } from '@/types/pipeline'

// Rough output sizes (characters) per stage, used only to give the bar a sense of progress. The bar
// is clamped below 100% until the real `done` event lands, so it never claims to be finished early.
const SOFT_TARGET_CHARS: Record<GenerateStage, number> = { spec: 45_000, impl: 50_000 }

export type GenStatus = 'idle' | 'running' | 'done' | 'error'

export interface GenState {
  status: GenStatus
  elapsedMs: number
  chars: number
  progress: number // 0..100
  liveText: string
  model: string | null
  usage: Usage | null
  costUsd: number | null
  durationMs: number | null
  error: string | null
  files: Record<string, string> | null
}

const IDLE: GenState = {
  status: 'idle',
  elapsedMs: 0,
  chars: 0,
  progress: 0,
  liveText: '',
  model: null,
  usage: null,
  costUsd: null,
  durationMs: null,
  error: null,
  files: null,
}

interface RunBody {
  stage: GenerateStage
  prompt: string
  language?: Language
}

export function useGeneration() {
  const [state, setState] = useState<GenState>(IDLE)
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)

  const stopTimer = useCallback(() => {
    if (timer.current) {
      clearInterval(timer.current)
      timer.current = null
    }
  }, [])

  const reset = useCallback(() => {
    stopTimer()
    setState(IDLE)
  }, [stopTimer])

  const run = useCallback(
    async (body: RunBody): Promise<Record<string, string> | null> => {
      const target = SOFT_TARGET_CHARS[body.stage]
      const startedAt = Date.now()
      stopTimer()
      setState({ ...IDLE, status: 'running' })
      timer.current = setInterval(() => {
        setState((s) => (s.status === 'running' ? { ...s, elapsedMs: Date.now() - startedAt } : s))
      }, 100)

      const finish = (patch: Partial<GenState>) => {
        stopTimer()
        setState((s) => ({ ...s, elapsedMs: Date.now() - startedAt, ...patch }))
      }

      try {
        const res = await fetch('/api/generate', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        })
        if (!res.ok || !res.body) {
          const msg = await res.json().then((j) => j.error).catch(() => `HTTP ${res.status}`)
          finish({ status: 'error', error: msg })
          return null
        }

        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        let buf = ''
        let files: Record<string, string> | null = null

        for (;;) {
          const { value, done } = await reader.read()
          if (done) break
          buf += decoder.decode(value, { stream: true })
          let idx: number
          while ((idx = buf.indexOf('\n')) >= 0) {
            const line = buf.slice(0, idx).trim()
            buf = buf.slice(idx + 1)
            if (!line) continue
            const ev = JSON.parse(line) as GenerateEvent
            if (ev.type === 'progress') {
              setState((s) =>
                s.status === 'running'
                  ? { ...s, chars: ev.chars, progress: Math.min(95, (ev.chars / target) * 100) }
                  : s,
              )
            } else if (ev.type === 'snapshot') {
              setState((s) =>
                s.status === 'running' || s.status === 'done' ? { ...s, liveText: ev.text } : s,
              )
            } else if (ev.type === 'done') {
              files = ev.files
              finish({
                status: 'done',
                progress: 100,
                files: ev.files,
                model: ev.model,
                usage: ev.usage,
                costUsd: ev.costUsd,
                durationMs: ev.durationMs,
              })
            } else if (ev.type === 'error') {
              finish({ status: 'error', error: ev.message })
            }
          }
        }
        return files
      } catch (e) {
        finish({ status: 'error', error: (e as Error).message })
        return null
      }
    },
    [stopTimer],
  )

  return { state, run, reset }
}
