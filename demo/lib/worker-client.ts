// Promise wrapper around the sampler worker, with request ids so out-of-order / superseded
// responses are matched correctly.

// Types
import type { Engine, SampleRequest, SampleResponse } from '@/types/rv-form'

export class SamplerClient {
  private worker: Worker
  private seq = 0
  private pending = new Map<number, { resolve: (r: SampleResponse) => void; reject: (e: Error) => void }>()

  constructor() {
    this.worker = new Worker(new URL('./sampler.worker.ts', import.meta.url), { type: 'module' })
    this.worker.onmessage = (event: MessageEvent<SampleResponse>) => {
      const entry = this.pending.get(event.data.id)
      if (!entry) return
      this.pending.delete(event.data.id)
      if (event.data.ok) entry.resolve(event.data)
      else entry.reject(new Error(event.data.error ?? 'sampling failed'))
    }
  }

  sample(doc: unknown, n: number, seed: number, engine: Engine): Promise<SampleResponse> {
    const id = ++this.seq
    const request: SampleRequest = { id, doc, n, seed, engine }
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.worker.postMessage(request)
    })
  }

  terminate(): void {
    this.worker.terminate()
    this.pending.clear()
  }
}
