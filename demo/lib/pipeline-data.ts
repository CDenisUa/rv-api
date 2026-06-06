// Server-only loaders for the pipeline screen. They read the committed pipeline prompts and canonical
// (replay) artifacts straight from the repo, so the screen can show the exact same inputs/outputs the
// CLI runner uses - no network, fully deterministic.

// Core
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
// Types
import type { Language } from '@/types/pipeline'

const ROOT = join(process.cwd(), '..')

export interface PipelinePrompts {
  spec: string
  impl: string
}

export interface CanonicalSpec {
  specMd: string
  schema: string
}

const IMPL_SRC: Record<Language, string> = {
  python: 'generated/impl/python/src/rvx',
  typescript: 'generated/impl/typescript/src',
  rust: 'generated/impl/rust/src',
}

const SRC_EXT: Record<Language, RegExp> = {
  python: /\.py$/,
  typescript: /\.ts$/,
  rust: /\.rs$/,
}

export function loadPrompts(): PipelinePrompts {
  return {
    spec: read('pipeline/prompts/01-generate-spec.md'),
    impl: read('pipeline/prompts/02-generate-impl.md'),
  }
}

export function loadCanonicalSpec(): CanonicalSpec {
  return {
    specMd: read('generated/spec/SPEC.md'),
    schema: read('generated/spec/rv.schema.json'),
  }
}

/** All source files of one canonical implementation, as { filename: content }, sorted by name. */
export function loadCanonicalImpl(language: Language): Record<string, string> {
  const dir = IMPL_SRC[language]
  const files: Record<string, string> = {}
  for (const name of readdirSync(join(ROOT, dir)).sort()) {
    if (!SRC_EXT[language].test(name)) continue
    files[name] = read(join(dir, name))
  }
  return files
}

function read(rel: string): string {
  return readFileSync(join(ROOT, rel), 'utf-8')
}
