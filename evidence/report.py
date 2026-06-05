#!/usr/bin/env python3
"""Emit a JSON conformance + timing report for the Python reference (evidence pack).

For each conformance case: how many deterministic values were checked and the worst absolute
deviation from golden. Then micro-benchmark the hot paths. Run from the repo root:
    PYTHONPATH=generated/impl/python/src python3 evidence/report.py
"""

# Core
import json
import os
import sys
import time

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, os.path.join(ROOT, "generated", "impl", "python", "src"))
import rvx                                       # noqa: E402
from rvx.errors import MomentsNotAvailable       # noqa: E402

CONF = os.path.join(ROOT, "conformance")


def _load(path):
    with open(path) as f:
        return json.load(f)


def _vals(x):
    return x if isinstance(x, list) else [x]


def _case_report(case, golden):
    node = rvx.parse_document(case)
    max_err, count = 0.0, 0

    def track(got, want):
        nonlocal max_err, count
        max_err = max(max_err, abs(float(got) - float(want)))
        count += 1

    for pt in golden.get("log_prob") or []:
        track(rvx.log_prob(node, pt["x"]), pt["value"])
    for pt in golden.get("cdf") or []:
        track(float(rvx.cdf(node, pt["x"])), pt["value"])
    if golden.get("moments") is not None:
        try:
            mean, var = rvx.moments(node)
            for g, w in zip(_vals(mean), _vals(golden["moments"]["mean"])):
                track(g, w)
            for g, w in zip(_vals(var), _vals(golden["moments"]["variance"])):
                track(g, w)
        except MomentsNotAvailable:
            pass
    return {"comparisons": count, "max_abs_error": max_err}


def _timings():
    normal = rvx.parse_document({"format_version": "1.0.0",
                                 "rv": {"kind": "leaf", "dist": "normal", "params": {"mu": 0.0, "sigma": 1.0}}})
    gamma = rvx.parse_document({"format_version": "1.0.0",
                                "rv": {"kind": "leaf", "dist": "gamma", "params": {"shape": 2.0, "scale": 2.0}}})

    n = 200_000
    rng = np.random.default_rng(1)
    t = time.perf_counter()
    rvx.sample(normal, rng, n)
    sample_ns = (time.perf_counter() - t) / n * 1e9

    xs = np.linspace(-3, 3, 100_000)
    t = time.perf_counter()
    rvx.log_prob(normal, xs)  # vectorized (scipy)
    log_prob_ns = (time.perf_counter() - t) / xs.size * 1e9

    gx = np.linspace(0.01, 12, 100_000)
    t = time.perf_counter()
    rvx.cdf(gamma, gx)
    cdf_ns = (time.perf_counter() - t) / gx.size * 1e9

    return {"sample_ns_per_draw": sample_ns, "normal_log_prob_ns": log_prob_ns, "gamma_cdf_ns": cdf_ns}


def main():
    manifest = _load(os.path.join(CONF, "manifest.json"))
    cases = []
    for entry in manifest["cases"]:
        rep = _case_report(_load(os.path.join(CONF, entry["case"])),
                           _load(os.path.join(CONF, entry["golden"])))
        cases.append({"name": entry["name"], **rep})
    print(json.dumps({"language": "Python", "version": rvx.__version__,
                      "cases": cases, "timings": _timings()}))


if __name__ == "__main__":
    main()
