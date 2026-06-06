<p align="center">
  <img src="logo.jpg" alt="MCL Logo" height="60" />
</p>

# RV Exchange Format

A portable, language-neutral format for serializing a **random variable** as a whole, so one system
can serialize it and another - in a different language - can reconstruct it and operate on it. The
format describes the *semantics* of a random variable, not a library-specific class instance.

The thesis of this project: a **spec + an executable conformance suite** is a contract that both
*proves* cross-language interoperability and *de-risks* implementations in unfamiliar languages -
the same mechanism that would validate an LLM-generated implementation.

## Supported RV kinds

| Kind | Description |
|------|-------------|
| `Leaf` | Atomic analytic or empirical distribution (normal, lognormal, weibull, uniform, exponential, gamma, beta, categorical, empirical) |
| `Joint` | Independent composition over dimensions |
| `Mixture` | Weighted combination over components |
| `Transform` | Deterministic transform of another RV (`affine`, `exp`, `log`, `pow`, `abs`) |

## Repository layout

```
generated/spec/ # JSON Schema (Draft 2020-12) + human-readable SPEC.md (semantics, capabilities, Big-O)
pipeline/
  prompts/      # prompt #1 and prompt #2; prompt #2 receives only rv.schema.json
  run.py        # reproducible Claude Code two-prompt runner
conformance/   # language-neutral *.rv.json cases + golden values (the contract); generate.py
generated/impl/
  python/      # reference "scientific producer" - scipy.stats adapter; generates the golden
  typescript/  # reference (hero) - discriminated-union ADT + never, Zod, visitor, alias method
  rust/        # systems core - enum ADT, serde, criterion benches; compiles to WebAssembly
demo/          # Next.js dashboard: single RV studio + batch export/import + live compact generation
evidence/      # EVIDENCE.md - generated cross-language conformance matrix, timings, Big-O
```

## Implementation notes

- **Empirical `bulk_ref` transport** - all three references decode the mandatory inline `base64`
  transport. The `.npy` sidecar is an optional transport (SPEC §8.5): the Python reference reads it;
  the TypeScript and Rust references reject `npy` with an explicit error rather than misread it.
- **Machine-readable hand-off** - `generated/spec/rv.schema.json` is not just structural JSON Schema;
  it also carries `x-rvx-semantics`, the machine-readable semantic extension used by Prompt #2.
- **Format version** - each reference rejects a document whose `format_version` MAJOR exceeds the
  version it implements (SPEC §9), so a future breaking revision can never be silently misinterpreted.

## Status

All milestones complete and green:

- **M0** spec · **M1** conformance suite (17 cases) · **M2** Python · **M3** TypeScript · **M4** Rust → WASM ·
  **M5** Next.js demo · **M6** evidence pack · **M7** tracked two-prompt pipeline.
- The same `.rv.json` reproduces to the same numbers in all three languages within **1e-9** - see
  [`evidence/EVIDENCE.md`](evidence/EVIDENCE.md).
- The demo includes the formal task flow: TypeScript/React writes a list of discrete and continuous
  RV documents, exports it as `.rv-list.json`, and Rust/WASM imports and samples the same documents.
- The web **Live** mode is intentionally compact (`normal`/`uniform`, generated JavaScript) so it can
  stream in seconds. The full canonical path remains Python + TypeScript + Rust through
  `pipeline/run.py` and the conformance suite.

## Getting started

All commands are run from the repository root unless noted.

### Prerequisites

| Tool | Version | Used for |
|------|---------|----------|
| Python | 3.10+ (3.12 in CI) | reference impl + golden generation |
| Node.js | 20+ | TypeScript engine (`npm`) and demo (`pnpm`) |
| Rust | stable | systems core; add the `wasm32-unknown-unknown` target for the WASM build |

Python packages: `numpy scipy` (runtime) plus `pytest hypothesis jsonschema` (tests).

### Run the reference implementations (tests)

Each conformance suite asserts agreement with the shared golden within **1e-9**.

```bash
# Python - scipy adapter; also produces the golden
(cd generated/impl/python && \
  pip install numpy scipy pytest hypothesis jsonschema && \
  PYTHONPATH=src python3 -m pytest)              # 108 passed, 5 skipped

# TypeScript
(cd generated/impl/typescript && \
  npm install && \
  npm test && \
  npm run typecheck)

# Rust - conformance + property tests
(cd generated/impl/rust && cargo test)
```

### Build the Rust engine to WebAssembly (optional)

```bash
rustup target add wasm32-unknown-unknown
cd generated/impl/rust
cargo build --release --target wasm32-unknown-unknown --features wasm
```

### Run the demo app

The dashboard lives in `demo/` and uses the TypeScript `rvx` package through a local
`file:../generated/impl/typescript` dependency. It needs **pnpm** - if it is not available, enable it with
Corepack first:

```bash
corepack enable
corepack prepare pnpm@10 --activate
```

```bash
cd demo
pnpm install
pnpm run dev                                     # http://localhost:3000
```

The page reads the shared `conformance/` fixtures at render time and samples with either the
TypeScript engine or the committed Rust WebAssembly build, so no separate Python or Rust process is
needed to use the app. For a production check: `pnpm run typecheck && pnpm run build && pnpm run start`.

### Regenerate the cross-language evidence pack

```bash
PYTHONPATH=generated/impl/python/src python3 evidence/build_evidence.py
```

Each implementation independently re-derives every conformance value and the script asserts they
agree within 1e-9, then writes [`evidence/EVIDENCE.md`](evidence/EVIDENCE.md).

## Design principles

- **Semantic, not implementation-specific** - describes what an RV *means*, not how a library stores it.
- **Declarative** - fully described by its fields; no embedded executable code.
- **Portable** - the same document reconstructs to the same RV in any conforming implementation.
- **Explicit capabilities** - `can_sample` / `can_log_prob` / `can_cdf` are declared *and* revalidated;
  a non-invertible transform honestly loses `log_prob` (capability propagation is a real correctness concern).
