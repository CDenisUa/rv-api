'use client'

// Core
import { useEffect, useRef, useState } from 'react'
// Services
import { SamplerClient } from '@/lib/worker-client'
// Types
import type { Engine } from '@/types/rv-form'

export interface SamplerState {
  samples: Float64Array | null
  mean: number
  variance: number
  loading: boolean
  error: string | null
}

const INITIAL: SamplerState = { samples: null, mean: 0, variance: 0, loading: true, error: null }

/**
 * Draw `n` samples from `doc` in the worker, re-running (debounced) whenever the document, n, or
 * seed change. Superseded requests are ignored via a monotonic token so only the latest result is
 * applied (no flicker / race).
 */
export function useSampler(doc: unknown, n: number, seed: number, engine: Engine, debounceMs = 150): SamplerState {
  const clientRef = useRef<SamplerClient | null>(null)
  const docRef = useRef(doc)
  docRef.current = doc
  const tokenRef = useRef(0)
  const [state, setState] = useState<SamplerState>(INITIAL)

  useEffect(() => {
    clientRef.current = new SamplerClient()
    return () => clientRef.current?.terminate()
  }, [])

  const key = JSON.stringify(doc)
  useEffect(() => {
    const client = clientRef.current
    if (!client) return
    const token = ++tokenRef.current
    setState((s) => ({ ...s, loading: true, error: null }))
    const handle = setTimeout(() => {
      client
        .sample(docRef.current, n, seed, engine)
        .then((r) => {
          if (token !== tokenRef.current) return
          setState({ samples: r.samples ?? null, mean: r.mean ?? 0, variance: r.variance ?? 0, loading: false, error: null })
        })
        .catch((e: Error) => {
          if (token !== tokenRef.current) return
          setState({ samples: null, mean: 0, variance: 0, loading: false, error: e.message })
        })
    }, debounceMs)
    return () => clearTimeout(handle)
    // `key` captures every meaningful change in `doc`; docRef supplies the latest value.
  }, [key, n, seed, engine, debounceMs])

  return state
}
