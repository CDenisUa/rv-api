"""Negative-path validation: format-version rejection (SPEC.md §9), support consistency (§6.1),
discrete parameter constraints (§5.1), and the continuous-transform-base rule (§4.4)."""

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


# --- discrete leaves (SPEC.md §5.1, §4.4) -------------------------------------------------------

@pytest.mark.parametrize("params", [{"rate": 0.0}, {"rate": -1.0}])
def test_poisson_rejects_nonpositive_rate(params):
    with pytest.raises(ValidationError, match="rate"):
        rvx.parse_document(_doc(_leaf("poisson", params)))


@pytest.mark.parametrize("params", [
    {"n": 0, "p": 0.5}, {"n": 2.5, "p": 0.5}, {"n": 10, "p": 0.0}, {"n": 10, "p": 1.0},
])
def test_binomial_rejects_bad_params(params):
    with pytest.raises(ValidationError):
        rvx.parse_document(_doc(_leaf("binomial", params)))


@pytest.mark.parametrize("base", [
    _leaf("poisson", {"rate": 3.5}),
    _leaf("categorical", {"categories": [1.0, 2.0], "probs": [0.5, 0.5]}),
    {"kind": "mixture", "weights": [0.5, 0.5],
     "components": [_leaf("normal", {"mu": 0.0, "sigma": 1.0}), _leaf("binomial", {"n": 5, "p": 0.5})]},
])
def test_transform_over_discrete_base_is_rejected(base):
    rv = {"kind": "transform", "op": {"name": "affine", "params": {"a": 2.0, "b": 0.0}}, "base": base}
    with pytest.raises(ValidationError, match="discrete"):
        rvx.parse_document(_doc(rv))
