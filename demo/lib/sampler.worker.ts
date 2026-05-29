// Web Worker: draws samples off the main thread so the UI stays responsive even at large n (the
// scalability angle). It parses the document with the same `rvx` library the rest of the app uses,
// then transfers the sample buffer back with zero copy.

/// <reference lib="webworker" />

// Services
import { parseDocument, sample, RNG } from 'rvx'
// Types
import type { SampleRequest, SampleResponse } from '@/types/rv-form'

self.onmessage = (event: MessageEvent<SampleRequest>) => {
  const { id, doc, n, seed } = event.data
  try {
    const node = parseDocument(doc)
    const drawn = sample(node, new RNG(seed), n)
    // The builder only produces univariate RVs; for a joint, visualize the first dimension.
    const xs = drawn instanceof Float64Array ? drawn : drawn[0]

    let sum = 0
    for (const x of xs) sum += x
    const mean = sum / xs.length
    let ss = 0
    for (const x of xs) ss += (x - mean) * (x - mean)

    const response: SampleResponse = { id, ok: true, samples: xs, mean, variance: ss / xs.length }
    ;(self as DedicatedWorkerGlobalScope).postMessage(response, [xs.buffer])
  } catch (err) {
    const response: SampleResponse = { id, ok: false, error: err instanceof Error ? err.message : String(err) }
    ;(self as DedicatedWorkerGlobalScope).postMessage(response)
  }
}
