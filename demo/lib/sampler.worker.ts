// Web Worker: draws samples off the main thread so the UI stays responsive even at large n (the
// scalability angle). It can sample with either engine on the same `.rv.json`:
//   - 'ts'   - the TypeScript reference (rvx), parsed + sampled here;
//   - 'wasm' - the Rust core compiled to WebAssembly (wasm-pack), loaded lazily.
// The sample buffer is transferred back with zero copy.

/// <reference lib="webworker" />

// Services
import { parseDocument, sample, RNG } from 'rvx'
// Types
import type { SampleRequest, SampleResponse } from '@/types/rv-form'

// Lazily import the WASM package only when first requested, so the Rust core isn't downloaded
// unless the user switches engines.
let wasmSampleDim: ((docJson: string, seed: number, n: number, dim: number) => Float64Array) | null = null
async function loadWasm() {
  if (!wasmSampleDim) {
    const mod = await import('../wasm-rvx/rvx.js')
    wasmSampleDim = mod.rv_sample_dim
  }
  return wasmSampleDim
}

function sampleTs(doc: unknown, n: number, seed: number, dim: number): Float64Array {
  const node = parseDocument(doc)
  const drawn = sample(node, new RNG(seed), n)
  // For a Joint, visualize the requested dimension (default 0).
  return drawn instanceof Float64Array ? drawn : drawn[dim]
}

self.onmessage = async (event: MessageEvent<SampleRequest>) => {
  const { id, doc, n, seed, engine, dim = 0 } = event.data
  try {
    const xs =
      engine === 'wasm' ? (await loadWasm())(JSON.stringify(doc), seed, n, dim) : sampleTs(doc, n, seed, dim)

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
