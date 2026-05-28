"""Run the language-neutral conformance suite against the rvx implementation.

Deterministic outputs (log_prob, cdf, analytic moments) must match golden within 1e-9.
Stochastic sampling is checked statistically (KS against the case's own CDF + moment tolerances).
"""

# Core
import numpy as np
import pytest
from jsonschema import Draft202012Validator
from scipy import stats
# Under test
import rvx
from rvx.errors import MomentsNotAvailable
# Fixtures
from conftest import conformance_cases

ABS_TOL = 1e-9
CASES = conformance_cases()


@pytest.mark.parametrize("case,golden", CASES)
def test_schema_valid(case, golden, schema):
    errors = sorted(Draft202012Validator(schema).iter_errors(case), key=str)
    assert not errors, "; ".join(e.message for e in errors[:3])


@pytest.mark.parametrize("case,golden", CASES)
def test_capabilities(case, golden):
    node = rvx.parse_document(case)  # parse also semantically validates (incl. capability match)
    assert rvx.capabilities(node).as_dict() == golden["capabilities"]


@pytest.mark.parametrize("case,golden", CASES)
def test_log_prob(case, golden):
    if golden.get("log_prob") is None:
        pytest.skip("log_prob unavailable for this case")
    node = rvx.parse_document(case)
    for pt in golden["log_prob"]:
        assert rvx.log_prob(node, pt["x"]) == pytest.approx(pt["value"], abs=ABS_TOL)


@pytest.mark.parametrize("case,golden", CASES)
def test_cdf(case, golden):
    if golden.get("cdf") is None:
        pytest.skip("cdf unavailable for this case")
    node = rvx.parse_document(case)
    for pt in golden["cdf"]:
        assert float(rvx.cdf(node, pt["x"])) == pytest.approx(pt["value"], abs=ABS_TOL)


@pytest.mark.parametrize("case,golden", CASES)
def test_moments(case, golden):
    mom = golden.get("moments")
    if mom is None:
        pytest.skip("no golden moments")
    node = rvx.parse_document(case)
    samp = golden["sampling"]
    try:
        mean, var = rvx.moments(node)
    except MomentsNotAvailable:
        # No closed form -> validate against golden via Monte Carlo (sampling tolerances).
        xs = rvx.sample(node, np.random.default_rng(samp["seed"]), samp["n"])
        assert float(xs.mean()) == pytest.approx(mom["mean"], abs=samp["mean_atol"])
        assert float(xs.var()) == pytest.approx(mom["variance"], rel=samp["var_rtol"])
        return
    means = mean if isinstance(mean, list) else [mean]
    vars_ = var if isinstance(var, list) else [var]
    gmean = mom["mean"] if isinstance(mom["mean"], list) else [mom["mean"]]
    gvar = mom["variance"] if isinstance(mom["variance"], list) else [mom["variance"]]
    for a, b in zip(means, gmean):
        assert a == pytest.approx(b, abs=ABS_TOL)
    for a, b in zip(vars_, gvar):
        assert a == pytest.approx(b, abs=ABS_TOL)


@pytest.mark.parametrize("case,golden", CASES)
def test_sampling(case, golden):
    node = rvx.parse_document(case)
    samp = golden["sampling"]
    xs = rvx.sample(node, np.random.default_rng(samp["seed"]), samp["n"])

    kind = case["rv"]["kind"]
    is_categorical = kind == "leaf" and case["rv"].get("dist") == "categorical"
    if samp.get("ks_stat_max") is not None and kind != "joint" and not is_categorical:
        ks = stats.kstest(xs, lambda a: rvx.cdf(node, np.asarray(a, dtype=float))).statistic
        assert ks <= samp["ks_stat_max"], f"KS={ks:.4f}"

    mom = golden.get("moments")
    if mom is not None and kind != "joint":
        assert float(xs.mean()) == pytest.approx(mom["mean"], abs=samp["mean_atol"])
        assert float(xs.var()) == pytest.approx(mom["variance"], rel=samp["var_rtol"])
