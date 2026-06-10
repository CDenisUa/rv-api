#!/usr/bin/env python3
"""
Headless half of the formal task demo: generate a list of RVs of different types (discrete and
continuous) in one language (Python), and export (write) it to the RV format as an
`.rv-list.json` bundle.

The bundle is then imported (read) in other languages:
  - TypeScript: `npx tsx demo/cli/read_rv_list.ts <bundle>`
  - Rust:       `cargo run --manifest-path generated/impl/rust/Cargo.toml --example read_rv_list -- <bundle>`
  - Browser:    the "Batch export/import" panel of the demo app accepts the same file via upload.

Thin client over the `rvx` reference implementation - no distribution math here.

Run:  PYTHONPATH=generated/impl/python/src python3 demo/cli/write_rv_list.py [out.rv-list.json]
"""

# Core
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "generated", "impl", "python", "src"))
import rvx  # noqa: E402

FORMAT_VERSION = "1.1.0"

ITEMS = [
    ("normal_shifted", "Normal process noise", "continuous",
     {"kind": "leaf", "dist": "normal", "params": {"mu": 2.0, "sigma": 0.8}}),
    ("weibull_strength", "Weibull fracture strength", "continuous",
     {"kind": "leaf", "dist": "weibull", "params": {"shape": 10.0, "scale": 350.0}}),
    ("categorical_class", "Categorical inspection class", "discrete",
     {"kind": "leaf", "dist": "categorical",
      "params": {"categories": [1.0, 2.0, 3.0, 4.0], "probs": [0.1, 0.2, 0.45, 0.25]}}),
    ("poisson_defects", "Poisson defect count", "discrete",
     {"kind": "leaf", "dist": "poisson", "params": {"rate": 3.5}}),
    ("binomial_qc", "Binomial QC failures (n=20)", "discrete",
     {"kind": "leaf", "dist": "binomial", "params": {"n": 20, "p": 0.15}}),
    ("joint_thickness_temp", "Joint: thickness x temperature", "continuous",
     {"kind": "joint", "dims": [
         {"kind": "leaf", "dist": "lognormal", "params": {"mu": 2.3, "sigma": 0.25}},
         {"kind": "leaf", "dist": "normal", "params": {"mu": 293.0, "sigma": 4.0}}]}),
    ("mixture_bimodal", "Bimodal grain size", "continuous",
     {"kind": "mixture", "weights": [0.7, 0.3], "components": [
         {"kind": "leaf", "dist": "lognormal", "params": {"mu": 1.0, "sigma": 0.3}},
         {"kind": "leaf", "dist": "lognormal", "params": {"mu": 2.5, "sigma": 0.4}}]}),
    ("transform_exp_normal", "exp(Normal) transform", "continuous",
     {"kind": "transform", "op": {"name": "exp"},
      "base": {"kind": "leaf", "dist": "normal", "params": {"mu": 0.0, "sigma": 1.0}}}),
]


def main():
    out_path = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), "rv-batch.rv-list.json")
    items = []
    for item_id, label, rv_type, rv in ITEMS:
        # parse_document validates; to_document re-emits canonical recomputed capabilities.
        node = rvx.parse_document({"format_version": FORMAT_VERSION, "rv": rv})
        doc = rvx.to_document(node, format_version=FORMAT_VERSION, metadata={"name": item_id})
        items.append({"id": item_id, "label": label, "type": rv_type, "document": doc})

    bundle = {
        "format_version": FORMAT_VERSION,
        "kind": "rv_list",
        "producer": {"language": "Python", "framework": "rvx (scipy.stats)"},
        "items": items,
    }
    with open(out_path, "w") as f:
        json.dump(bundle, f, indent=2, sort_keys=True)
        f.write("\n")
    discrete = sum(1 for i in items if i["type"] == "discrete")
    print(f"wrote {out_path}: {len(items)} RV documents ({discrete} discrete, {len(items) - discrete} continuous)")


if __name__ == "__main__":
    main()
