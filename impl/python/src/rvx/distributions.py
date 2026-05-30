"""Leaf distribution catalog (Registry/Factory pattern).

Each distribution is created by name from canonical, library-independent parameters and exposes a
uniform interface (log_prob, cdf, sample, moments, capabilities). Adding a distribution = one
`@register` - no existing code changes (Open/Closed).

The canonical parameterizations and their scipy mappings are defined in SPEC.md §5.
"""

# Core
from __future__ import annotations
import math
from abc import ABC, abstractmethod
from typing import Callable, Dict, Mapping, Tuple
import numpy as np
from scipy import stats
# Services
from .bulk import decode as decode_bulk
from .numerics import AliasSampler
# Types
from .model import Capabilities
# Errors
from .errors import ValidationError


class Distribution(ABC):
    """Uniform interface every leaf distribution implements (Liskov-substitutable)."""

    @abstractmethod
    def log_prob(self, x): ...
    @abstractmethod
    def cdf(self, x): ...
    @abstractmethod
    def sample(self, rng: np.random.Generator, n: int) -> np.ndarray: ...
    @abstractmethod
    def moments(self) -> Tuple[float, float]: ...

    def capabilities(self) -> Capabilities:
        return Capabilities.all()


class _Scipy(Distribution):
    """Adapter over a frozen scipy.stats distribution (analytic leaves)."""

    def __init__(self, frozen):
        self._d = frozen

    def log_prob(self, x):
        return self._d.logpdf(x)

    def cdf(self, x):
        return self._d.cdf(x)

    def sample(self, rng, n):
        return self._d.rvs(size=n, random_state=rng)

    def moments(self):
        m, v = self._d.stats(moments="mv")
        return float(m), float(v)


class Categorical(Distribution):
    def __init__(self, categories, probs):
        self._cats = np.asarray(categories, dtype=float)
        self._probs = np.asarray(probs, dtype=float)
        order = np.argsort(self._cats)
        self._cats_sorted = self._cats[order]
        self._cum_sorted = np.cumsum(self._probs[order])
        self._alias = AliasSampler(self._probs)

    def log_prob(self, x):
        xs = np.atleast_1d(np.asarray(x, dtype=float))
        out = np.full(xs.shape, -np.inf)
        for c, p in zip(self._cats, self._probs):
            out[np.isclose(xs, c)] = math.log(p)
        return out if np.ndim(x) else float(out[0])

    def cdf(self, x):
        idx = np.searchsorted(self._cats_sorted, x, side="right")
        cum = np.concatenate([[0.0], self._cum_sorted])
        return cum[idx]

    def sample(self, rng, n):
        return self._cats[self._alias.sample(rng, n)]

    def moments(self):
        mean = float(np.sum(self._cats * self._probs))
        var = float(np.sum(self._probs * (self._cats - mean) ** 2))
        return mean, var


class Empirical(Distribution):
    """Sample-based leaf. log_prob via Gaussian KDE (Scott bandwidth), cdf via empirical CDF,
    sampling via bootstrap resampling (SPEC.md §8.5)."""

    def __init__(self, samples: np.ndarray):
        self._s = np.asarray(samples, dtype=float)
        self._sorted = np.sort(self._s)
        self._kde = stats.gaussian_kde(self._s, bw_method="scott")

    def log_prob(self, x):
        res = self._kde.logpdf(np.atleast_1d(x))
        return res if np.ndim(x) else float(res[0])

    def cdf(self, x):
        return np.searchsorted(self._sorted, x, side="right") / self._s.size

    def sample(self, rng, n):
        return rng.choice(self._s, size=n, replace=True)

    def moments(self):
        return float(self._s.mean()), float(self._s.var(ddof=0))


# --- Registry --------------------------------------------------------------------------------
_REGISTRY: Dict[str, Callable[[Mapping], Distribution]] = {}


def register(name: str):
    def deco(factory: Callable[[Mapping], Distribution]):
        _REGISTRY[name] = factory
        return factory
    return deco


def create(dist: str, params: Mapping) -> Distribution:
    if dist not in _REGISTRY:
        raise ValidationError(f"unknown distribution '{dist}'")
    return _REGISTRY[dist](params)


def registered_names():
    return frozenset(_REGISTRY)


register("normal")(lambda p: _Scipy(stats.norm(loc=p["mu"], scale=p["sigma"])))
register("lognormal")(lambda p: _Scipy(stats.lognorm(s=p["sigma"], scale=math.exp(p["mu"]))))
register("weibull")(lambda p: _Scipy(stats.weibull_min(c=p["shape"], scale=p["scale"])))
register("uniform")(lambda p: _Scipy(stats.uniform(loc=p["low"], scale=p["high"] - p["low"])))
register("exponential")(lambda p: _Scipy(stats.expon(scale=1.0 / p["rate"])))
register("gamma")(lambda p: _Scipy(stats.gamma(a=p["shape"], scale=p["scale"])))
register("beta")(lambda p: _Scipy(stats.beta(a=p["alpha"], b=p["beta"])))
register("categorical")(lambda p: Categorical(p["categories"], p["probs"]))
register("empirical")(lambda p: Empirical(decode_bulk(p["samples"])))
