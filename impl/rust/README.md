# rvx — Rust reference implementation

The systems / WebAssembly core of the RV Exchange Format v1. Parses/validates `*.rv.json`, evaluates
`log_prob` / `cdf`, draws samples, and computes moments — pinned to the same language-neutral
conformance golden values as the Python and TypeScript references. Closed forms match `scipy.stats`
to `1e-9` via hand-rolled special functions, with **no scientific dependency**, so the same core
compiles to native and to WebAssembly for the demo.

## Architecture

| Module | Responsibility |
|--------|----------------|
| `model.rs` | RV ADT as a Rust `enum` (`Leaf · Joint · Mixture · Transform`); `Capabilities`, `Support` |
| `operations.rs` | `Prepared` evaluator (compiles a doc, owning its built distributions) + capability recompute |
| `distributions.rs` | leaf catalog keyed by name; analytic + categorical/empirical (KDE) |
| `ops.rs` | transform ops `enum` (`affine/exp/log/pow/abs`) with inverse + Jacobian |
| `special.rs` | `lgamma`, incomplete gamma `P(a,x)`, incomplete beta `Iₓ(a,b)`, `erf` (≈1e-12) |
| `numerics.rs` | `log_sum_exp`, Vose alias sampler |
| `rng.rs` | seedable PRNG (`sfc32`) + normal/gamma/exponential samplers |
| `bulk.rs` | empirical bulk arrays (inline base64 → `Vec<f64>`) |
| `parse.rs` | serde document ⇄ model, semantic validation, capability re-check |
| `wasm.rs` | wasm-bindgen surface (feature `wasm`) for the browser demo |

The model is an exact algebraic data type; operations `match` on it, so adding a variant is a
compile error until every operation handles it. A document is **compiled** into a `Prepared`
evaluator that owns its leaf distributions — compile once, evaluate many (a KS sweep over 200k points
never rebuilds the empirical KDE).

## Use

```rust
let node = rvx::parse_str(doc_json)?;          // parses + validates (incl. capability re-check)
let caps = rvx::capabilities(&node)?;          // { can_sample, can_log_prob, can_cdf }
let lp   = rvx::log_prob(&node, &[3.0])?;       // scalar slice; a vector for Joint
let p    = rvx::cdf(&node, &[3.0])?;
let xs   = rvx::sample(&node, &mut rvx::Rng::new(0), 10_000)?;
let (mean, var) = rvx::moments(&node)?;         // closed-form where known

// Hot path: compile once, evaluate many.
let prepared = rvx::Prepared::compile(&node)?;
```

Non-invertible transforms degrade capabilities honestly: `log_prob`/`cdf` on `abs(X)` return
`Err(RvError::Capability(..))`, and `capabilities` reports `can_log_prob=false`, `can_cdf=false`.

## Tests

```bash
cargo test                 # conformance + property tests
cargo bench                # criterion benchmarks (hot paths)
```

- `tests/conformance.rs` — runs the full language-neutral suite in `../../conformance/`. Each case is
  validated against the canonical JSON Schema (`spec/rv.schema.json`) with the `jsonschema` crate,
  independently of the crate's serde door. Deterministic outputs (`log_prob`, `cdf`, analytic
  `moments`) match golden within `1e-9`; sampling is checked statistically (KS vs the case's own CDF
  + moment tolerances).
- `tests/properties.rs` — proptest: serialize→parse round-trip identity, sample↔CDF agreement (KS),
  and validation rejections (bad weights, declared-capability mismatch, invalid parameters).

## WebAssembly

```bash
cargo build --release --target wasm32-unknown-unknown --features wasm
# or, with JS bindings for the Next.js demo:
wasm-pack build --release --features wasm
```

The `wasm` feature exposes `rv_capabilities`, `rv_log_prob`, `rv_cdf`, and `rv_sample` (documents in
as JSON strings; samples out as `Float64Array`) so the demo can run the Rust core client-side and
show "Python == TypeScript == Rust" on the same `.rv.json`.
