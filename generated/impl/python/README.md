# rvx - Python reference implementation

The scientific producer of the RV Exchange Format v1. Parses/validates `*.rv.json`, evaluates
`log_prob` / `cdf`, draws samples, computes moments, and generates the conformance golden values.
Leaf distributions delegate to `scipy.stats`, the trusted scientific reference.

## Architecture (load-bearing patterns only)

| Module | Responsibility | Pattern |
|--------|----------------|---------|
| `model.py` | RV ADT as a tree: `Leaf · Joint · Mixture · Transform`; `Capabilities` | Composite |
| `operations.py` | `sample` / `log_prob` / `cdf` / `moments` / capabilities, each a visitor | Visitor |
| `distributions.py` | leaf catalog keyed by name; scipy adapters + categorical/empirical | Registry + Adapter |
| `ops.py` | transform ops (`affine/exp/log/pow/abs`) with inverse + Jacobian | Strategy + Registry |
| `numerics.py` | `log_sum_exp`, Vose alias sampler | - |
| `bulk.py` | empirical bulk arrays (npy sidecar / inline base64) | - |
| `parse.py` | document ⇄ model, semantic validation, capability re-check | - |

Adding a distribution = one `@register` (Open/Closed). Adding an operation = one new visitor;
neither touches the model.

## Use

```python
import json, numpy as np, rvx

doc  = json.load(open("conformance/cases/mixture_bimodal.rv.json"))
node = rvx.parse_document(doc)          # parses + validates (incl. capability re-check)

rvx.capabilities(node)                  # -> Capabilities(can_sample, can_log_prob, can_cdf)
rvx.log_prob(node, 3.0)                  # natural-log density (log-sum-exp for mixtures)
rvx.cdf(node, 3.0)                       # scalar or vectorized over a numpy array
rvx.sample(node, np.random.default_rng(0), 10_000)
rvx.moments(node)                        # (mean, variance) where closed-form is known
```

Non-invertible transforms degrade capabilities honestly: `rvx.log_prob` on `abs(X)` raises
`CapabilityError`, and `rvx.capabilities` reports `can_log_prob=False`.

## Tests

```bash
PYTHONPATH=src python3 -m pytest          # from generated/impl/python/
```

- `tests/test_conformance.py` - runs the full language-neutral suite in `conformance/`. Deterministic
  outputs match golden within `1e-9`; sampling is checked statistically (KS vs the case's own CDF +
  moment tolerances).
- `tests/test_properties.py` - Hypothesis: serialize→parse round-trip identity, sample↔CDF agreement
  (KS), and validation rejections (bad weights, declared-capability mismatch).

## Generating the conformance golden

```bash
PYTHONPATH=generated/impl/python/src python3 conformance/generate.py
```

The generator is a thin client: case *structure* is declared as data and all golden numbers come
from `rvx`. Because leaves delegate to scipy and composite values are independently re-derivable, the
suite stays a real correctness oracle while keeping the distribution math in exactly one place.
