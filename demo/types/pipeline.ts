// Shared types for the pipeline screen and its API routes.

export type Language = 'python' | 'typescript' | 'rust'

export type PipelineMode = 'replay' | 'live'

export type GenerateStage = 'spec' | 'impl'

export interface GenerateRequest {
  stage: GenerateStage
  /** The prompt text the user submitted (Prompt #1 for spec, Prompt #2 for impl). */
  prompt: string
  /** Required when stage === 'impl'. */
  language?: Language
  /**
   * Compact demo mode: attach the small spec (not the full canonical one) for `impl`, so a live
   * generation finishes in seconds. The committed canonical artifacts are unaffected.
   */
  compact?: boolean
}

export interface GenerateResponse {
  files: Record<string, string>
  model: string
}

export interface GenerateError {
  error: string
}

/** Exact token usage reported by the model on completion. */
export interface Usage {
  input: number
  output: number
  cacheRead: number
  cacheCreate: number
}

/** Newline-delimited events streamed from /api/generate during a live run. */
export type GenerateEvent =
  | { type: 'progress'; chars: number }
  | { type: 'snapshot'; text: string }
  | { type: 'done'; files: Record<string, string>; model: string; usage: Usage; costUsd: number; durationMs: number }
  | { type: 'error'; message: string }
