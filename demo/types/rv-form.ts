// Form-state model for the RV builder. Kept separate from the wire `.rv.json` shape (built in
// lib/build-doc.ts) so the UI state and the serialized document can evolve independently.

export type BuilderMode = 'leaf' | 'transform' | 'mixture'

export interface LeafForm {
  dist: string
  params: Record<string, number>
}

export interface OpForm {
  name: string
  params: Record<string, number>
}

export interface BuilderState {
  mode: BuilderMode
  leaf: LeafForm
  op: OpForm
  base: LeafForm
  weight: number
  componentA: LeafForm
  componentB: LeafForm
}

/** Which engine the worker should sample with: the TypeScript reference or the Rust core (WASM). */
export type Engine = 'ts' | 'wasm'

/** A worker request to draw samples from a document. */
export interface SampleRequest {
  id: number
  doc: unknown
  n: number
  seed: number
  engine: Engine
}

/** A worker response carrying the drawn samples (transferred buffer) and their summary stats. */
export interface SampleResponse {
  id: number
  ok: boolean
  error?: string
  samples?: Float64Array
  mean?: number
  variance?: number
}
