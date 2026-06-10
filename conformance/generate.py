#!/usr/bin/env python3
"""
Conformance suite generator for the RV Exchange Format v1.

Thin client over the Python reference implementation (`rvx`). Case *structure* is declared here as
data; all golden values (capabilities, log_prob, cdf, moments) are computed by `rvx` - the scientific
producer whose leaf distributions delegate to scipy.stats. There is no distribution math in this
file (it lives only in the implementation), so the three concerns stay DRY:

    case definitions (here)  ->  rvx (the math)  ->  golden files (frozen outputs)

TypeScript and Rust implementations are then pinned to these same golden numbers.

Run:  PYTHONPATH=generated/impl/python/src python3 conformance/generate.py
"""

# Core
import base64
import json
import os
import sys

import numpy as np

# Make the reference implementation importable without installing it.
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "generated", "impl", "python", "src"))
import rvx                                            # noqa: E402
from rvx.bulk import encode_base64                    # noqa: E402
from rvx.errors import MomentsNotAvailable            # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
CASES_DIR = os.path.join(HERE, "cases")
GOLDEN_DIR = os.path.join(HERE, "golden")
VERSION = "1.1.0"
# Spec 1.1.0 is a MINOR (backward-compatible) revision; this case stays at 1.0.0 to prove that
# documents written against the previous spec remain valid (SPEC.md §9).
VERSION_OVERRIDES = {"normal_standard": "1.0.0"}

SAMPLING = {"seed": 12345, "n": 200000, "ks_stat_max": 0.02, "mean_atol": 0.05, "var_rtol": 0.05}
SAMPLING_EMPIRICAL = {"seed": 12345, "n": 200000, "ks_stat_max": 0.05, "mean_atol": 0.1, "var_rtol": 0.1}
SAMPLING_NO_KS = {"seed": 12345, "n": 200000, "ks_stat_max": None, "mean_atol": 0.05, "var_rtol": 0.05}
# Discrete leaves: the KS test is a continuous-CDF test, so it is skipped (like categorical).
SAMPLING_DISCRETE = SAMPLING_NO_KS

# A sampling check must pass for *any* conforming RNG stream, not just numpy's. The sample mean has
# standard error sqrt(Var/n); an absolute tolerance below that is only satisfiable by luck (e.g.
# Weibull scale=350 has SEM ~0.09, larger than 0.05). So the per-case mean tolerance is widened to a
# fixed multiple of the distribution's own SEM - a true 6-sigma band - keeping it language-neutral.
SEM_SIGMAS = 6.0


def leaf(dist, params):
    return {"kind": "leaf", "dist": dist, "params": params}


def affine(a, b, base):
    return {"kind": "transform", "op": {"name": "affine", "params": {"a": a, "b": b}}, "base": base}


def transform(op, base):
    return {"kind": "transform", "op": {"name": op}, "base": base}


# Empirical samples: reproducible bytes from a fixed seed (so golden is stable across runs).
_emp = np.random.default_rng(7).standard_normal(2000)

CASES = [
    ("normal_standard", "Standard normal N(mu=0, sigma=1).",
     leaf("normal", {"mu": 0.0, "sigma": 1.0}), [-2.0, -1.0, 0.0, 1.0, 2.0], SAMPLING),
    ("normal_shifted", "Shifted/scaled normal N(mu=2, sigma=3).",
     leaf("normal", {"mu": 2.0, "sigma": 3.0}), [-4.0, -1.0, 2.0, 5.0, 8.0], SAMPLING),
    ("lognormal_basic", "Lognormal with underlying normal N(0,1): log(X)~N(0,1).",
     leaf("lognormal", {"mu": 0.0, "sigma": 1.0}), [0.25, 0.5, 1.0, 2.0, 4.0], SAMPLING),
    ("weibull_strength", "Weibull fracture strength, shape=10, scale=350 MPa (materials example).",
     leaf("weibull", {"shape": 10.0, "scale": 350.0}), [200.0, 300.0, 350.0, 380.0, 420.0], SAMPLING),
    ("uniform_unit", "Uniform on [0, 1].",
     leaf("uniform", {"low": 0.0, "high": 1.0}), [0.0, 0.25, 0.5, 0.75, 1.0], SAMPLING),
    ("uniform_range", "Uniform on [-2, 5].",
     leaf("uniform", {"low": -2.0, "high": 5.0}), [-2.0, 0.0, 1.5, 3.0, 5.0], SAMPLING),
    ("exponential_basic", "Exponential with rate=1.5.",
     leaf("exponential", {"rate": 1.5}), [0.1, 0.5, 1.0, 2.0, 4.0], SAMPLING),
    ("gamma_basic", "Gamma with shape=2, scale=2.",
     leaf("gamma", {"shape": 2.0, "scale": 2.0}), [0.5, 1.0, 2.0, 4.0, 8.0], SAMPLING),
    ("beta_basic", "Beta with alpha=2, beta=5.",
     leaf("beta", {"alpha": 2.0, "beta": 5.0}), [0.05, 0.2, 0.4, 0.6, 0.9], SAMPLING),
    ("categorical_die", "Fair six-sided die: categories 1..6, equal probabilities.",
     leaf("categorical", {"categories": [1.0, 2.0, 3.0, 4.0, 5.0, 6.0], "probs": [1.0 / 6.0] * 6}),
     [1.0, 2.0, 3.0, 4.0, 5.0, 6.0], SAMPLING),
    ("empirical_samples", "Empirical leaf: 2000 inline samples from N(0,1); log_prob via Gaussian KDE (Scott).",
     leaf("empirical", {"samples": encode_base64(_emp)}), [-2.0, -1.0, 0.0, 1.0, 2.0], SAMPLING_EMPIRICAL),
    ("poisson_defects", "Poisson defect count per specimen, rate=3.5 (discrete, materials QC example).",
     leaf("poisson", {"rate": 3.5}), [0.0, 1.0, 2.0, 4.0, 7.0], SAMPLING_DISCRETE),
    ("binomial_qc", "Binomial: failures among n=20 quality-control trials at p=0.15 (discrete).",
     leaf("binomial", {"n": 20, "p": 0.15}), [0.0, 1.0, 3.0, 5.0, 10.0], SAMPLING_DISCRETE),
    ("joint_normal_uniform", "Independent joint of N(0,1) and Uniform(0,1).",
     {"kind": "joint", "dims": [leaf("normal", {"mu": 0.0, "sigma": 1.0}),
                                leaf("uniform", {"low": 0.0, "high": 1.0})]},
     [[-1.0, 0.25], [0.0, 0.5], [1.0, 0.75]], SAMPLING),
    ("mixture_bimodal", "Bimodal microstructure: 0.7*Lognormal(1,0.3) + 0.3*Lognormal(2.5,0.4).",
     {"kind": "mixture", "weights": [0.7, 0.3],
      "components": [leaf("lognormal", {"mu": 1.0, "sigma": 0.3}),
                     leaf("lognormal", {"mu": 2.5, "sigma": 0.4})]},
     [1.0, 3.0, 6.0, 12.0, 20.0], SAMPLING),
    ("transform_exp_normal", "Y = exp(X), X~N(0,1). Invertible; equals Lognormal(0,1).",
     transform("exp", leaf("normal", {"mu": 0.0, "sigma": 1.0})), [0.25, 0.5, 1.0, 2.0, 4.0], SAMPLING),
    ("transform_affine_normal", "Y = 2X + 1, X~N(0,1). Invertible; equals N(1,2).",
     affine(2.0, 1.0, leaf("normal", {"mu": 0.0, "sigma": 1.0})), [-3.0, -1.0, 1.0, 3.0, 5.0], SAMPLING),
    ("transform_abs_normal", "Y = |X|, X~N(0,1). Non-invertible: log_prob and cdf unavailable.",
     transform("abs", leaf("normal", {"mu": 0.0, "sigma": 1.0})), [], SAMPLING_NO_KS),
    ("transform_log_lognormal", "Y = log(X), X~Lognormal(0,1). Invertible; equals N(0,1).",
     transform("log", leaf("lognormal", {"mu": 0.0, "sigma": 1.0})), [-2.0, -1.0, 0.0, 1.0, 2.0], SAMPLING),
    ("transform_pow_lognormal", "Y = X^2, X~Lognormal(0,1). Invertible monotone on positive support.",
     {"kind": "transform", "op": {"name": "pow", "params": {"exponent": 2.0}},
      "base": leaf("lognormal", {"mu": 0.0, "sigma": 1.0})}, [0.25, 0.5, 1.0, 2.0, 4.0], SAMPLING),
    ("nested_mixture_transform",
     "Depth-2 nesting: 0.6*N(0,1) + 0.4*exp(N(0,1)). Exercises recursion through mixture and transform.",
     {"kind": "mixture", "weights": [0.6, 0.4],
      "components": [leaf("normal", {"mu": 0.0, "sigma": 1.0}),
                     transform("exp", leaf("normal", {"mu": 0.0, "sigma": 1.0}))]},
     [-1.0, 0.5, 1.0, 2.0, 4.0], SAMPLING),
]


def build(name, rv_struct, points, sampling):
    version = VERSION_OVERRIDES.get(name, VERSION)
    node = rvx.parse_document({"format_version": version, "rv": rv_struct})
    caps = rvx.capabilities(node)
    rv_struct["capabilities"] = caps.as_dict()  # declared == recomputed

    golden = {"case": name, "format_version": version, "kind": rv_struct["kind"],
              "capabilities": caps.as_dict(),
              "log_prob": None, "cdf": None, "moments": None, "sampling": dict(sampling)}
    if caps.can_log_prob and points:
        golden["log_prob"] = [{"x": x, "value": float(rvx.log_prob(node, x))} for x in points]
    if caps.can_cdf and points:
        golden["cdf"] = [{"x": x, "value": float(rvx.cdf(node, x))} for x in points]
    try:
        m, v = rvx.moments(node)
        golden["moments"] = {"mean": _num(m), "variance": _num(v)}
        golden["sampling"]["mean_atol"] = _mean_atol(sampling["mean_atol"], v, sampling["n"])
    except MomentsNotAvailable:
        # No closed-form variance to size the band; widen via a Monte-Carlo variance estimate so the
        # check is still robust across RNG streams (transform/exp etc.).
        xs = rvx.sample(node, np.random.default_rng(sampling["seed"]), sampling["n"])
        if np.ndim(xs) == 1:
            golden["sampling"]["mean_atol"] = _mean_atol(
                sampling["mean_atol"], float(np.var(xs)), sampling["n"])

    doc = {"format_version": version, "metadata": {"name": name}, "rv": rv_struct}
    return doc, golden


def _mean_atol(base, variance, n):
    """Sample-mean tolerance = max(base, SEM_SIGMAS·sqrt(Var/n)). Per-dimension variance (Joint) is
    not mean-checked by the runners, so a scalar variance is used when available."""
    if isinstance(variance, list):
        variance = max(variance)
    return max(base, SEM_SIGMAS * (variance / n) ** 0.5)


def _num(x):
    return [float(v) for v in x] if isinstance(x, list) else float(x)


def dump(path, obj):
    with open(path, "w") as f:
        json.dump(obj, f, indent=2, sort_keys=True)
        f.write("\n")


def main():
    os.makedirs(CASES_DIR, exist_ok=True)
    os.makedirs(GOLDEN_DIR, exist_ok=True)
    manifest = {"format_version": VERSION, "cases": []}
    for name, description, rv_struct, points, sampling in CASES:
        doc, golden = build(name, rv_struct, points, sampling)
        dump(os.path.join(CASES_DIR, f"{name}.rv.json"), doc)
        dump(os.path.join(GOLDEN_DIR, f"{name}.json"), golden)
        manifest["cases"].append({"name": name, "description": description,
                                  "case": f"cases/{name}.rv.json",
                                  "golden": f"golden/{name}.json", "kind": rv_struct["kind"]})
    dump(os.path.join(HERE, "manifest.json"), manifest)
    print(f"Generated {len(CASES)} cases into {CASES_DIR} and {GOLDEN_DIR}")


if __name__ == "__main__":
    main()
