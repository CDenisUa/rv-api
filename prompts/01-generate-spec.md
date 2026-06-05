# Prompt #1 - Generate the RV Exchange Format specification

> **Role of this file.** This is the *first* prompt of the pipeline. You feed it to an LLM and it
> returns **two artifacts in one pass**: a human-readable specification document and a
> machine-readable specification file. Nothing here is implementation code - this prompt produces the
> *contract*, not the readers/writers (those come from Prompt #2).
>
> The prompt is intentionally a **requirements brief**: it states the domain decisions a person has
> already made (which distributions, which parameterization, which numerical rules) and asks the model
> to do the *formalization* work - a complete JSON Schema with conditional subschemas, RFC-2119
> normative prose, worked examples, capability-propagation rules, and complexity notes.

---

## System / role

You are a specification author for scientific data interchange. You write formats that are
**semantic, declarative, language-neutral, and portable**: the document describes the mathematical
object, never a particular library's class. You produce precise, testable specifications with no
ambiguity an implementer could resolve two different ways.

## Task

Design **version 1** of the **RV Exchange Format**: a portable serialization of a single **random
variable (RV)** - discrete or continuous - *as a whole*, so that one system can write it and another,
possibly in a different programming language, can reconstruct it and operate on it.

Return exactly two artifacts, clearly delimited:

1. **`SPEC.md`** - the authoritative human-readable specification. Use the RFC-2119 key words (MUST,
   MUST NOT, SHOULD, MAY). It MUST be self-contained enough that an implementer who has never seen the
   format can write a correct reader/writer from it.
2. **`rv.schema.json`** - the machine-readable contract: a **JSON Schema, draft 2020-12**. It MUST be
   strict (`additionalProperties: false` everywhere it makes sense) and encode every structural rule
   it can. Semantic rules JSON Schema cannot express (weight sums, capability propagation, support
   consistency) MUST be described in `SPEC.md` and flagged there as enforced by implementations, not
   by the schema.

The two MUST agree. Where they overlap they are normative together.

## Required design decisions (do not deviate)

These are fixed requirements - formalize them, do not redesign them.

### Document envelope
A document is a JSON object with:
- `format_version` - a semantic version string `MAJOR.MINOR.PATCH` (start at `1.0.0`).
- `metadata` - optional, free-form, non-semantic (name, units, provenance, comments). Ignored by all
  operations.
- `rv` - the single root RV node.

### The RV node - a recursive tagged union
Discriminated by a `kind` field over exactly four kinds. Composite kinds hold child RV nodes, so a
document is a tree:

- `leaf` - an atomic distribution.
- `joint` - a vector of **mutually independent** dimensions (`dims: RV[]`). Joint density is the
  **product** of dimension densities; therefore `log_prob` is the **sum** of children's `log_prob`.
  v1 models independence only - copulas and general conditionals are out of scope.
- `mixture` - a finite weighted combination: `weights: number[]`, `components: RV[]`, positionally
  aligned. Each `weight >= 0` and `sum(weights) == 1` within tolerance `1e-9`. A sample comes from
  component `i` with probability `weights[i]`.
- `transform` - a deterministic `Y = op(X)` of a base RV `X` (`base: RV`, `op: {...}`), applied
  elementwise.

Every node MAY carry declared `capabilities` and free-form `metadata`. Leaf nodes MAY also carry
`support`.

### Leaf distribution catalog (canonical, library-independent parameter names)

| `dist`        | params (canonical)        | constraints                       | natural support |
|---------------|---------------------------|-----------------------------------|-----------------|
| `normal`      | `mu`, `sigma`             | `sigma > 0`                       | (-inf, +inf)    |
| `lognormal`   | `mu`, `sigma`             | `sigma > 0`                       | (0, +inf)       |
| `weibull`     | `shape`, `scale`          | `shape > 0`, `scale > 0`          | [0, +inf)       |
| `uniform`     | `low`, `high`             | `high > low`                      | [low, high]     |
| `exponential` | `rate`                    | `rate > 0`                        | [0, +inf)       |
| `gamma`       | `shape`, `scale`          | `shape > 0`, `scale > 0`          | (0, +inf)       |
| `beta`        | `alpha`, `beta`           | `alpha > 0`, `beta > 0`           | [0, 1]          |
| `categorical` | `categories[]`, `probs[]` | aligned; `probs >= 0`, `sum == 1` | the categories  |
| `empirical`   | `samples` (bulk_ref)      | 1-D numeric array                 | data range      |

- `lognormal` is parameterized by the **mean and std-dev of the underlying normal in log-space**:
  `log(X) ~ Normal(mu, sigma)`. State explicitly that this differs from scipy's `(s, loc, scale)` and
  that an adapter maps `s = sigma`, `scale = exp(mu)`, `loc = 0`. Include a short informative
  scipy.stats mapping table for the analytic leaves.
- `categorical` is the only discrete analytic leaf; its `categories` are numeric and `cdf` is defined
  over them in ascending order.

### Transform op catalog

| `op.name` | meaning       | params           | invertible?                   | effect on `log_prob`             |
|-----------|---------------|------------------|-------------------------------|----------------------------------|
| `affine`  | `y = a*x + b` | `a` (!= 0), `b`  | yes                           | change-of-variables, `-log|a|`   |
| `exp`     | `y = e^x`     | -                | yes                           | `x = log y`, add `-log y`        |
| `log`     | `y = ln x`    | -                | yes (x > 0)                   | `x = e^y`, add `y`               |
| `pow`     | `y = x^p`     | `exponent` (!=0) | yes on a monotone branch (x>0)| change-of-variables (see below)  |
| `abs`     | `y = |x|`     | -                | **no**                        | **drops `can_log_prob`**         |

Include `abs` deliberately as the non-invertible op that demonstrates honest capability degradation.

### Operations and capabilities
- Three operations: `sample`, `log_prob`, `cdf`. `log_prob` is the natural log of density (continuous)
  or mass (discrete); **mandate log-space** for numerical stability. `cdf` is `P(X <= x)`.
- `capabilities = { can_sample, can_log_prob, can_cdf }` are **declared in the document AND
  revalidated by the consumer**. Specify the canonical recomputation rules and that they propagate
  **bottom-up**; a parent's declared capabilities MUST equal the values computed from its children:
  - Leaf analytic and `categorical`: all three `true`. `empirical`: `can_sample`, `can_log_prob` (via
    KDE), `can_cdf` (empirical CDF) all `true`.
  - Joint: each capability is the **AND** over `dims`.
  - Mixture: each capability is the **AND** over `components`.
  - Transform: `can_sample = base.can_sample`. `can_log_prob = base.can_log_prob AND op is invertible
    & differentiable`. `can_cdf = base.can_cdf AND op is monotonic`.

### Normative algorithms (give the formulas)
- Leaf: standard closed-form log-pdf / log-pmf and cdf for each `dist`.
- Joint: `log p(x) = sum_i log p_i(x_i)`; sample each dim independently.
- Mixture: `log p(x) = logsumexp_i( log(weights[i]) + log p_i(x) )`; give the stable `logsumexp`
  formula. Recommend the **alias method** for O(1) component selection when sampling.
- Transform: change-of-variables `log p_Y(y) = log p_X(g^-1(y)) + log|d g^-1/dy|`; provide the
  `g^-1` and `log|d g^-1/dy|` for every op in the table above (including the `pow` monotone-branch
  form). Sampling always works: draw `x` from base, return `g(x)`.
- Empirical: `log_prob` via **Gaussian kernel density estimation** with **Scott's-rule** bandwidth
  `h = n^(-1/(d+4)) * sigma_hat` (with `d = 1`), so it is deterministic and reproducible. Sampling
  uses inverse-CDF / bootstrap on the empirical quantiles.

### Empirical bulk transport (`bulk_ref`)
A `bulk_ref` carries a 1-D numeric array and MUST have `format`, `dtype` (`float32|float64|int32|
int64`), and `shape` (1-element array). Two transports:
- **inline `base64`** of a little-endian raw buffer (field `data`) - the **mandatory baseline** every
  consumer MUST decode;
- external **`.npy` sidecar** referenced by `path` - **optional**; a consumer that does not support it
  MUST reject an `npy` bulk_ref with an explicit error rather than misread it.

### Support and validation
- A leaf MAY declare `support = { lower?, upper?, lower_inclusive?, upper_inclusive? }`; omitted bounds
  mean +/-infinity. Declared support MUST be consistent with the distribution's natural support and
  MUST NOT extend beyond it; it does not truncate or redefine the distribution.
- Specify a **two-stage validation pipeline**: (1) JSON Schema validation; (2) semantic validation -
  weight/alignment sums, parameter constraints, support consistency, and **capability re-computation**
  (reject on any mismatch with declared `capabilities`). A document passing stage 1 but failing stage
  2 is invalid.

### Versioning
- `MAJOR.MINOR.PATCH`: PATCH = editorial, MINOR = backward-compatible additions (new `dist`/`op`;
  older consumers MAY reject unknown names but MUST do so explicitly), MAJOR = breaking. A consumer
  MUST reject a document whose **MAJOR exceeds** the version it implements.

### Canonical form and reproducibility
- Object keys sorted lexicographically; UTF-8; `\n` newlines; no trailing whitespace; numbers in
  shortest round-trippable form; arrays preserve positional alignment. Sum-to-one numeric tolerance is
  **`1e-9` absolute**. Deterministic outputs (`log_prob`, `cdf`, analytic moments) are exact math;
  sampling is checked statistically with fixed RNG seeds. The canonical form is what golden-value
  comparisons and content hashes are computed against.

### Scope (v1)
- **In:** analytic distributions, empirical/sample-based, independent joints, finite mixtures,
  deterministic transforms.
- **Out:** general conditional distributions, arbitrary probabilistic programs, copulas, executable
  custom code, inference state / posterior traces.

## Structure to follow in `SPEC.md`
Design principles; document structure; operations; the four kinds; the catalog (leaf params + scipy
mapping + transform ops); support & validation; capabilities; normative algorithms (with a Big-O
table per kind); versioning; canonical form; scope; and an appendix of 3 worked JSON examples
(a Weibull materials example, a bimodal lognormal mixture, and `exp(Normal)`).

## Acceptance criteria
- `rv.schema.json` is valid draft-2020-12, uses `$defs` + `oneOf` over the four kinds, conditional
  `if/then` per-`dist` and per-`op` parameter subschemas, and `additionalProperties: false`
  throughout.
- Every worked example in `SPEC.md` validates against `rv.schema.json`.
- The spec is complete enough that a **short** follow-up prompt plus `rv.schema.json` alone is
  sufficient to generate a correct reader/writer (that is Prompt #2's job).

## Output format (strict)

Emit **exactly two files**, each wrapped in explicit file markers - do **not** wrap the file bodies in
markdown code fences (the SPEC.md body itself contains fenced examples, so an outer fence would be
ambiguous). Output `SPEC.md` first, then `rv.schema.json`, and nothing else outside the markers:

```
<<<FILE: SPEC.md>>>
# RV Exchange Format - Specification v1
...full markdown document, including its own ```json examples...
<<<END FILE>>>
<<<FILE: rv.schema.json>>>
{ ...the full JSON Schema, raw JSON, no surrounding fence... }
<<<END FILE>>>
```
