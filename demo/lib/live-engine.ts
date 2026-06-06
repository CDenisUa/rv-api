'use client'

// Loads the JavaScript engine Claude generated in step 2 and runs it in the browser. The generated
// source is turned into a Blob URL and imported as a real ES module, then checked against the fixed
// export contract (lib/live-prompts.ts). This is what lets the demo and proof exercise the exact code
// that was just generated. The source comes from the user's own local Claude Code CLI; it only runs
// here, in their browser, after they trigger a live generation.

// Consts
import { ENGINE_EXPORTS } from '@/lib/live-prompts'

// A compact-format document: { format_version, metadata?, rv: { kind: 'leaf', dist, params } }.
export type RvDoc = {
  format_version: string
  metadata?: unknown
  rv: { kind: 'leaf'; dist: string; params: Record<string, number> }
}

export interface LiveEngine {
  validate(doc: RvDoc): void
  logProb(doc: RvDoc, x: number): number
  cdf(doc: RvDoc, x: number): number
  sample(doc: RvDoc, n: number, seed: number): number[]
  mean(doc: RvDoc): number
  variance(doc: RvDoc): number
  toCanonical(doc: RvDoc): string
}

/**
 * Import the generated module source and verify it exposes the contract. Throws a descriptive Error
 * if a required export is missing - surfaced in the UI as "generation didn't match the engine
 * contract, regenerate or use Replay".
 */
export async function loadLiveEngine(source: string): Promise<LiveEngine> {
  const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }))
  try {
    const mod: Record<string, unknown> = await import(/* webpackIgnore: true */ url)
    const missing = ENGINE_EXPORTS.filter((name) => typeof mod[name] !== 'function')
    if (missing.length > 0) {
      throw new Error(`generated engine is missing required export(s): ${missing.join(', ')}`)
    }
    return mod as unknown as LiveEngine
  } finally {
    // The module is already evaluated; the blob URL can be released.
    URL.revokeObjectURL(url)
  }
}
