// Pure transform: builder form state → the wire `.rv.json` document. No React, no I/O — trivially
// testable and reused by both the live UI and the JSON preview.

// Types
import type { BuilderState, LeafForm, OpForm } from '@/types/rv-form'

interface LeafNode {
  kind: 'leaf'
  dist: string
  params: Record<string, number>
}

type RvNode = LeafNode | TransformNode | MixtureNode

interface TransformNode {
  kind: 'transform'
  base: RvNode
  op: { name: string; params?: Record<string, number> }
}

interface MixtureNode {
  kind: 'mixture'
  weights: number[]
  components: RvNode[]
}

export interface RvDocument {
  format_version: string
  metadata?: Record<string, unknown>
  rv: RvNode
}

export function buildRvNode(state: BuilderState): RvNode {
  switch (state.mode) {
    case 'leaf':
      return leaf(state.leaf)
    case 'transform':
      return { kind: 'transform', base: leaf(state.base), op: op(state.op) }
    case 'mixture': {
      const w = clamp01(state.weight)
      return {
        kind: 'mixture',
        weights: [w, 1 - w],
        components: [leaf(state.componentA), leaf(state.componentB)],
      }
    }
  }
}

export function buildDocument(state: BuilderState): RvDocument {
  return { format_version: '1.0.0', rv: buildRvNode(state) }
}

function leaf(form: LeafForm): LeafNode {
  return { kind: 'leaf', dist: form.dist, params: { ...form.params } }
}

function op(form: OpForm): { name: string; params?: Record<string, number> } {
  const hasParams = Object.keys(form.params).length > 0
  return hasParams ? { name: form.name, params: { ...form.params } } : { name: form.name }
}

function clamp01(w: number): number {
  if (!Number.isFinite(w)) return 0.5
  return Math.min(1, Math.max(0, w))
}
