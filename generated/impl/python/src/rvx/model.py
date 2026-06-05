"""Core model: the random-variable ADT as a Composite tree.

An RV is one of four node kinds (Leaf | Joint | Mixture | Transform). Operations are kept out of
the nodes and implemented as Visitors (see operations.py), so a new operation can be added without
touching the model (Open/Closed).
"""

# Core
from __future__ import annotations
from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Any, Mapping, Optional, Tuple
# Types
from .ops import Op


@dataclass(frozen=True)
class Capabilities:
    can_sample: bool
    can_log_prob: bool
    can_cdf: bool

    @staticmethod
    def all() -> "Capabilities":
        return Capabilities(True, True, True)

    def as_dict(self) -> dict:
        return {"can_sample": self.can_sample,
                "can_log_prob": self.can_log_prob,
                "can_cdf": self.can_cdf}

    @staticmethod
    def from_dict(d: Mapping[str, bool]) -> "Capabilities":
        return Capabilities(bool(d["can_sample"]), bool(d["can_log_prob"]), bool(d["can_cdf"]))


@dataclass(frozen=True)
class Support:
    lower: Optional[float] = None
    upper: Optional[float] = None
    lower_inclusive: bool = True
    upper_inclusive: bool = True


class RVNode(ABC):
    """Composite element. `declared` holds capabilities as stated in the document (may be None);
    the parser validates them against the recomputed values."""

    declared: Optional[Capabilities]

    @abstractmethod
    def accept(self, visitor: "RVVisitor"):
        ...


@dataclass(frozen=True)
class Leaf(RVNode):
    dist: str
    params: Mapping[str, Any]
    support: Optional[Support] = None
    declared: Optional[Capabilities] = None

    def accept(self, visitor: "RVVisitor"):
        return visitor.leaf(self)


@dataclass(frozen=True)
class Joint(RVNode):
    dims: Tuple[RVNode, ...]
    declared: Optional[Capabilities] = None

    def accept(self, visitor: "RVVisitor"):
        return visitor.joint(self)


@dataclass(frozen=True)
class Mixture(RVNode):
    weights: Tuple[float, ...]
    components: Tuple[RVNode, ...]
    declared: Optional[Capabilities] = None

    def accept(self, visitor: "RVVisitor"):
        return visitor.mixture(self)


@dataclass(frozen=True)
class Transform(RVNode):
    base: RVNode
    op: Op
    declared: Optional[Capabilities] = None

    def accept(self, visitor: "RVVisitor"):
        return visitor.transform(self)


class RVVisitor(ABC):
    """Visitor over the four node kinds. Each operation (sample, log_prob, cdf, ...) is a concrete
    visitor; adding one does not modify the model."""

    @abstractmethod
    def leaf(self, node: Leaf): ...
    @abstractmethod
    def joint(self, node: Joint): ...
    @abstractmethod
    def mixture(self, node: Mixture): ...
    @abstractmethod
    def transform(self, node: Transform): ...
