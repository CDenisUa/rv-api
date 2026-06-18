"""Transform ops (Strategy pattern).

Each op is `Y = forward(X)`. Invertible+differentiable ops support change-of-variables for log_prob;
monotone ops support cdf composition. A non-invertible op (abs) supports neither and degrades the
transform's capabilities accordingly (see SPEC.md §5.3, §8.4).
"""

# Core
from __future__ import annotations
from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Callable, Dict, Mapping, Optional
import numpy as np
# Errors
from .errors import NotInvertibleError, ValidationError


class Op(ABC):
    name: str
    invertible: bool
    increasing: Optional[bool]  # monotone direction; None if not monotone (e.g. abs)

    @property
    def monotone(self) -> bool:
        return self.increasing is not None

    @abstractmethod
    def forward(self, x):
        ...

    def inverse(self, y):
        raise NotInvertibleError(f"op '{self.name}' is not invertible")

    def log_abs_dinverse(self, y):
        """log |d/dy inverse(y)| - the change-of-variables Jacobian term."""
        raise NotInvertibleError(f"op '{self.name}' has no inverse Jacobian")

    def as_dict(self) -> dict:
        return {"name": self.name}


@dataclass(frozen=True)
class Affine(Op):
    a: float
    b: float
    name: str = "affine"
    invertible: bool = True

    @property
    def increasing(self) -> bool:
        return self.a > 0

    def forward(self, x):
        return self.a * x + self.b

    def inverse(self, y):
        return (y - self.b) / self.a

    def log_abs_dinverse(self, y):
        return -np.log(abs(self.a)) * np.ones_like(np.asarray(y, dtype=float))

    def as_dict(self) -> dict:
        return {"name": "affine", "params": {"a": self.a, "b": self.b}}


@dataclass(frozen=True)
class Exp(Op):
    name: str = "exp"
    invertible: bool = True
    increasing: bool = True

    def forward(self, x):
        return np.exp(x)

    def inverse(self, y):
        return np.log(y)

    def log_abs_dinverse(self, y):
        return -np.log(y)


@dataclass(frozen=True)
class Log(Op):
    name: str = "log"
    invertible: bool = True
    increasing: bool = True

    def forward(self, x):
        return np.log(x)

    def inverse(self, y):
        return np.exp(y)

    def log_abs_dinverse(self, y):
        return np.asarray(y, dtype=float)


@dataclass(frozen=True)
class Pow(Op):
    exponent: float
    name: str = "pow"
    invertible: bool = True

    @property
    def increasing(self) -> bool:
        return self.exponent > 0

    def forward(self, x):
        return np.power(x, self.exponent)

    def inverse(self, y):
        return np.power(y, 1.0 / self.exponent)

    def log_abs_dinverse(self, y):
        p = self.exponent
        return np.log(abs(1.0 / p)) + (1.0 / p - 1.0) * np.log(y)


@dataclass(frozen=True)
class Abs(Op):
    name: str = "abs"
    invertible: bool = False
    increasing: Optional[bool] = None

    def forward(self, x):
        return np.abs(x)


# Registry (Factory): op name -> builder from params. Adding an op = one registration.
_OPS: Dict[str, Callable[[Mapping], Op]] = {
    "affine": lambda p: Affine(a=float(p["a"]), b=float(p["b"])),
    "exp": lambda p: Exp(),
    "log": lambda p: Log(),
    "pow": lambda p: Pow(exponent=float(p["exponent"])),
    "abs": lambda p: Abs(),
}

#: Exact set of params each op accepts. exp/log/abs take none; unexpected keys are rejected rather
#: than silently ignored (SPEC.md §5.3) - a malformed or LLM-generated op MUST NOT be misread.
_OP_PARAMS: Dict[str, frozenset] = {
    "affine": frozenset({"a", "b"}),
    "exp": frozenset(),
    "log": frozenset(),
    "pow": frozenset({"exponent"}),
    "abs": frozenset(),
}


def build_op(name: str, params: Optional[Mapping] = None) -> Op:
    if name not in _OPS:
        raise ValidationError(f"unknown transform op '{name}'")
    params = params or {}
    extra = set(params) - _OP_PARAMS[name]
    if extra:
        raise ValidationError(f"op '{name}' got unexpected param(s): {sorted(extra)}")
    return _OPS[name](params)
