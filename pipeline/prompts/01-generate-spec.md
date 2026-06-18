# Prompt #1 - Generate the RV Exchange Format specification

## Role

You are a specification author for scientific data interchange. Write a semantic, declarative,
language-neutral exchange format for random variables. The output of this prompt is the contract used
by Prompt #2; it is not implementation code.

## Task

Design version 1 of the RV Exchange Format: a portable JSON serialization of a random variable (RV) as
a whole, so one system can write it and another system, possibly in a different language/framework,
can reconstruct it and operate on it.

Return exactly two files:

1. `SPEC.md` - a human-readable, self-contained specification using RFC-2119 keywords.
2. `rv.schema.json` - the machine-readable specification file. It MUST be valid JSON Schema draft
   2020-12 and MUST also carry self-contained semantic metadata under an extension keyword named
   `x-rvx-semantics`. Prompt #2 receives only this machine-readable file, so it must contain enough
   information to generate a reader/writer without reading `SPEC.md`.

The two files MUST agree. `SPEC.md` is for humans; `rv.schema.json` is the hand-off contract for code
generation.

## Required design decisions

### Document envelope

A document is a JSON object with:

- `format_version` - semantic version string `MAJOR.MINOR.PATCH`, starting at `"1.0.0"`.
- `metadata` - optional free-form, non-semantic annotations.
- `rv` - the single root RV node.

### RV node kinds

Use a recursive tagged union discriminated by `kind`:

- `leaf` - atomic distribution.
- `joint` - independent composition over dimensions: `dims: RV[]`.
- `mixture` - finite weighted combination: `weights: number[]`, `components: RV[]`, aligned by index.
- `transform` - deterministic transformation of a base RV: `base: RV`, `op: {...}`.

Every node MAY carry declared `capabilities` and `metadata`. Leaf nodes MAY also carry `support`.

### Leaf catalog

Use these canonical, library-independent parameter names:

| dist | params | constraints |
|---|---|---|
| `normal` | `mu`, `sigma` | `sigma > 0` |
| `lognormal` | `mu`, `sigma` | `sigma > 0`; `log(X) ~ Normal(mu, sigma)` |
| `weibull` | `shape`, `scale` | both `> 0` |
| `uniform` | `low`, `high` | `high > low` |
| `exponential` | `rate` | `rate > 0` |
| `gamma` | `shape`, `scale` | both `> 0` |
| `beta` | `alpha`, `beta` | both `> 0` |
| `categorical` | `categories[]`, `probs[]` | aligned, `probs >= 0`, sum to 1 |
| `poisson` | `rate` | `rate > 0` |
| `binomial` | `n`, `p` | `n` integer `>= 1`, `0 < p < 1` |
| `empirical` | `samples` (`bulk_ref`) | 1-D numeric array |

`categorical`, `poisson`, and `binomial` are discrete: log probability is a log-mass. The
categorical CDF is defined over numeric categories sorted ascending. For the integer-valued leaves
(`poisson`, `binomial`) a query `x` snaps to `k = round(x)` when `|x - round(x)| <= 1e-9` and has
log probability `-inf` otherwise; CDF evaluates at the floor of the snapped value. `empirical`
uses deterministic KDE for log probability and empirical CDF for CDF.

### Transform catalog

| op.name | meaning | params | invertible | monotone |
|---|---|---|---|---|
| `affine` | `y = a*x + b` | `a != 0`, `b` | yes | yes |
| `exp` | `y = exp(x)` | none | yes | yes |
| `log` | `y = log(x)` | none | yes on `x > 0` | yes |
| `pow` | `y = x^p` | `exponent != 0` | yes on positive branch | yes on positive branch |
| `abs` | `y = abs(x)` | none | no | no |

Each op accepts exactly the params in this table and no others; `exp`, `log`, and `abs` take none.
The schema MUST reject an op carrying an unexpected param key, and a consumer MUST NOT silently ignore
extra op params.

### Operations

Define the semantics of:

- `sample(n, seed)`
- `log_prob(x)` in natural log-space
- `cdf(x)`
- analytic `moments` where available

Capabilities are declared as `{ can_sample, can_log_prob, can_cdf }` and MUST be recomputed by
consumers. Declared capabilities that disagree with recomputed capabilities are invalid.

### Normative algorithms

Include formulas in both `SPEC.md` and `rv.schema.json` under `x-rvx-semantics`:

- Closed-form log-pdf/log-pmf and CDF for all leaf distributions.
- Joint: log probability is the sum of child log probabilities; CDF is product of child CDFs.
- Mixture: use stable logsumexp of `log(weight_i) + log_prob_i(x)`; sample by component weights.
- Transform: use change of variables
  `log p_Y(y) = log p_X(g^-1(y)) + log |d g^-1 / dy|`. This applies to densities only, so a
  transform whose base subtree contains a discrete leaf is invalid and MUST be rejected during
  semantic validation.
- Poisson: `log p(k) = k*log(rate) - rate - lgamma(k+1)`; CDF via the regularized lower incomplete
  gamma, `1 - P(floor(x)+1, rate)`.
- Binomial: `log p(k) = lgamma(n+1) - lgamma(k+1) - lgamma(n-k+1) + k*log(p) + (n-k)*log(1-p)`;
  CDF via the regularized incomplete beta, `I_(1-p)(n-k, k+1)` with `k = floor(x)`.
- Empirical: Gaussian KDE with Scott bandwidth `h = n^(-1/5) * sample_stddev`, empirical CDF, bootstrap
  or quantile sampling.

### Bulk transport

Define `bulk_ref` for empirical samples. Inline base64 little-endian raw buffers are mandatory.
External `.npy` sidecars are optional; unsupported readers must reject them explicitly. A decoded
`bulk_ref` must be self-consistent: the decoded byte length must be a whole multiple of the `dtype`
item size and the decoded element count must equal the product of the declared `shape`; a reader must
reject a mismatch rather than truncate or misread.

### Validation

Specify two stages:

1. JSON Schema structural validation.
2. Semantic validation: parameter constraints, mixture/categorical weights and alignment, support
   consistency, rejection of transforms over discrete bases, capability recomputation, and format
   major version check.

### Canonical form

Canonical writers sort object keys lexicographically, preserve array order, use UTF-8/newline text,
emit shortest round-trippable numbers, and make `read -> write -> read -> write` byte-stable.

## `rv.schema.json` requirements

The schema MUST:

- Use `$defs` and `oneOf` over the four RV kinds.
- Use `if`/`then` or equivalent conditional schemas per distribution and transform op.
- Use `additionalProperties: false` wherever the structure is fixed.
- Include `x-rvx-semantics` as a JSON object with enough machine-readable information for Prompt #2:
  operation names, formulas/algorithm descriptions, capability rules, validation rules, canonical
  serialization rules, tolerances, and versioning rules.

## Output format

Emit exactly two files and nothing else:

```text
<<<FILE: SPEC.md>>>
...markdown spec...
<<<END FILE>>>
<<<FILE: rv.schema.json>>>
...raw JSON...
<<<END FILE>>>
```
