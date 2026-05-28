"""Bulk array references (SPEC.md §"Scalability"). Empirical sample arrays live either inline as
base64 or in an external .npy sidecar, keeping the structural document tiny."""

# Core
from __future__ import annotations
import base64
import os
from typing import Mapping, Optional
import numpy as np
# Errors
from .errors import ValidationError

_DTYPE = {"float32": "<f4", "float64": "<f8", "int32": "<i4", "int64": "<i8"}


def decode(ref: Mapping, *, base_dir: Optional[str] = None) -> np.ndarray:
    """Materialize a bulk_ref into a 1-D numpy array."""
    fmt = ref.get("format")
    dtype = ref.get("dtype")
    if dtype not in _DTYPE:
        raise ValidationError(f"unsupported bulk dtype: {dtype!r}")
    if fmt == "base64":
        raw = base64.b64decode(ref["data"])
        arr = np.frombuffer(raw, dtype=_DTYPE[dtype]).copy()
    elif fmt == "npy":
        path = ref["path"]
        if base_dir and not os.path.isabs(path):
            path = os.path.join(base_dir, path)
        arr = np.load(path)
    else:
        raise ValidationError(f"unsupported bulk format: {fmt!r}")
    return arr.reshape(tuple(ref["shape"]))


def encode_base64(arr: np.ndarray) -> dict:
    """Encode a 1-D float64 array as an inline base64 bulk_ref."""
    a = np.asarray(arr, dtype="<f8").ravel()
    return {
        "format": "base64",
        "dtype": "float64",
        "shape": [int(a.size)],
        "data": base64.b64encode(a.tobytes()).decode("ascii"),
    }
