# rvx - TypeScript reference implementation

The reference (hero) implementation of the RV Exchange Format v1. Parses/validates `*.rv.json`,
evaluates `log_prob` / `cdf`, draws samples, and computes moments - pinned to the same
language-neutral conformance golden values as the Python and Rust implementations. Closed forms match
`scipy.stats` to `1e-9` using hand-rolled special functions (no scientific runtime dependency).

## Architecture (load-bearing patterns only)

| Module | Responsibility | Pattern |
|--------|----------------|---------|
| `model.ts` | RV ADT as a discriminated union: `Leaf · Joint · Mixture · Transform`; `visit` with `never` exhaustiveness | Composite + Visitor dispatch |
| `operations.ts` | `sample` / `logProb` / `cdf` / `moments` / capabilities, each a visitor | Visitor |
| `distributions.ts` | leaf catalog keyed by name; analytic + categorical/empirical (KDE) | Registry + Adapter |
| `ops.ts` | transform ops (`affine/exp/log/pow/abs`) with inverse + Jacobian | Strategy + Registry |
| `special.ts` | `lgamma`, incomplete gamma `P(a,x)`, incomplete beta `Iₓ(a,b)`, `erf` (≈1e-12) | - |
| `numerics.ts` | `logSumExp`, Vose alias sampler | - |
| `rng.ts` | seedable PRNG (`sfc32`) + normal/gamma/exponential samplers | - |
| `bulk.ts` | empirical bulk arrays (inline base64 → `Float64Array`) | - |
| `schema.ts` | structural validation via Zod (typed door into the model) | - |
| `parse.ts` | document ⇄ model, semantic validation, capability re-check | - |

The ADT is a TypeScript discriminated union; `visit` dispatches with a `never` exhaustiveness check,
so adding a kind without handling it is a **compile error**. Adding a distribution = one `register`
(Open/Closed); adding an operation = one new visitor - neither touches the model.

## Use

```ts
import { parseDocument, capabilities, logProb, cdf, sample, moments, RNG } from 'rvx'

const doc  = JSON.parse(readFileSync('conformance/cases/mixture_bimodal.rv.json', 'utf-8'))
const node = parseDocument(doc)        // parses + validates (incl. capability re-check)

capabilities(node)                     // -> { can_sample, can_log_prob, can_cdf }
logProb(node, 3.0)                      // natural-log density (log-sum-exp for mixtures)
cdf(node, 3.0)
sample(node, new RNG(0), 10_000)        // Float64Array (per-dimension arrays for Joint)
moments(node)                           // [mean, variance] where closed-form is known
```

Non-invertible transforms degrade capabilities honestly: `logProb`/`cdf` on `abs(X)` throw
`CapabilityError`, and `capabilities` reports `can_log_prob=false`, `can_cdf=false`.

## Tests

```bash
npm install
npm test            # vitest run
npm run typecheck   # tsc --noEmit
```

- `tests/conformance.test.ts` - runs the full language-neutral suite in `../../conformance/`. Each
  case is validated against the canonical JSON Schema (`spec/rv.schema.json`) with **ajv**,
  independently of the library's own Zod door. Deterministic outputs (`log_prob`, `cdf`, analytic
  `moments`) match golden within `1e-9`; sampling is checked statistically (KS vs the case's own CDF
  + moment tolerances).
- `tests/properties.test.ts` - fast-check: serialize→parse round-trip identity, sample↔CDF agreement
  (KS), and validation rejections (bad weights, declared-capability mismatch, invalid parameters).

## Why two validators (Zod + ajv)?

Zod is the library's own typed entry point: validating a document yields static types for the parser
to consume. The conformance test additionally checks every fixture against the canonical JSON Schema
with ajv - so the Zod transcription and the shared contract are kept honest against each other.
