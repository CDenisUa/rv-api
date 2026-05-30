// Preset builder states, including materials-science examples (the project's domain). Selecting a
// preset just seeds the form; the user can then edit any parameter.

// Consts
import { defaultParams, distSpec, opSpec } from '@/consts/catalog'
// Types
import type { BuilderState } from '@/types/rv-form'

export interface Preset {
  id: string
  label: string
  note: string
  state: BuilderState
}

function base(): BuilderState {
  return {
    mode: 'leaf',
    leaf: { dist: 'normal', params: defaultParams(distSpec('normal')) },
    op: { name: 'exp', params: {} },
    base: { dist: 'normal', params: defaultParams(distSpec('normal')) },
    weight: 0.7,
    componentA: { dist: 'lognormal', params: defaultParams(distSpec('lognormal')) },
    componentB: { dist: 'lognormal', params: defaultParams(distSpec('lognormal')) },
  }
}

export const PRESETS: Preset[] = [
  {
    id: 'weibull-strength',
    label: 'Weibull fracture strength',
    note: 'Ceramic strength, shape 10, scale 350 MPa - a classic materials reliability model.',
    state: { ...base(), mode: 'leaf', leaf: { dist: 'weibull', params: { shape: 10, scale: 350 } } },
  },
  {
    id: 'bimodal-grains',
    label: 'Bimodal grain size',
    note: '0.7·Lognormal(1, 0.3) + 0.3·Lognormal(2.5, 0.4) - two grain populations.',
    state: {
      ...base(),
      mode: 'mixture',
      weight: 0.7,
      componentA: { dist: 'lognormal', params: { mu: 1, sigma: 0.3 } },
      componentB: { dist: 'lognormal', params: { mu: 2.5, sigma: 0.4 } },
    },
  },
  {
    id: 'exp-normal',
    label: 'exp(Normal) → Lognormal',
    note: 'Y = exp(X), X ~ N(0,1). Invertible transform; change-of-variables keeps log_prob.',
    state: {
      ...base(),
      mode: 'transform',
      op: { name: 'exp', params: {} },
      base: { dist: 'normal', params: { mu: 0, sigma: 1 } },
    },
  },
  {
    id: 'abs-normal',
    label: 'abs(Normal) - capability drop',
    note: 'Y = |X|. Non-invertible: log_prob and cdf are honestly dropped.',
    state: {
      ...base(),
      mode: 'transform',
      op: { name: 'abs', params: defaultParams(opSpec('abs')) },
      base: { dist: 'normal', params: { mu: 0, sigma: 1 } },
    },
  },
]
