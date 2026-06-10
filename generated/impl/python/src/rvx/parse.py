"""Document <-> model conversion plus semantic validation (SPEC.md §6.2).

Schema validation (against generated/spec/rv.schema.json) is the consumer's first stage and can be done with
any JSON Schema validator; this module performs the *semantic* stage: weight/alignment rules,
parameter sanity, and capability re-validation (declared MUST equal recomputed).
"""

# Core
from __future__ import annotations
import math
from typing import Any, Mapping, Optional
# Services
from . import operations
# Types
from .model import (Capabilities, Joint, Leaf, Mixture, RVNode, Support, Transform)
from .ops import build_op
from .distributions import DISCRETE_DISTS, create as create_distribution
# Errors
from .errors import CapabilityMismatch, ValidationError

WEIGHT_TOL = 1e-9

#: Highest format MAJOR this implementation understands. A document whose MAJOR exceeds this MUST be
#: rejected rather than silently misinterpreted (SPEC.md §9).
SUPPORTED_FORMAT_MAJOR = 1


def parse_document(doc: Mapping[str, Any], *, validate: bool = True) -> RVNode:
    check_format_version(doc.get("format_version"))
    if "rv" not in doc:
        raise ValidationError("document is missing the 'rv' root node")
    node = parse_node(doc["rv"])
    if validate:
        validate_semantics(node)
    return node


def check_format_version(version: Any) -> None:
    """Reject a document whose format MAJOR exceeds what we implement (SPEC.md §9)."""
    if not isinstance(version, str):
        raise ValidationError("document is missing a string 'format_version'")
    try:
        major = int(version.split(".", 1)[0])
    except ValueError:
        raise ValidationError(f"malformed format_version: {version!r}")
    if major > SUPPORTED_FORMAT_MAJOR:
        raise ValidationError(
            f"unsupported format_version {version}: MAJOR {major} exceeds supported "
            f"{SUPPORTED_FORMAT_MAJOR}")


def parse_node(d: Mapping[str, Any]) -> RVNode:
    kind = d.get("kind")
    declared = _caps(d)
    if kind == "leaf":
        return Leaf(dist=d["dist"], params=d["params"],
                    support=_support(d.get("support")), declared=declared)
    if kind == "joint":
        return Joint(dims=tuple(parse_node(c) for c in d["dims"]), declared=declared)
    if kind == "mixture":
        return Mixture(weights=tuple(float(w) for w in d["weights"]),
                       components=tuple(parse_node(c) for c in d["components"]), declared=declared)
    if kind == "transform":
        op = build_op(d["op"]["name"], d["op"].get("params"))
        return Transform(base=parse_node(d["base"]), op=op, declared=declared)
    raise ValidationError(f"unknown node kind: {kind!r}")


def validate_semantics(node: RVNode) -> None:
    """Recursively enforce semantic invariants and capability consistency."""
    if isinstance(node, Leaf):
        # Constructing the distribution validates parameters and (for empirical) the bulk_ref.
        d = create_distribution(node.dist, node.params)
        if node.dist == "categorical":
            _check_weights(node.params["probs"], "categorical probs")
            if len(node.params["categories"]) != len(node.params["probs"]):
                raise ValidationError("categorical categories/probs length mismatch")
        if node.support is not None:
            _check_support_consistency(node.support, d)
    elif isinstance(node, Joint):
        for dim in node.dims:
            validate_semantics(dim)
    elif isinstance(node, Mixture):
        if len(node.weights) != len(node.components):
            raise ValidationError("mixture weights/components length mismatch")
        _check_weights(node.weights, "mixture weights")
        for comp in node.components:
            validate_semantics(comp)
    elif isinstance(node, Transform):
        if _contains_discrete_leaf(node.base):
            raise ValidationError(
                "transform over a discrete base is invalid: change-of-variables applies to "
                "densities, not masses (SPEC.md §4.4)")
        validate_semantics(node.base)

    if node.declared is not None:
        computed = operations.capabilities(node)
        if node.declared != computed:
            raise CapabilityMismatch(
                f"declared capabilities {node.declared.as_dict()} != computed {computed.as_dict()}")


def to_document(node: RVNode, *, format_version: str = "1.1.0",
                metadata: Optional[Mapping] = None) -> dict:
    doc = {"format_version": format_version, "rv": to_dict(node)}
    if metadata is not None:
        doc["metadata"] = dict(metadata)
    return doc


def to_dict(node: RVNode) -> dict:
    """Serialize back to a plain dict, emitting the canonical (recomputed) capabilities."""
    caps = operations.capabilities(node).as_dict()
    if isinstance(node, Leaf):
        out = {"kind": "leaf", "dist": node.dist, "params": dict(node.params),
               "capabilities": caps}
        if node.support is not None:
            out["support"] = _support_dict(node.support)
        return out
    if isinstance(node, Joint):
        return {"kind": "joint", "dims": [to_dict(d) for d in node.dims], "capabilities": caps}
    if isinstance(node, Mixture):
        return {"kind": "mixture", "weights": list(node.weights),
                "components": [to_dict(c) for c in node.components], "capabilities": caps}
    if isinstance(node, Transform):
        return {"kind": "transform", "base": to_dict(node.base),
                "op": node.op.as_dict(), "capabilities": caps}
    raise ValidationError(f"cannot serialize node: {node!r}")


def _caps(d: Mapping) -> Optional[Capabilities]:
    c = d.get("capabilities")
    return Capabilities.from_dict(c) if c is not None else None


def _support(d: Optional[Mapping]) -> Optional[Support]:
    if d is None:
        return None
    return Support(lower=d.get("lower"), upper=d.get("upper"),
                   lower_inclusive=d.get("lower_inclusive", True),
                   upper_inclusive=d.get("upper_inclusive", True))


def _support_dict(s: Support) -> dict:
    out = {"lower_inclusive": s.lower_inclusive, "upper_inclusive": s.upper_inclusive}
    if s.lower is not None:
        out["lower"] = s.lower
    if s.upper is not None:
        out["upper"] = s.upper
    return out


def _check_support_consistency(support: Support, dist) -> None:
    """A declared support MUST NOT extend beyond the distribution's natural support (SPEC.md §6.1)."""
    nat_lower, nat_upper = dist.support()
    if support.lower is not None and support.lower < nat_lower - _bound_tol(nat_lower):
        raise ValidationError(
            f"declared support lower {support.lower} is below the distribution's natural lower "
            f"bound {nat_lower}")
    if support.upper is not None and support.upper > nat_upper + _bound_tol(nat_upper):
        raise ValidationError(
            f"declared support upper {support.upper} is above the distribution's natural upper "
            f"bound {nat_upper}")


def _bound_tol(bound: float) -> float:
    return 1e-9 * (1.0 + abs(bound)) if math.isfinite(bound) else 0.0


def _contains_discrete_leaf(node: RVNode) -> bool:
    if isinstance(node, Leaf):
        return node.dist in DISCRETE_DISTS
    if isinstance(node, Joint):
        return any(_contains_discrete_leaf(d) for d in node.dims)
    if isinstance(node, Mixture):
        return any(_contains_discrete_leaf(c) for c in node.components)
    if isinstance(node, Transform):
        return _contains_discrete_leaf(node.base)
    return False


def _check_weights(weights, label: str) -> None:
    if any(w < 0 for w in weights):
        raise ValidationError(f"{label} must be non-negative")
    if abs(sum(weights) - 1.0) > WEIGHT_TOL:
        raise ValidationError(f"{label} must sum to 1 (got {sum(weights)})")
