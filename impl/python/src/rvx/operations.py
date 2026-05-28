"""Operations over the RV tree, each implemented as a Visitor (model.RVVisitor).

Adding an operation here never touches the model or the distribution catalog (Open/Closed).
Public convenience functions are exposed at the bottom and re-exported from the package root.
"""

# Core
from __future__ import annotations
from typing import Tuple, Union
import numpy as np
# Services
from . import distributions as dist_catalog
# Types
from .model import (Capabilities, Joint, Leaf, Mixture, RVNode, RVVisitor, Transform)
from .numerics import AliasSampler, log_sum_exp
# Errors
from .errors import CapabilityError, MomentsNotAvailable

NEG_INF = float("-inf")


class CapabilitiesVisitor(RVVisitor):
    """Recompute capabilities bottom-up (SPEC.md §7)."""

    def leaf(self, node: Leaf) -> Capabilities:
        return dist_catalog.create(node.dist, node.params).capabilities()

    def joint(self, node: Joint) -> Capabilities:
        return self._and(node.dims)

    def mixture(self, node: Mixture) -> Capabilities:
        return self._and(node.components)

    def transform(self, node: Transform) -> Capabilities:
        base = node.base.accept(self)
        return Capabilities(
            can_sample=base.can_sample,
            can_log_prob=base.can_log_prob and node.op.invertible,
            can_cdf=base.can_cdf and node.op.monotone,
        )

    def _and(self, children) -> Capabilities:
        caps = [c.accept(self) for c in children]
        return Capabilities(
            can_sample=all(c.can_sample for c in caps),
            can_log_prob=all(c.can_log_prob for c in caps),
            can_cdf=all(c.can_cdf for c in caps),
        )


class LogProbVisitor(RVVisitor):
    """Evaluate log-density/mass at a point. `x` is a scalar (or vector for Joint)."""

    def __init__(self, x):
        self.x = x

    def leaf(self, node: Leaf):
        return _scalar(dist_catalog.create(node.dist, node.params).log_prob(self.x))

    def joint(self, node: Joint):
        return float(sum(dim.accept(LogProbVisitor(xi)) for dim, xi in zip(node.dims, self.x)))

    def mixture(self, node: Mixture):
        terms = [np.log(w) + comp.accept(LogProbVisitor(self.x))
                 for w, comp in zip(node.weights, node.components)]
        return log_sum_exp(terms)

    def transform(self, node: Transform):
        op = node.op
        if not op.invertible:
            raise CapabilityError(f"log_prob unavailable: op '{op.name}' is not invertible")
        with np.errstate(all="ignore"):
            x_inv = op.inverse(self.x)
            base_lp = node.base.accept(LogProbVisitor(x_inv))
            out = base_lp + op.log_abs_dinverse(self.x)
        return _scalar(np.where(np.isfinite(out), out, NEG_INF))


class CdfVisitor(RVVisitor):
    """Evaluate P(X <= x). Vectorized: `x` may be a scalar or a numpy array (Joint takes a vector)."""

    def __init__(self, x):
        self.x = x

    def leaf(self, node: Leaf):
        return dist_catalog.create(node.dist, node.params).cdf(self.x)

    def joint(self, node: Joint):
        out = 1.0
        for dim, xi in zip(node.dims, self.x):
            out = out * dim.accept(CdfVisitor(xi))
        return out

    def mixture(self, node: Mixture):
        return sum(w * comp.accept(CdfVisitor(self.x))
                   for w, comp in zip(node.weights, node.components))

    def transform(self, node: Transform):
        op = node.op
        if not op.monotone:
            raise CapabilityError(f"cdf unavailable: op '{op.name}' is not monotonic")
        with np.errstate(all="ignore"):
            x_inv = op.inverse(self.x)
            base_cdf = node.base.accept(CdfVisitor(x_inv))
            res = base_cdf if op.increasing else 1.0 - base_cdf
            # Points below the op's image map to the appropriate tail (e.g. exp(x) <= 0 -> cdf 0).
            res = np.where(np.isnan(np.asarray(x_inv, dtype=float)),
                           0.0 if op.increasing else 1.0, res)
        return _scalar(res) if np.ndim(self.x) == 0 else res


class SampleVisitor(RVVisitor):
    def __init__(self, rng: np.random.Generator, n: int):
        self.rng = rng
        self.n = n

    def leaf(self, node: Leaf) -> np.ndarray:
        return np.asarray(dist_catalog.create(node.dist, node.params).sample(self.rng, self.n))

    def joint(self, node: Joint) -> np.ndarray:
        return np.stack([dim.accept(self) for dim in node.dims], axis=1)

    def mixture(self, node: Mixture) -> np.ndarray:
        idx = AliasSampler(node.weights).sample(self.rng, self.n)
        out = np.empty(self.n)
        for i, comp in enumerate(node.components):
            mask = idx == i
            count = int(mask.sum())
            if count:
                out[mask] = comp.accept(SampleVisitor(self.rng, count))
        return out

    def transform(self, node: Transform) -> np.ndarray:
        return np.asarray(node.op.forward(node.base.accept(self)))


class MomentsVisitor(RVVisitor):
    """Closed-form (mean, variance) where known; raises MomentsNotAvailable otherwise."""

    def leaf(self, node: Leaf):
        return dist_catalog.create(node.dist, node.params).moments()

    def joint(self, node: Joint):
        ms, vs = zip(*(dim.accept(self) for dim in node.dims))
        return list(ms), list(vs)

    def mixture(self, node: Mixture):
        stats = [comp.accept(self) for comp in node.components]
        mean = sum(w * m for w, (m, _) in zip(node.weights, stats))
        ex2 = sum(w * (v + m * m) for w, (m, v) in zip(node.weights, stats))
        return float(mean), float(ex2 - mean * mean)

    def transform(self, node: Transform):
        from .ops import Affine
        if isinstance(node.op, Affine):
            m, v = node.base.accept(self)
            return node.op.a * m + node.op.b, node.op.a ** 2 * v
        raise MomentsNotAvailable(f"no closed-form moments for transform op '{node.op.name}'")


def _scalar(value):
    arr = np.asarray(value, dtype=float)
    return float(arr) if arr.ndim == 0 else arr


# --- Public API ------------------------------------------------------------------------------

def capabilities(node: RVNode) -> Capabilities:
    return node.accept(CapabilitiesVisitor())


def log_prob(node: RVNode, x) -> Union[float, np.ndarray]:
    return node.accept(LogProbVisitor(x))


def cdf(node: RVNode, x) -> Union[float, np.ndarray]:
    return node.accept(CdfVisitor(x))


def sample(node: RVNode, rng: np.random.Generator, n: int) -> np.ndarray:
    return node.accept(SampleVisitor(rng, n))


def moments(node: RVNode) -> Tuple:
    return node.accept(MomentsVisitor())
