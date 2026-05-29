// Distribution and transform-op metadata that drives the builder form. One source of truth for the
// param names, labels, and sensible defaults — adding a distribution to the UI is a single entry.

export interface ParamSpec {
  key: string
  label: string
  default: number
  step?: number
}

export interface DistSpec {
  name: string
  label: string
  params: ParamSpec[]
}

export interface OpSpec {
  name: string
  label: string
  params: ParamSpec[]
  /** Non-invertible ops drop log_prob/cdf — surfaced in the UI as honest capability degradation. */
  invertible: boolean
}

export const DISTRIBUTIONS: DistSpec[] = [
  { name: 'normal', label: 'Normal', params: [p('mu', 'μ', 0), p('sigma', 'σ', 1, 0.1)] },
  { name: 'lognormal', label: 'Lognormal', params: [p('mu', 'μ (log)', 0), p('sigma', 'σ (log)', 0.4, 0.1)] },
  { name: 'weibull', label: 'Weibull', params: [p('shape', 'shape k', 10, 0.5), p('scale', 'scale λ', 350, 5)] },
  { name: 'uniform', label: 'Uniform', params: [p('low', 'low', 0), p('high', 'high', 1)] },
  { name: 'exponential', label: 'Exponential', params: [p('rate', 'rate λ', 1.5, 0.1)] },
  { name: 'gamma', label: 'Gamma', params: [p('shape', 'shape k', 2, 0.5), p('scale', 'scale θ', 2, 0.5)] },
  { name: 'beta', label: 'Beta', params: [p('alpha', 'α', 2, 0.5), p('beta', 'β', 5, 0.5)] },
]

export const OPS: OpSpec[] = [
  { name: 'affine', label: 'affine  (a·x + b)', invertible: true, params: [p('a', 'a', 2), p('b', 'b', 1)] },
  { name: 'exp', label: 'exp  (eˣ)', invertible: true, params: [] },
  { name: 'log', label: 'log  (ln x)', invertible: true, params: [] },
  { name: 'pow', label: 'pow  (xᵖ)', invertible: true, params: [p('exponent', 'p', 2)] },
  { name: 'abs', label: 'abs  (|x|)  — drops log_prob', invertible: false, params: [] },
]

export function distSpec(name: string): DistSpec {
  return DISTRIBUTIONS.find((d) => d.name === name) ?? DISTRIBUTIONS[0]
}

export function opSpec(name: string): OpSpec {
  return OPS.find((o) => o.name === name) ?? OPS[0]
}

/** Default params for a distribution, as a fresh record. */
export function defaultParams(spec: DistSpec | OpSpec): Record<string, number> {
  return Object.fromEntries(spec.params.map((s) => [s.key, s.default]))
}

function p(key: string, label: string, def: number, step = 0.1): ParamSpec {
  return { key, label, default: def, step }
}
