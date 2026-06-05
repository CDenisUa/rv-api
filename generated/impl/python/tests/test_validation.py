"""Negative-path validation: format-version rejection (SPEC.md §9) and support consistency (§6.1)."""

# Core
import pytest
# Under test
import rvx
from rvx.errors import ValidationError


def _doc(rv, format_version="1.0.0"):
    return {"format_version": format_version, "rv": rv}


def _leaf(dist, params, support=None):
    rv = {"kind": "leaf", "dist": dist, "params": params}
    if support is not None:
        rv["support"] = support
    return rv


# --- format version (SPEC.md §9) ---------------------------------------------------------------

def test_accepts_current_major():
    node = rvx.parse_document(_doc(_leaf("normal", {"mu": 0.0, "sigma": 1.0}), "1.4.2"))
    assert node is not None


def test_rejects_future_major():
    with pytest.raises(ValidationError, match="MAJOR"):
        rvx.parse_document(_doc(_leaf("normal", {"mu": 0.0, "sigma": 1.0}), "2.0.0"))


def test_rejects_missing_format_version():
    with pytest.raises(ValidationError, match="format_version"):
        rvx.parse_document({"rv": _leaf("normal", {"mu": 0.0, "sigma": 1.0})})


# --- support consistency (SPEC.md §6.1) --------------------------------------------------------

def test_support_within_natural_is_accepted():
    rvx.parse_document(_doc(_leaf("exponential", {"rate": 1.0}, {"lower": 0.5, "upper": 10.0})))


def test_support_lower_below_natural_is_rejected():
    # exponential's natural support is [0, inf); declaring lower=-1 contradicts it.
    with pytest.raises(ValidationError, match="lower"):
        rvx.parse_document(_doc(_leaf("exponential", {"rate": 1.0}, {"lower": -1.0})))


def test_support_upper_above_natural_is_rejected():
    # uniform(0, 1) natural upper is 1; declaring upper=2 contradicts it.
    with pytest.raises(ValidationError, match="upper"):
        rvx.parse_document(_doc(_leaf("uniform", {"low": 0.0, "high": 1.0}, {"upper": 2.0})))
