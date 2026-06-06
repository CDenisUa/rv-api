// Canonical JSON helper for the demo export path. It mirrors the format's writer rule that object
// keys are sorted recursively while array order remains semantic and must be preserved.

export function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (!value || typeof value !== 'object') return value

  const out: Record<string, unknown> = {}
  for (const key of Object.keys(value as Record<string, unknown>).sort()) {
    const v = (value as Record<string, unknown>)[key]
    if (v !== undefined) out[key] = canonicalize(v)
  }
  return out
}

export function canonicalText(value: unknown): string {
  return JSON.stringify(canonicalize(value), null, 2)
}
