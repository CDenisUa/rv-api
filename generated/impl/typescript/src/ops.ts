/**
 * Transform ops (Strategy pattern).
 *
 * Each op is `Y = forward(X)`. Invertible+differentiable ops support change-of-variables for
 * log_prob; monotone ops support cdf composition. A non-invertible op (`abs`) supports neither and
 * degrades the transform's capabilities accordingly (SPEC.md §5.3, §8.4).
 */

// Errors
import { NotInvertibleError, ValidationError } from './errors'

export interface OpJSON {
  name: string
  params?: Record<string, number>
}

export interface Op {
  readonly name: string
  readonly invertible: boolean
  /** Monotone direction: true (increasing), false (decreasing), or null if not monotone. */
  readonly increasing: boolean | null
  readonly monotone: boolean
  forward(x: number): number
  inverse(y: number): number
  /** log |d/dy inverse(y)| - the change-of-variables Jacobian term. */
  logAbsDInverse(y: number): number
  toJSON(): OpJSON
}

abstract class BaseOp implements Op {
  abstract readonly name: string
  abstract readonly invertible: boolean
  abstract readonly increasing: boolean | null

  get monotone(): boolean {
    return this.increasing !== null
  }

  abstract forward(x: number): number

  inverse(_y: number): number {
    throw new NotInvertibleError(`op '${this.name}' is not invertible`)
  }

  logAbsDInverse(_y: number): number {
    throw new NotInvertibleError(`op '${this.name}' has no inverse Jacobian`)
  }

  toJSON(): OpJSON {
    return { name: this.name }
  }
}

export class Affine extends BaseOp {
  readonly name = 'affine'
  readonly invertible = true
  constructor(
    readonly a: number,
    readonly b: number,
  ) {
    super()
  }
  override get increasing(): boolean {
    return this.a > 0
  }
  forward(x: number): number {
    return this.a * x + this.b
  }
  override inverse(y: number): number {
    return (y - this.b) / this.a
  }
  override logAbsDInverse(_y: number): number {
    return -Math.log(Math.abs(this.a))
  }
  override toJSON(): OpJSON {
    return { name: 'affine', params: { a: this.a, b: this.b } }
  }
}

export class Exp extends BaseOp {
  readonly name = 'exp'
  readonly invertible = true
  readonly increasing = true
  forward(x: number): number {
    return Math.exp(x)
  }
  override inverse(y: number): number {
    return Math.log(y)
  }
  override logAbsDInverse(y: number): number {
    return -Math.log(y)
  }
}

export class Log extends BaseOp {
  readonly name = 'log'
  readonly invertible = true
  readonly increasing = true
  forward(x: number): number {
    return Math.log(x)
  }
  override inverse(y: number): number {
    return Math.exp(y)
  }
  override logAbsDInverse(y: number): number {
    return y
  }
}

export class Pow extends BaseOp {
  readonly name = 'pow'
  readonly invertible = true
  constructor(readonly exponent: number) {
    super()
  }
  override get increasing(): boolean {
    return this.exponent > 0
  }
  forward(x: number): number {
    return Math.pow(x, this.exponent)
  }
  override inverse(y: number): number {
    return Math.pow(y, 1 / this.exponent)
  }
  override logAbsDInverse(y: number): number {
    const p = this.exponent
    return Math.log(Math.abs(1 / p)) + (1 / p - 1) * Math.log(y)
  }
}

export class Abs extends BaseOp {
  readonly name = 'abs'
  readonly invertible = false
  readonly increasing = null
  forward(x: number): number {
    return Math.abs(x)
  }
}

type OpFactory = (params: Record<string, number>) => Op

// Registry (Factory): op name -> builder from params. Adding an op = one registration.
const OPS: Record<string, OpFactory> = {
  affine: (p) => new Affine(num(p, 'a', 'affine'), num(p, 'b', 'affine')),
  exp: () => new Exp(),
  log: () => new Log(),
  pow: (p) => new Pow(num(p, 'exponent', 'pow')),
  abs: () => new Abs(),
}

// Exact set of params each op accepts. exp/log/abs take none; unexpected keys are rejected rather
// than silently ignored (SPEC.md §5.3) - a malformed or LLM-generated op MUST NOT be misread.
const OP_PARAMS: Record<string, readonly string[]> = {
  affine: ['a', 'b'],
  exp: [],
  log: [],
  pow: ['exponent'],
  abs: [],
}

export function buildOp(name: string, params?: Record<string, number>): Op {
  const factory = OPS[name]
  if (!factory) throw new ValidationError(`unknown transform op '${name}'`)
  const provided = params ?? {}
  const allowed = OP_PARAMS[name]!
  const extra = Object.keys(provided).filter((k) => !allowed.includes(k))
  if (extra.length > 0) {
    throw new ValidationError(`op '${name}' got unexpected param(s): ${extra.join(', ')}`)
  }
  return factory(provided)
}

function num(params: Record<string, number>, key: string, op: string): number {
  const v = params[key]
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    throw new ValidationError(`op '${op}' requires numeric param '${key}'`)
  }
  return v
}
