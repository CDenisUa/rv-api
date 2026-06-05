"""Numerically-careful primitives used across operations.

- `log_sum_exp`: stable log(sum(exp(a))) for mixture log-prob.
- `AliasSampler`: Vose's alias method, O(1) per draw after O(k) setup, used for categorical leaves
  and for mixture component selection.
"""

# Core
from __future__ import annotations
from typing import Sequence
import numpy as np


def log_sum_exp(values: Sequence[float]) -> float:
    """log(sum(exp(v))) computed as m + log(sum(exp(v - m))), m = max(v). Avoids overflow/underflow.
    Treats -inf entries correctly; returns -inf if all entries are -inf."""
    arr = np.asarray(values, dtype=float)
    m = float(np.max(arr))
    if not np.isfinite(m):
        return m  # all -inf  -> -inf ; +inf -> +inf
    return m + float(np.log(np.sum(np.exp(arr - m))))


class AliasSampler:
    """Vose's alias method for sampling from a finite categorical distribution.

    Setup is O(k); each draw is O(1). Returns category *indices*.
    """

    def __init__(self, weights: Sequence[float]):
        w = np.asarray(weights, dtype=float)
        if np.any(w < 0):
            raise ValueError("weights must be non-negative")
        total = w.sum()
        if total <= 0:
            raise ValueError("weights must sum to a positive value")
        k = w.size
        self._k = k
        self._prob = np.zeros(k)
        self._alias = np.zeros(k, dtype=np.intp)

        scaled = w * (k / total)
        small = [i for i in range(k) if scaled[i] < 1.0]
        large = [i for i in range(k) if scaled[i] >= 1.0]
        while small and large:
            s = small.pop()
            l = large.pop()
            self._prob[s] = scaled[s]
            self._alias[s] = l
            scaled[l] = (scaled[l] + scaled[s]) - 1.0
            (small if scaled[l] < 1.0 else large).append(l)
        for i in large + small:
            self._prob[i] = 1.0

    def sample(self, rng: np.random.Generator, n: int) -> np.ndarray:
        cols = rng.integers(0, self._k, size=n)
        coins = rng.random(size=n)
        use_alias = coins >= self._prob[cols]
        return np.where(use_alias, self._alias[cols], cols)
