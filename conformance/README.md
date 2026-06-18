# RV Exchange - Conformance Suite

A language-neutral, executable contract. Every implementation (Python, TypeScript, Rust) must load
these cases and reproduce the golden outputs within tolerance. Passing this suite is the objective
definition of "conformant" - analogous to the Web Platform Tests or SQL logic tests. It is also the
mechanism that would validate any LLM-generated implementation.

## Layout

```
conformance/
├── manifest.json        # index of all (positive) cases
├── generate.py          # regenerates cases + golden from scipy (the reference source of truth)
├── cases/<name>.rv.json # the RV document (input) - validates against generated/spec/rv.schema.json
├── golden/<name>.json   # expected outputs for that case
└── invalid/             # negative contract: documents every reader MUST reject
    ├── manifest.json    #   index of invalid fixtures (name, doc, reason)
    ├── generate_invalid.py
    └── <name>.rv.json   #   one rejection rule each (op params, bulk self-consistency, weights, …)
```

## Negative suite (`invalid/`)

The golden suite proves the happy path; `invalid/` proves the rejection path. Each fixture is a
document that **every** conforming reader MUST reject (structural or semantic validation). Error
messages differ by language, so the contract is "rejected", not "rejected with message X". All three
implementations load `invalid/manifest.json` and assert that parsing throws
(`test_invalid_conformance.py`, `invalid.test.ts`, `invalid.rs`).

## Golden file shape

```jsonc
{
  "case": "normal_standard",
  "format_version": "1.0.0",
  "kind": "leaf",
  "capabilities": { "can_sample": true, "can_log_prob": true, "can_cdf": true },
  "moments":  { "mean": 0.0, "variance": 1.0 },          // scalars; arrays for joint; null if N/A
  "log_prob": [ { "x": 0.0, "value": -0.9189385332 } ],  // null when can_log_prob is false
  "cdf":      [ { "x": 0.0, "value": 0.5 } ],             // null when can_cdf is false
  "sampling": { "seed": 12345, "n": 200000, "ks_stat_max": 0.02,
                "mean_atol": 0.05, "var_rtol": 0.05 }
}
```

For `joint` cases, `x` is a vector and `moments.mean` / `moments.variance` are per-dimension arrays.

## What an implementation MUST check per case

1. **Validation** - the case validates against `generated/spec/rv.schema.json` and passes semantic validation
   (SPEC.md §6.2), including capability re-computation.
2. **Capabilities** - recomputed capabilities equal the golden `capabilities`.
3. **log_prob** - for each control point, `|computed − value| ≤ 1e-9` (absolute) when `log_prob` is
   present. When `null`, the implementation MUST report the operation as unavailable.
4. **cdf** - same tolerance rule as `log_prob`.
5. **moments** - analytic/closed-form moments match within `1e-9`; for `empirical` (sample-derived
   moments) within the case's `mean_atol` / `var_rtol`.
6. **sampling** - draw `n` samples with `seed`; when `ks_stat_max` is set, the Kolmogorov-Smirnov
   statistic against the case's own CDF MUST be `≤ ks_stat_max`. Additionally the sample mean/variance
   MUST satisfy `mean_atol` / `var_rtol`. (RNG streams differ across languages, so sampling is checked
   statistically, not byte-for-byte.)

## Tolerances - why two regimes

- **Deterministic outputs** (`log_prob`, `cdf`, analytic `moments`) are exact mathematics and use a
  tight `1e-9`.
- **Sampling** is stochastic and RNG-dependent; it uses statistical tolerances (KS + moment bounds).

## Coverage (21 cases)

| Area | Cases |
|------|-------|
| Analytic leaves | normal_standard, normal_shifted, lognormal_basic, weibull_strength, uniform_unit, uniform_range, exponential_basic, gamma_basic, beta_basic |
| Discrete leaves | categorical_die, poisson_defects, binomial_qc |
| Sample-based | empirical_samples |
| Composites | joint_normal_uniform, mixture_bimodal |
| Transforms | transform_exp_normal, transform_affine_normal, transform_log_lognormal, transform_pow_lognormal (all invertible), transform_abs_normal (non-invertible → log_prob/cdf dropped) |
| Recursion | nested_mixture_transform (depth-2) |

`transform_abs_normal` is intentionally non-invertible to assert that capability degradation is
handled honestly. The discrete cases (`categorical_die`, `poisson_defects`, `binomial_qc`) set
`ks_stat_max` to `null`: the KS test is a continuous-CDF test, so discrete sampling is checked via
the moment tolerances instead. `normal_standard` stays at `format_version` `1.0.0` while the rest of
the suite is `1.1.0`, proving the MINOR revision is backward-compatible (SPEC.md §9).

## Regenerating

```
python3 conformance/generate.py
```

Golden values are produced from `scipy.stats` (the trustworthy reference). Cross-checks are built in:
e.g. `exp(N(0,1))` golden is generated from `scipy.lognorm`, and `2·N(0,1)+1` from `scipy.norm(1,2)`,
so an independent analytic path confirms the change-of-variables math in SPEC.md §8.4.
