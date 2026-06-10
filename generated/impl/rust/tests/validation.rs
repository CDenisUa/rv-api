//! Negative-path validation: format-version rejection (SPEC.md §9) and support consistency (§6.1).

use rvx::{parse_value, RvError};
use serde_json::{json, Value};

fn doc(rv: Value, format_version: &str) -> Value {
    json!({ "format_version": format_version, "rv": rv })
}

fn leaf(dist: &str, params: Value, support: Option<Value>) -> Value {
    let mut rv = json!({ "kind": "leaf", "dist": dist, "params": params });
    if let Some(s) = support {
        rv["support"] = s;
    }
    rv
}

// --- format version (SPEC.md §9) -----------------------------------------------------------------

#[test]
fn accepts_current_major() {
    let d = doc(leaf("normal", json!({ "mu": 0.0, "sigma": 1.0 }), None), "1.4.2");
    assert!(parse_value(&d).is_ok());
}

#[test]
fn rejects_future_major() {
    let d = doc(leaf("normal", json!({ "mu": 0.0, "sigma": 1.0 }), None), "2.0.0");
    assert!(matches!(parse_value(&d), Err(RvError::Validation(_))));
}

// --- support consistency (SPEC.md §6.1) ----------------------------------------------------------

#[test]
fn support_within_natural_is_accepted() {
    let d = doc(
        leaf("exponential", json!({ "rate": 1.0 }), Some(json!({ "lower": 0.5, "upper": 10.0 }))),
        "1.0.0",
    );
    assert!(parse_value(&d).is_ok());
}

#[test]
fn support_lower_below_natural_is_rejected() {
    // exponential's natural support is [0, inf); declaring lower=-1 contradicts it.
    let d = doc(leaf("exponential", json!({ "rate": 1.0 }), Some(json!({ "lower": -1.0 }))), "1.0.0");
    assert!(matches!(parse_value(&d), Err(RvError::Validation(m)) if m.contains("lower")));
}

#[test]
fn support_upper_above_natural_is_rejected() {
    // uniform(0, 1) natural upper is 1; declaring upper=2 contradicts it.
    let d = doc(
        leaf("uniform", json!({ "low": 0.0, "high": 1.0 }), Some(json!({ "upper": 2.0 }))),
        "1.0.0",
    );
    assert!(matches!(parse_value(&d), Err(RvError::Validation(m)) if m.contains("upper")));
}

// --- discrete leaves (SPEC.md §5.1, §4.4) ---------------------------------------------------------

#[test]
fn poisson_rejects_nonpositive_rate() {
    for rate in [0.0, -1.0] {
        let d = doc(leaf("poisson", json!({ "rate": rate }), None), "1.1.0");
        assert!(matches!(parse_value(&d), Err(RvError::Validation(m)) if m.contains("rate")));
    }
}

#[test]
fn binomial_rejects_bad_params() {
    for params in [
        json!({ "n": 0, "p": 0.5 }),
        json!({ "n": 2.5, "p": 0.5 }),
        json!({ "n": 10, "p": 0.0 }),
        json!({ "n": 10, "p": 1.0 }),
    ] {
        let d = doc(leaf("binomial", params, None), "1.1.0");
        assert!(matches!(parse_value(&d), Err(RvError::Validation(_))), "accepted bad binomial");
    }
}

#[test]
fn transform_over_discrete_base_is_rejected() {
    let bases = [
        leaf("poisson", json!({ "rate": 3.5 }), None),
        leaf("categorical", json!({ "categories": [1.0, 2.0], "probs": [0.5, 0.5] }), None),
        json!({
            "kind": "mixture", "weights": [0.5, 0.5],
            "components": [
                leaf("normal", json!({ "mu": 0.0, "sigma": 1.0 }), None),
                leaf("binomial", json!({ "n": 5, "p": 0.5 }), None),
            ],
        }),
    ];
    for base in bases {
        let rv = json!({
            "kind": "transform",
            "op": { "name": "affine", "params": { "a": 2.0, "b": 0.0 } },
            "base": base,
        });
        let d = doc(rv, "1.1.0");
        assert!(matches!(parse_value(&d), Err(RvError::Validation(m)) if m.contains("discrete")));
    }
}
