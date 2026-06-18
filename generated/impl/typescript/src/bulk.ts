/**
 * Bulk array references (SPEC.md "Scalability"). Empirical sample arrays live either inline as
 * base64 or in an external .npy sidecar, keeping the structural document tiny. The TypeScript
 * reference decodes the inline base64 form (little-endian raw buffer) into a typed array.
 */

// Errors
import { ValidationError } from './errors'

export interface BulkRef {
  format: 'base64' | 'npy'
  dtype: 'float32' | 'float64' | 'int32' | 'int64'
  shape: number[]
  path?: string
  data?: string
}

/** Byte size of each dtype's element, used to validate buffer length. */
const DTYPE_SIZE: Record<BulkRef['dtype'], number> = {
  float32: 4,
  float64: 8,
  int32: 4,
  int64: 8,
}

/** Materialize an inline base64 bulk_ref into a Float64Array. */
export function decodeBulk(ref: BulkRef): Float64Array {
  if (ref.format === 'npy') {
    throw new ValidationError('npy sidecar bulk_ref is not supported by the TypeScript reference')
  }
  if (ref.format !== 'base64') {
    throw new ValidationError(`unsupported bulk format: ${String(ref.format)}`)
  }
  if (ref.data === undefined) {
    throw new ValidationError('base64 bulk_ref requires a "data" field')
  }
  const itemSize = DTYPE_SIZE[ref.dtype]
  if (itemSize === undefined) {
    throw new ValidationError(`unsupported bulk dtype: ${String(ref.dtype)}`)
  }
  const bytes = base64ToBytes(ref.data)
  // A decoded bulk_ref MUST be self-consistent (SPEC.md §8.5): exact dtype multiple, and element
  // count equal to the product of the declared shape - never silently truncate or misread.
  if (bytes.byteLength % itemSize !== 0) {
    throw new ValidationError(
      `bulk_ref byte length ${bytes.byteLength} is not a multiple of dtype '${ref.dtype}' size ${itemSize}`,
    )
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const out = readLittleEndian(view, ref.dtype)
  const expected = ref.shape.reduce((a, b) => a * b, 1)
  if (out.length !== expected) {
    throw new ValidationError(
      `bulk_ref element count ${out.length} does not match shape ${JSON.stringify(ref.shape)} (expected ${expected})`,
    )
  }
  return out
}

/** Encode a 1-D array as an inline base64 float64 bulk_ref (mirrors the Python encoder). */
export function encodeBulkBase64(values: ArrayLike<number>): BulkRef {
  const arr = Float64Array.from(values as ArrayLike<number>)
  const bytes = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength)
  return {
    format: 'base64',
    dtype: 'float64',
    shape: [arr.length],
    data: bytesToBase64(bytes),
  }
}

function readLittleEndian(view: DataView, dtype: BulkRef['dtype']): Float64Array {
  switch (dtype) {
    case 'float64': {
      const n = view.byteLength / 8
      const out = new Float64Array(n)
      for (let i = 0; i < n; i++) out[i] = view.getFloat64(i * 8, true)
      return out
    }
    case 'float32': {
      const n = view.byteLength / 4
      const out = new Float64Array(n)
      for (let i = 0; i < n; i++) out[i] = view.getFloat32(i * 4, true)
      return out
    }
    case 'int32': {
      const n = view.byteLength / 4
      const out = new Float64Array(n)
      for (let i = 0; i < n; i++) out[i] = view.getInt32(i * 4, true)
      return out
    }
    case 'int64': {
      const n = view.byteLength / 8
      const out = new Float64Array(n)
      for (let i = 0; i < n; i++) out[i] = Number(view.getBigInt64(i * 8, true))
      return out
    }
    default:
      throw new ValidationError(`unsupported bulk dtype: ${String(dtype)}`)
  }
}

function base64ToBytes(b64: string): Uint8Array {
  if (typeof Buffer !== 'undefined') {
    return new Uint8Array(Buffer.from(b64, 'base64'))
  }
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

function bytesToBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes).toString('base64')
  }
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary)
}
