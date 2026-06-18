# RV Exchange Format - Specification v1

A portable, language-neutral format for serializing a **random variable** (RV) as a whole, so that
one system can serialize it and another (possibly in a different language) can reconstruct it and
operate on it. The format describes the **semantics** of an RV - what it *means* - not a
library-specific class instance.

- Machine-readable contract: [`rv.schema.json`](./rv.schema.json) (JSON Schema, draft 2020-12, plus
  the `x-rvx-semantics` extension used as the Prompt #2 hand-off contract).
- This document is the authoritative human-readable companion. Where prose and schema agree they are
  normative together; semantic rules that JSON Schema cannot express (weight sums, capability
  propagation, support checks) are defined here and MUST be enforced by every implementation.

The key words MUST, MUST NOT, SHOULD, MAY are used in the RFC 2119 sense.

---

## 1. Design principles

1. **Semantic, not implementation-specific.** The format describes the mathematical object, not how
   any library represents it.
2. **Declarative.** An RV is fully described by its fields. No embedded executable code is needed to
   interpret it.
3. **Portable.** The same `*.rv.json` document MUST reconstruct to the same RV in any conforming
   implementation, regardless of language.
4. **Explicit capabilities.** The document states which operations are valid (`sample`, `log_prob`,
   `cdf`). Capabilities are declared *and* revalidated by the consumer.

---

## 2. Document structure

A document is a JSON object:

```json
{
  "format_version": "1.0.0",
  "metadata": { "name": "optional, non-semantic annotations" },
  "rv": { "...": "the root RV node" }
}
```

- `format_version` - semantic version (`MAJOR.MINOR.PATCH`) of this format. See §9.
- `metadata` - optional, ignored by operations (free-form: name, units, provenance, comments).
- `rv` - the single root RV node.

An **RV node** is a recursive tagged union discriminated by `kind`:

```
RV = Leaf | Joint | Mixture | Transform
```

`Joint`, `Mixture`, and `Transform` contain child RV nodes, so a document is a **tree**.

Every node MAY carry:
- `capabilities` - declared `{ can_sample, can_log_prob, can_cdf }` (see §7).
- `metadata` - free-form annotations.

Leaf nodes additionally MAY carry `support` (see §6.1).

---

## 3. Operations (semantics of capabilities)

The format is designed around three operations. An implementation need not provide all three, but the
declared capabilities MUST truthfully reflect which are mathematically valid for the node.

| Operation  | Meaning |
|------------|---------|
| `sample`   | Draw a value distributed according to the RV. |
| `log_prob` | Evaluate the natural log of the density (continuous) or mass (discrete) at a point. Log-space is mandated for numerical stability. |
| `cdf`      | Evaluate the cumulative probability `P(X ≤ x)`. |

---

## 4. Kinds

### 4.1 Leaf - atomic distribution

```json
{ "kind": "leaf", "dist": "normal", "params": { "mu": 0, "sigma": 1 } }
```

- `dist` - one of the catalog names in §5.
- `params` - parameters using the **canonical names** in §5 (library-independent; adapters map to/from
  scipy etc.).
- `support` - optional; if omitted, the natural support of `dist` is assumed (§6.1).

### 4.2 Joint - independent composition

```json
{ "kind": "joint", "dims": [ { "...RV": "" }, { "...RV": "" } ] }
```

Represents a vector of **mutually independent** dimensions. The joint density is the **product** of
the dimensions' densities, hence `log_prob` is the **sum** of the children's `log_prob` (§8).

> v1 models independence only. Dependence (copulas, general conditionals) is explicitly out of scope.

### 4.3 Mixture - weighted combination

```json
{ "kind": "mixture", "weights": [0.7, 0.3], "components": [ {"...RV":""}, {"...RV":""} ] }
```

A sample comes from component `i` with probability `weights[i]`.

Semantic rules (enforced beyond JSON Schema):
- `weights.length === components.length`.
- every `weight ≥ 0` and `Σ weights == 1` within tolerance `1e-9` (§10).

A mixture MAY combine discrete and continuous components; it is then a mixed measure and its
`log_prob` mixes masses with densities. Producers SHOULD avoid such mixtures unless the consumer is
known to interpret them deliberately.

### 4.4 Transform - deterministic transformation

```json
{ "kind": "transform", "base": { "...RV": "" }, "op": { "name": "exp" } }
```

Represents `Y = op(X)` where `X` is `base`. The op is applied elementwise. See §5.3 for the op
catalog and §8 for how each op affects `log_prob` (change-of-variables) and capabilities.

The base of a transform MUST be **continuous**: a transform whose base subtree contains a discrete
leaf (`categorical`, `poisson`, `binomial`) is invalid in v1, because the change-of-variables
formula (§8.4) applies to densities, not probability masses. Validators MUST reject such documents.

---

## 5. Catalog

### 5.1 Leaf distributions and canonical parameters

| `dist`        | Params (canonical)              | Constraints                  | Natural support |
|---------------|---------------------------------|------------------------------|-----------------|
| `normal`      | `mu`, `sigma`                   | `sigma > 0`                  | (−∞, +∞)        |
| `lognormal`   | `mu`, `sigma`                   | `sigma > 0`                  | (0, +∞)         |
| `weibull`     | `shape`, `scale`                | `shape > 0`, `scale > 0`     | [0, +∞)         |
| `uniform`     | `low`, `high`                   | `high > low`                 | [low, high]     |
| `exponential` | `rate`                          | `rate > 0`                   | [0, +∞)         |
| `gamma`       | `shape`, `scale`                | `shape > 0`, `scale > 0`     | (0, +∞)         |
| `beta`        | `alpha`, `beta`                 | `alpha > 0`, `beta > 0`      | [0, 1]          |
| `categorical` | `categories[]`, `probs[]`       | aligned; `probs ≥ 0`, Σ = 1  | the categories  |
| `poisson`     | `rate`                          | `rate > 0`                   | {0, 1, 2, …}    |
| `binomial`    | `n`, `p`                        | `n` integer ≥ 1, `0 < p < 1` | {0, 1, …, n}    |
| `empirical`   | `samples` (bulk_ref)            | 1-D numeric array            | data range      |

`categorical`, `poisson`, and `binomial` are **discrete**: `log_prob` is a log-**mass**, not a
log-density. For the integer-valued leaves (`poisson`, `binomial`) a query `x` is treated as the
integer `k = round(x)` when `|x − round(x)| ≤ 1e-9`; any other non-integer `x` has `log_prob = −∞`.
`cdf` evaluates at the floor of the snapped value.

`lognormal` is parameterized by the **mean and std-dev of the underlying normal in log-space**
(`mu`, `sigma`), i.e. `log(X) ~ Normal(mu, sigma)`. This intentionally differs from scipy's
`(s, loc, scale)`; the Python adapter MUST map `s = sigma`, `scale = exp(mu)`, `loc = 0`.

### 5.2 Parameter mapping to scipy.stats (informative)

| `dist`        | RV canonical            | scipy.stats call                                   |
|---------------|-------------------------|----------------------------------------------------|
| `normal`      | `mu`, `sigma`           | `norm(loc=mu, scale=sigma)`                         |
| `lognormal`   | `mu`, `sigma`           | `lognorm(s=sigma, scale=exp(mu))`                   |
| `weibull`     | `shape`, `scale`        | `weibull_min(c=shape, scale=scale)`                |
| `uniform`     | `low`, `high`           | `uniform(loc=low, scale=high-low)`                 |
| `exponential` | `rate`                  | `expon(scale=1/rate)`                              |
| `gamma`       | `shape`, `scale`        | `gamma(a=shape, scale=scale)`                      |
| `beta`        | `alpha`, `beta`         | `beta(a=alpha, b=beta)`                            |
| `poisson`     | `rate`                  | `poisson(mu=rate)`                                 |
| `binomial`    | `n`, `p`                | `binom(n=n, p=p)`                                  |

### 5.3 Transform ops

| `op.name` | Meaning           | Params              | Invertible? | Effect on `log_prob`            |
|-----------|-------------------|---------------------|-------------|----------------------------------|
| `affine`  | `y = a·x + b`     | `a` (≠0), `b`       | yes         | change-of-variables, `−log|a|`   |
| `exp`     | `y = e^x`         | -                   | yes         | `x = log y`, Jacobian `1/y`      |
| `log`     | `y = ln x`        | -                   | yes (x>0)   | `x = e^y`, Jacobian `e^y`        |
| `pow`     | `y = x^p`         | `exponent` (p≠0)    | yes on monotone branch (e.g. x>0) | see §8 |
| `abs`     | `y = |x|`         | -                   | **no**      | drops `can_log_prob`             |

`abs` is deliberately included as a non-invertible op to demonstrate honest capability degradation.

Each op accepts exactly the params in the table above and no others: `exp`, `log`, and `abs` take
**no** params. A consumer MUST reject an op carrying an unexpected param key rather than silently
ignore it; a malformed (or machine-generated) op MUST NOT be misread as a valid one.

---

## 6. Support and validation

### 6.1 Support

A Leaf MAY declare `support = { lower?, upper?, lower_inclusive?, upper_inclusive? }`. Omitted bounds
mean ±∞. If declared, it MUST be consistent with the distribution's natural support (§5.1); declaring
a support that contradicts the distribution is an error. In v1, declared support is allowed to be a
stricter valid evaluation domain (for example a finite plotting or application range), but it MUST
NOT extend outside the distribution's natural support. It does not redefine or truncate the
underlying distribution.

### 6.2 Validation pipeline (two stages)

1. **Schema validation** - the document MUST validate against `rv.schema.json`.
2. **Semantic validation** - additionally enforce, recursively:
   - Mixture/categorical weight & alignment rules (§4.3, §5.1).
   - Parameter constraints (§5.1) - already largely encoded in schema, but re-checked.
   - Support consistency (§6.1).
   - **Continuous transform bases** - a transform whose base subtree contains a discrete leaf is
     rejected (§4.4).
   - **Capability consistency** - recompute capabilities (§7) and reject if they contradict the
     declared `capabilities`.

A document that passes stage 1 but fails stage 2 is **invalid**.

---

## 7. Capabilities

`capabilities = { can_sample, can_log_prob, can_cdf }`. They are **declared** in the document and
**revalidated** by the consumer. The canonical (recomputed) value per kind:

- **Leaf**
  - analytic (`normal`…`beta`): `can_sample = can_log_prob = can_cdf = true`.
  - `categorical`: `can_sample = can_log_prob = can_cdf = true` (cdf over ordered categories).
  - `poisson`, `binomial`: `can_sample = can_log_prob = can_cdf = true` (log-mass + closed-form cdf).
  - `empirical`: `can_sample = true`; `can_log_prob = true` (via KDE, §8.5); `can_cdf = true`
    (empirical CDF).
- **Joint** - each capability is the **AND** over all `dims`. (`can_cdf` is the AND, interpreted
  per-dimension / product form.)
- **Mixture** - `can_sample` = AND over components; `can_log_prob` = AND over components;
  `can_cdf` = AND over components.
- **Transform** - `can_sample` = base.can_sample (always propagates: sample base, apply op).
  `can_log_prob` = base.can_log_prob **AND** `op` is invertible & differentiable (§5.3).
  `can_cdf` = base.can_cdf **AND** `op` is **monotonic** (so order is preserved).

**Propagation is bottom-up.** The declared capabilities of a parent MUST equal the values computed
from its children by these rules.

---

## 8. Algorithms (normative formulas)

All densities are evaluated in **log-space**.

### 8.1 Leaf - closed forms
Standard log-pdf / log-pmf for each `dist` in §5.1. For the integer-valued discrete leaves
(with the integer-snap rule of §5.1 applied first):

- `poisson(rate)`: `log p(k) = k·log(rate) − rate − lgamma(k+1)` for integer `k ≥ 0`, else `−∞`;
  `cdf(x) = 1 − P(⌊x⌋+1, rate)` for `x ≥ 0` (regularized lower incomplete gamma `P`), else `0`.
- `binomial(n, p)`: `log p(k) = lgamma(n+1) − lgamma(k+1) − lgamma(n−k+1) + k·log(p) + (n−k)·log(1−p)`
  for integer `0 ≤ k ≤ n`, else `−∞`; `cdf(x) = I_{1−p}(n−⌊x⌋, ⌊x⌋+1)` for `0 ≤ x < n`
  (regularized incomplete beta `I`), `0` below, `1` at or above `n`.

### 8.2 Joint - independence
`log p(x₁,…,x_d) = Σ_i log p_i(x_i)`. Sampling: sample each dim independently.

### 8.3 Mixture - log-sum-exp
`log p(x) = logsumexp_i ( log(weights[i]) + log p_i(x) )`, where
`logsumexp(a) = m + log Σ exp(aᵢ − m)`, `m = max(a)`. This avoids underflow/overflow.
Sampling: choose component `i` via the **alias method** (O(1) per draw), then sample component `i`.

### 8.4 Transform - change of variables
For an invertible, differentiable `y = g(x)` with inverse `x = g⁻¹(y)`:

`log p_Y(y) = log p_X(g⁻¹(y)) + log |d/dy g⁻¹(y)|`

| op       | `g⁻¹(y)`        | `log|d g⁻¹/dy|`         |
|----------|-----------------|-------------------------|
| `affine` | `(y − b)/a`     | `−log |a|`              |
| `exp`    | `log y`         | `−log y`  (y > 0)       |
| `log`    | `e^y`           | `y`                     |
| `pow`    | `y^(1/p)`       | `log|1/p| + (1/p − 1)·log y` (on the positive/monotone branch) |
| `abs`    | not invertible  | `can_log_prob = false`  |

Sampling always works: draw `x` from base, return `g(x)`.

Change-of-variables is defined for **densities** only; transforms over discrete bases are invalid
(§4.4) and never reach this formula.

### 8.5 Empirical - KDE
`log_prob` for `empirical` leaves uses **Gaussian kernel density estimation** with **Scott's-rule**
bandwidth `h = n^(−1/(d+4))·σ̂` (d = 1 here), `σ̂` the sample std-dev. This makes empirical log-prob
deterministic and reproducible. Sampling uses inverse-CDF on the empirical quantiles (bootstrap).

A `bulk_ref` carries the sample array in one of two transports: **inline `base64`** (a little-endian
raw buffer) or an external **`.npy` sidecar** referenced by `path`. The inline `base64` transport is
the **mandatory baseline** - every conforming consumer MUST decode it. The `.npy` sidecar is
**OPTIONAL**: a consumer MAY support it, and one that does not MUST reject an `npy` `bulk_ref` with an
explicit error rather than misread it. (The Python reference reads both; the TypeScript and Rust
references implement the mandatory `base64` baseline and reject `npy`.)

A decoded `bulk_ref` MUST be self-consistent: the decoded byte length MUST be a whole multiple of the
`dtype` item size, and the number of decoded elements MUST equal the product of the declared `shape`.
A consumer MUST reject a `bulk_ref` that fails either check rather than silently truncate or misread
the buffer.

### 8.6 Complexity (Big-O)

| Kind                | `sample`                                   | `log_prob`                         |
|---------------------|--------------------------------------------|------------------------------------|
| Leaf analytic       | O(1)                                       | O(1)                               |
| Leaf categorical    | O(1) (alias) after O(k) build              | O(k) (tolerance match over k cats) |
| Leaf poisson        | O(rate) expected (exponential arrivals)    | O(1)                               |
| Leaf binomial       | O(n) (Bernoulli sum)                       | O(1)                               |
| Leaf empirical (n)  | O(1) draw (alias) / O(log n) inv-CDF       | O(n) per query (KDE)               |
| Joint (d dims)      | O(d) + children                            | O(d) + children                    |
| Mixture (k comps)   | O(n + k) for n draws (bucket) + children   | O(k) + children (logsumexp)        |
| Transform           | O(child)                                   | O(child) + O(1) Jacobian           |

Categorical `log_prob` matches the query against `k` category values within a numeric tolerance
(§5.1), so it is O(k) rather than O(1) - a hash lookup would require exact float equality and is
therefore not used. Mixture `sample` buckets the `n` component assignments in a single pass before
sampling each child once, so drawing `n` values is O(n + k) (plus child cost), not O(n·k).

---

## 9. Versioning

- `format_version` is `MAJOR.MINOR.PATCH`.
- **PATCH** - editorial/clarification, no structural change.
- **MINOR** - backward-compatible additions (e.g. a new `dist` or `op`). Older consumers MAY reject
  unknown names but MUST do so explicitly (no silent misinterpretation).
- **MAJOR** - breaking change.
- A consumer MUST reject a document whose MAJOR exceeds the version it implements.

History: **1.1.0** adds the discrete leaves `poisson` and `binomial` and the continuous-base rule
for transforms (§4.4) - a MINOR, backward-compatible addition; documents written as `1.0.0` remain
valid.

---

## 10. Canonical form & reproducibility

For byte-reproducible round-trips and hashing:

- **Object keys sorted** lexicographically.
- **UTF-8**, `\n` line endings, no trailing whitespace; numbers in shortest round-trippable form.
- Arrays preserve order (positional alignment of `weights`/`components`, `categories`/`probs`).
- Numeric tolerance for sum-to-one checks: **`1e-9`** absolute.
- Reproducible sampling in the conformance suite is achieved with **fixed RNG seeds**.

The canonical form is what conformance golden-value comparisons and content hashes are computed
against.

---

## 11. Scope (v1)

**In:** analytic distributions, empirical / sample-based distributions, independent joint
distributions, finite mixtures, deterministic transforms.

**Out:** general conditional distributions, arbitrary probabilistic programs, copulas, executable
custom code, inference state / posterior traces.

---

## Appendix A - Worked examples

### A.1 Weibull fracture strength (materials)

```json
{
  "format_version": "1.0.0",
  "metadata": { "name": "ceramic_strength_MPa" },
  "rv": {
    "kind": "leaf",
    "dist": "weibull",
    "params": { "shape": 10.0, "scale": 350.0 },
    "capabilities": { "can_sample": true, "can_log_prob": true, "can_cdf": true }
  }
}
```

### A.2 Bimodal microstructure (mixture of two grain populations)

```json
{
  "format_version": "1.0.0",
  "metadata": { "name": "grain_size_um_bimodal" },
  "rv": {
    "kind": "mixture",
    "weights": [0.7, 0.3],
    "components": [
      { "kind": "leaf", "dist": "lognormal", "params": { "mu": 1.0, "sigma": 0.3 } },
      { "kind": "leaf", "dist": "lognormal", "params": { "mu": 2.5, "sigma": 0.4 } }
    ],
    "capabilities": { "can_sample": true, "can_log_prob": true, "can_cdf": true }
  }
}
```

### A.3 Log-transform of a normal (yields a lognormal-equivalent)

```json
{
  "format_version": "1.0.0",
  "rv": {
    "kind": "transform",
    "op": { "name": "exp" },
    "base": { "kind": "leaf", "dist": "normal", "params": { "mu": 0.0, "sigma": 1.0 } },
    "capabilities": { "can_sample": true, "can_log_prob": true, "can_cdf": true }
  }
}
```
