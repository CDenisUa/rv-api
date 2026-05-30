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
spec/          # JSON Schema (Draft 2020-12) + human-readable SPEC.md (semantics, capabilities, Big-O)
conformance/   # language-neutral *.rv.json cases + golden values (the contract); generate.py
impl/
  python/      # reference "scientific producer" - scipy.stats adapter; generates the golden
  typescript/  # reference (hero) - discriminated-union ADT + never, Zod, visitor, alias method
  rust/        # systems core - enum ADT, serde, criterion benches; compiles to WebAssembly
demo/          # Next.js dashboard: build an RV, sample it live, see Python == TS == Rust
evidence/      # EVIDENCE.md - generated cross-language conformance matrix, timings, Big-O
```

## Status

All milestones complete and green:

- **M0** spec · **M1** conformance suite (17 cases) · **M2** Python · **M3** TypeScript · **M4** Rust → WASM ·
  **M5** Next.js demo · **M6** evidence pack.
- The same `.rv.json` reproduces to the same numbers in all three languages within **1e-9** - see
  [`evidence/EVIDENCE.md`](evidence/EVIDENCE.md).

## Quick start

```bash
# Conformance suites (each asserts agreement with golden @1e-9):
cd impl/python     && PYTHONPATH=src python3 -m pytest      # 102 passed
cd impl/typescript && npm install && npm test               # 109 passed
cd impl/rust       && cargo test                            # conformance + property tests

# Cross-language evidence pack:
PYTHONPATH=impl/python/src python3 evidence/build_evidence.py

# Demo dashboard (uses pnpm):
cd demo && pnpm install && pnpm run dev                      # http://localhost:3000
```

## Design principles

- **Semantic, not implementation-specific** - describes what an RV *means*, not how a library stores it.
- **Declarative** - fully described by its fields; no embedded executable code.
- **Portable** - the same document reconstructs to the same RV in any conforming implementation.
- **Explicit capabilities** - `can_sample` / `can_log_prob` / `can_cdf` are declared *and* revalidated;
  a non-invertible transform honestly loses `log_prob` (capability propagation is a real correctness concern).
