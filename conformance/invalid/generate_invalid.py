#!/usr/bin/env python3
"""Generate the negative conformance fixtures.

These are documents that every conforming reader (Python, TypeScript, Rust) MUST reject - the
cross-language *negative* contract that complements the happy-path golden suite. Each fixture
targets one rejection rule (op params, bulk self-consistency, weights, capabilities, versioning,
discrete-base transforms). The harness only asserts that parsing throws; error messages differ by
language, so the contract is "rejected", not "rejected with message X".

Bulk fixtures are emitted here (rather than hand-written) so their base64 buffers are exact.

Run from the repository root:
    python3 conformance/invalid/generate_invalid.py
"""

# Core
from __future__ import annotations
import base64
import json
import struct
from pathlib import Path

HERE = Path(__file__).resolve().parent


def _b64_float64(values: list[float]) -> str:
    return base64.b64encode(struct.pack(f"<{len(values)}d", *values)).decode("ascii")


def _b64_raw(byte_len: int) -> str:
    return base64.b64encode(bytes(byte_len)).decode("ascii")


def _normal(mu: float = 0.0, sigma: float = 1.0) -> dict:
    return {"kind": "leaf", "dist": "normal", "params": {"mu": mu, "sigma": sigma}}


# (name, reason, document). The document MUST fail structural or semantic validation.
FIXTURES: list[tuple[str, str, dict]] = [
    (
        "op_exp_extra_params",
        "exp is parameterless; a params object is invalid (op params MUST NOT be silently ignored)",
        {"format_version": "1.1.0",
         "rv": {"kind": "transform", "op": {"name": "exp", "params": {"scale": 2.0}},
                "base": _normal()}},
    ),
    (
        "op_affine_unknown_param",
        "affine accepts only a and b; an extra key c is invalid",
        {"format_version": "1.1.0",
         "rv": {"kind": "transform", "op": {"name": "affine", "params": {"a": 2.0, "b": 1.0, "c": 9.0}},
                "base": _normal()}},
    ),
    (
        "bulk_shape_mismatch",
        "declared shape [5] but only 3 decoded elements",
        {"format_version": "1.1.0",
         "rv": {"kind": "leaf", "dist": "empirical",
                "params": {"samples": {"format": "base64", "dtype": "float64", "shape": [5],
                                       "data": _b64_float64([1.0, 2.0, 3.0])}}}},
    ),
    (
        "bulk_truncated_buffer",
        "20-byte float64 buffer is not a whole multiple of the 8-byte item size",
        {"format_version": "1.1.0",
         "rv": {"kind": "leaf", "dist": "empirical",
                "params": {"samples": {"format": "base64", "dtype": "float64", "shape": [2],
                                       "data": _b64_raw(20)}}}},
    ),
    (
        "mixture_weights_length_mismatch",
        "one weight but two components (weights/components must align by index)",
        {"format_version": "1.1.0",
         "rv": {"kind": "mixture", "weights": [1.0],
                "components": [_normal(0.0, 1.0), _normal(5.0, 1.0)]}},
    ),
    (
        "mixture_weights_not_normalized",
        "weights sum to 0.6, not 1",
        {"format_version": "1.1.0",
         "rv": {"kind": "mixture", "weights": [0.3, 0.3],
                "components": [_normal(0.0, 1.0), _normal(5.0, 1.0)]}},
    ),
    (
        "capability_lie_abs",
        "abs is non-invertible so can_log_prob must be false; the document declares it true",
        {"format_version": "1.1.0",
         "rv": {"kind": "transform", "op": {"name": "abs"}, "base": _normal(),
                "capabilities": {"can_sample": True, "can_log_prob": True, "can_cdf": False}}},
    ),
    (
        "future_major_version",
        "format MAJOR 2 exceeds the implemented major and must be rejected, not guessed",
        {"format_version": "2.0.0", "rv": _normal()},
    ),
    (
        "transform_over_discrete_base",
        "change-of-variables applies to densities; a transform over a discrete (poisson) base is invalid",
        {"format_version": "1.1.0",
         "rv": {"kind": "transform", "op": {"name": "affine", "params": {"a": 2.0, "b": 0.0}},
                "base": {"kind": "leaf", "dist": "poisson", "params": {"rate": 3.5}}}},
    ),
]


def main() -> None:
    manifest = {
        "description": "Documents that every conforming reader MUST reject (structural or semantic "
                       "validation). The cross-language negative contract; the harness asserts only "
                       "that parsing is rejected.",
        "cases": [],
    }
    for name, reason, doc in FIXTURES:
        path = HERE / f"{name}.rv.json"
        path.write_text(json.dumps(doc, indent=2, sort_keys=True) + "\n")
        manifest["cases"].append({"name": name, "doc": f"{name}.rv.json", "reason": reason})
    (HERE / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print(f"wrote {len(FIXTURES)} invalid fixtures + manifest to {HERE}")


if __name__ == "__main__":
    main()
