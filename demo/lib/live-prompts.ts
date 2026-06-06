// Compact prompts + attachment for LIVE mode only. The committed canonical artifacts (and Replay
// mode) still come from the full prompts in ../../pipeline/prompts and pipeline/run.py.
//
// Live is a real generate -> demonstrate -> prove loop: step 1 writes a minimal-but-real spec (two
// leaf distributions, the same `mu/sigma` and `low/high` parameterization the canonical conformance
// cases use), step 2 writes a single browser-ready JavaScript engine exporting a FIXED API. The demo
// (step 3) then runs *that generated engine* in the browser, and the proof (step 4) feeds it the
// frozen scipy/Rust golden cases - so the code Claude just wrote is the code being demonstrated and
// proven. Keeping the two distributions parameterized exactly like the canonical cases is what makes
// that cross-check possible.

// The exact named exports the generated engine MUST provide. The demo and proof call these directly,
// so the contract is shared here and enforced after generation in lib/live-engine.ts.
export const ENGINE_EXPORTS = [
  'validate',
  'logProb',
  'cdf',
  'sample',
  'mean',
  'variance',
  'toCanonical',
] as const

// The compact spec we ask the model to produce in step 1. Step 2 receives only COMPACT_SCHEMA_JSON;
// its `x-rvx-semantics` block carries the formulas the generated engine needs.
export const COMPACT_SPEC_MD = `# RV Exchange Format (minimal) - SPEC.md

A portable JSON serialization of a single continuous random variable, so one system can write it and
another (possibly in a different language) can reconstruct it and operate on it. This is the minimal
teaching subset: a single \`leaf\` distribution, two families.

## Document envelope
A document is a JSON object:
- \`format_version\` - semantic version string \`MAJOR.MINOR.PATCH\`, starting at \`"1.0.0"\`.
- \`metadata\` - OPTIONAL, free-form, non-semantic (name, units, notes). Ignored by all operations.
- \`rv\` - the single root RV node.

## The RV node
\`rv\` is a \`leaf\`: \`{ "kind": "leaf", "dist": <name>, "params": { ... } }\`. Exactly two families:
- \`normal\` - \`params: { "mu": number, "sigma": number }\`, the mean and standard deviation, \`sigma > 0\`.
- \`uniform\` - \`params: { "low": number, "high": number }\`, with \`high > low\`.

The leaf node has exactly the fields \`kind\`, \`dist\`, and \`params\`; unknown node fields are invalid.

## Operations (every reader MUST provide all three)
Let \`x\` be a real number. \`log_prob\` is given in log-space.

### normal(mu, sigma)
- \`log_prob(x)\` = \`-0.5 * ((x - mu) / sigma)^2 - log(sigma) - 0.5 * log(2*pi)\`.
- \`cdf(x)\` = \`0.5 * (1 + erf((x - mu) / (sigma * sqrt(2))))\`.
- \`sample(n, seed)\` = \`mu + sigma * z\`, \`z\` a standard-normal draw from a seeded RNG.
- mean = \`mu\`; variance = \`sigma^2\`.

### uniform(low, high)
- \`log_prob(x)\` = \`-log(high - low)\` if \`low <= x <= high\`, else \`-inf\`.
- \`cdf(x)\` = \`0\` for \`x < low\`, \`(x - low) / (high - low)\` for \`low <= x <= high\`, \`1\` for \`x > high\`.
- \`sample(n, seed)\` = \`low + (high - low) * u\`, \`u\` a seeded uniform draw in \`[0, 1)\`.
- mean = \`(low + high) / 2\`; variance = \`(high - low)^2 / 12\`.

## Canonical form
When writing, object keys MUST be sorted and numbers emitted in their shortest round-trippable form,
so \`write -> read -> write\` is byte-stable.

## Validation (readers MUST reject)
- An unknown \`kind\` (anything but \`leaf\`) or unknown \`dist\`.
- Missing required params for the family.
- Constraint violations: \`sigma > 0\`, \`high > low\`.
- A document whose \`format_version\` MAJOR component exceeds \`1\`.
`

export const COMPACT_SCHEMA_JSON = `{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://materials.example/rv.schema.json",
  "title": "RV Exchange Format (minimal)",
  "x-rvx-semantics": {
    "contract": "Machine-readable hand-off for the compact live demo. JSON Schema defines structure; this object defines semantics.",
    "versioning": { "implemented_major": 1, "reject_if_format_major_exceeds": 1 },
    "canonical_json": { "object_keys": "sort lexicographically", "numbers": "shortest round-trippable", "roundtrip": "read -> write -> read -> write is byte-stable" },
    "operations": {
      "validate": "Reject unknown kind/dist, missing params, sigma <= 0, high <= low, and format_version MAJOR > 1.",
      "logProb": "Natural log density at scalar x.",
      "cdf": "Cumulative probability P(X <= x).",
      "sample": "Deterministic seeded sampling.",
      "mean": "Analytic mean.",
      "variance": "Analytic variance."
    },
    "leaf_distributions": {
      "normal": {
        "params": ["mu", "sigma"],
        "constraints": ["sigma > 0"],
        "logProb": "-0.5*((x-mu)/sigma)^2 - log(sigma) - 0.5*log(2*pi)",
        "cdf": "0.5*(1 + erf((x-mu)/(sigma*sqrt(2))))",
        "sample": "mu + sigma * standard_normal(seed)",
        "mean": "mu",
        "variance": "sigma^2"
      },
      "uniform": {
        "params": ["low", "high"],
        "constraints": ["high > low"],
        "logProb": "-log(high-low) if low <= x <= high else -Infinity",
        "cdf": "0 below low, (x-low)/(high-low) on [low,high], 1 above high",
        "sample": "low + (high-low)*u(seed)",
        "mean": "(low+high)/2",
        "variance": "(high-low)^2/12"
      }
    }
  },
  "type": "object",
  "additionalProperties": false,
  "required": ["format_version", "rv"],
  "properties": {
    "format_version": { "type": "string", "pattern": "^\\\\d+\\\\.\\\\d+\\\\.\\\\d+$" },
    "metadata": { "type": "object" },
    "rv": { "$ref": "#/$defs/leaf" }
  },
  "$defs": {
    "leaf": {
      "type": "object",
      "required": ["kind", "dist", "params"],
      "additionalProperties": false,
      "properties": {
        "kind": { "const": "leaf" },
        "dist": { "enum": ["normal", "uniform"] },
        "params": { "type": "object" }
      },
      "oneOf": [
        {
          "properties": {
            "dist": { "const": "normal" },
            "params": {
              "type": "object",
              "additionalProperties": false,
              "required": ["mu", "sigma"],
              "properties": {
                "mu": { "type": "number" },
                "sigma": { "type": "number", "exclusiveMinimum": 0 }
              }
            }
          }
        },
        {
          "properties": {
            "dist": { "const": "uniform" },
            "params": {
              "type": "object",
              "additionalProperties": false,
              "required": ["low", "high"],
              "properties": {
                "low": { "type": "number" },
                "high": { "type": "number" }
              }
            }
          }
        }
      ]
    }
  }
}
`

export const LIVE_SPEC_PROMPT = `# Prompt #1 (live demo) - Write a minimal RV Exchange Format spec

You are a specification author for scientific data interchange. Produce version 1 of a *minimal* RV
Exchange Format: a portable JSON serialization of a single continuous random variable, so one system
can write it and another - possibly in a different language - can reconstruct it and operate on it.

Return exactly two artifacts:
1. \`SPEC.md\` - a short, self-contained specification using RFC-2119 keywords (MUST, SHOULD, MAY).
2. \`rv.schema.json\` - a strict JSON Schema (draft 2020-12, \`additionalProperties: false\` on fixed
   objects) with an \`x-rvx-semantics\` object carrying the formulas for code generation.

Scope - do NOT add anything beyond this:
- Envelope: a JSON object with \`format_version\` ("1.0.0"), an OPTIONAL free-form \`metadata\`, and \`rv\`.
- \`rv\` is a \`leaf\` node: \`{ "kind": "leaf", "dist": <name>, "params": { ... } }\`.
- Exactly two distributions, parameterized EXACTLY like this (these names are fixed):
  - \`normal\` - \`params: { "mu": number, "sigma": number }\` (mean and std-dev), with \`sigma > 0\`.
  - \`uniform\` - \`params: { "low": number, "high": number }\`, with \`high > low\`.
- Operations every reader must provide: \`sample(n, seed)\`, \`log_prob(x)\`, \`cdf(x)\`, plus analytic
  \`mean\`/\`variance\`. State the exact closed-form formulas in SPEC.md (log-space for \`log_prob\`).
- Canonical form: object keys sorted, numbers shortest round-trippable, so write->read->write is stable.
- Validation: reject unknown \`kind\`/\`dist\`, missing params, constraint violations (sigma>0, high>low),
  and a \`format_version\` whose MAJOR exceeds 1.

Keep it tight - this is a minimal teaching version, not a full format. Output ONLY the two files.
`

// Step 2, Live: a single browser-ready JavaScript ES module with a fixed API. This is the engine the
// demo runs and the proof checks - so the contract (exact export names, the `doc` shape) is rigid.
export const LIVE_IMPL_PROMPT = `# Prompt #2 (live demo) - A JavaScript engine for the format

Using only the attached \`rv.schema.json\` (including its \`x-rvx-semantics\` block), implement the
minimal RV Exchange Format as a single **browser-ready JavaScript ES module**, in one file named
\`engine.js\`.

The module MUST export EXACTLY these named functions (no more, no fewer), where \`doc\` is a parsed
\`.rv.json\` object \`{ format_version, metadata?, rv: { kind: "leaf", dist, params } }\`:

- \`export function validate(doc)\` - throw an \`Error\` if \`doc\` violates the spec (unknown kind/dist,
  missing params, sigma<=0, high<=low, or format_version MAJOR > 1); return nothing if valid.
- \`export function logProb(doc, x)\` - the log density at \`x\` (a number; may be \`-Infinity\`).
- \`export function cdf(doc, x)\` - the CDF at \`x\`.
- \`export function sample(doc, n, seed)\` - an array of \`n\` numbers drawn with a deterministic,
  seeded PRNG (same \`seed\` => same array; implement the RNG inline, e.g. mulberry32).
- \`export function mean(doc)\` - the analytic mean.
- \`export function variance(doc)\` - the analytic variance.
- \`export function toCanonical(doc)\` - the canonical JSON string (object keys sorted, shortest
  round-trippable numbers).

Hard requirements:
- Plain JavaScript only. NO imports, NO \`require\`, NO TypeScript syntax. Use only \`Math\` and \`JSON\`.
  Implement \`erf\` yourself for the normal CDF, as accurately as you can (aim for absolute error below
  1e-9, e.g. a high-order rational/Chebyshev approximation - not just Abramowitz-Stegun 7.1.26).
- Support the two families from the spec, with the \`{ mu, sigma }\` / \`{ low, high }\` params exactly.
- The code MUST run as-is in a browser: every name defined in the file, no stubs, no \`...\` bodies.

Output ONLY the single file, wrapped in \`<<<FILE: engine.js>>>\` / \`<<<END FILE>>>\`.
`
