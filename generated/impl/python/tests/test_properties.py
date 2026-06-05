"""Property-based tests (Hypothesis): round-trip identity and statistical equivalence."""

# Core
import numpy as np
import pytest
from hypothesis import given, settings, strategies as st
from scipy import stats
# Under test
import rvx


def _normal_doc(mu, sigma):
    return {"format_version": "1.0.0",
            "rv": {"kind": "leaf", "dist": "normal", "params": {"mu": mu, "sigma": sigma}}}


@settings(max_examples=50, deadline=None)
@given(mu=st.floats(-10, 10), sigma=st.floats(0.1, 5))
def test_roundtrip_identity(mu, sigma):
    """parse -> serialize -> parse -> serialize is idempotent (canonical form)."""
    node = rvx.parse_document(_normal_doc(mu, sigma))
    once = rvx.to_dict(node)
    twice = rvx.to_dict(rvx.parse_document({"format_version": "1.0.0", "rv": once}))
    assert once == twice


@settings(max_examples=30, deadline=None)
@given(mu=st.floats(-3, 3), sigma=st.floats(0.5, 3))
def test_sample_matches_cdf_ks(mu, sigma):
    """Samples drawn from the reconstructed RV agree with its own CDF (KS test).
    Proves the format preserves *semantics*, not just bytes."""
    node = rvx.parse_document(_normal_doc(mu, sigma))
    xs = rvx.sample(node, np.random.default_rng(0), 20000)
    ks = stats.kstest(xs, lambda a: rvx.cdf(node, np.asarray(a, dtype=float))).statistic
    assert ks < 0.02


def test_mixture_weights_must_sum_to_one():
    bad = {"format_version": "1.0.0", "rv": {
        "kind": "mixture", "weights": [0.5, 0.4],
        "components": [{"kind": "leaf", "dist": "normal", "params": {"mu": 0, "sigma": 1}},
                       {"kind": "leaf", "dist": "normal", "params": {"mu": 1, "sigma": 1}}]}}
    with pytest.raises(rvx.ValidationError):
        rvx.parse_document(bad)


def test_non_invertible_transform_has_no_log_prob():
    doc = {"format_version": "1.0.0", "rv": {
        "kind": "transform", "op": {"name": "abs"},
        "base": {"kind": "leaf", "dist": "normal", "params": {"mu": 0, "sigma": 1}}}}
    node = rvx.parse_document(doc)
    assert rvx.capabilities(node).can_log_prob is False
    with pytest.raises(rvx.CapabilityError):
        rvx.log_prob(node, 1.0)


def test_declared_capability_mismatch_rejected():
    doc = {"format_version": "1.0.0", "rv": {
        "kind": "leaf", "dist": "normal", "params": {"mu": 0, "sigma": 1},
        "capabilities": {"can_sample": True, "can_log_prob": False, "can_cdf": True}}}
    with pytest.raises(rvx.CapabilityMismatch):
        rvx.parse_document(doc)
