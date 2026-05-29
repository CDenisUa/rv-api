//! Property-based tests (proptest): round-trip identity, statistical equivalence, and the
//! structural/semantic invariants that JSON Schema cannot express.

mod common;

use common::ks_statistic;
use proptest::prelude::*;
use rvx::{capabilities, cdf, log_prob, parse_value, sample, to_value, RvError, Rng, Samples};
use serde_json::{json, Value};

fn normal_doc(mu: f64, sigma: f64) -> Value {
    json!({ "format_version": "1.0.0", "rv": { "kind": "leaf", "dist": "normal", "params": { "mu": mu, "sigma": sigma } } })
}

proptest! {
    #![proptest_config(ProptestConfig { cases: 50, ..ProptestConfig::default() })]

    /// parse → serialize → parse → serialize is idempotent (canonical form).
    #[test]
    fn roundtrip_identity(mu in -10.0f64..10.0, sigma in 0.1f64..5.0) {
        let node = parse_value(&normal_doc(mu, sigma)).unwrap();
        let once = to_value(&node).unwrap();
        let twice = to_value(&parse_value(&json!({ "format_version": "1.0.0", "rv": once })).unwrap()).unwrap();
        prop_assert_eq!(once, twice);
    }

    /// Samples agree with the reconstructed RV's own CDF (KS).
    #[test]
    fn sample_matches_cdf(mu in -3.0f64..3.0, sigma in 0.5f64..3.0) {
        let node = parse_value(&normal_doc(mu, sigma)).unwrap();
        if let Samples::Univariate(xs) = sample(&node, &mut Rng::new(0), 20_000).unwrap() {
            let ks = ks_statistic(&xs, |x| cdf(&node, &[x]).unwrap());
            prop_assert!(ks < 0.03, "KS={ks}");
        }
    }
}

#[test]
fn rejects_mixture_weights_not_summing_to_one() {
    let bad = json!({ "format_version": "1.0.0", "rv": {
        "kind": "mixture", "weights": [0.5, 0.4],
        "components": [
            { "kind": "leaf", "dist": "normal", "params": { "mu": 0.0, "sigma": 1.0 } },
            { "kind": "leaf", "dist": "normal", "params": { "mu": 1.0, "sigma": 1.0 } }
        ] } });
    assert!(matches!(parse_value(&bad), Err(RvError::Validation(_))));
}

#[test]
fn non_invertible_transform_has_no_log_prob() {
    let doc = json!({ "format_version": "1.0.0", "rv": {
        "kind": "transform", "op": { "name": "abs" },
        "base": { "kind": "leaf", "dist": "normal", "params": { "mu": 0.0, "sigma": 1.0 } } } });
    let node = parse_value(&doc).unwrap();
    assert!(!capabilities(&node).unwrap().can_log_prob);
    assert!(matches!(log_prob(&node, &[1.0]), Err(RvError::Capability(_))));
}

#[test]
fn rejects_declared_capability_mismatch() {
    let doc = json!({ "format_version": "1.0.0", "rv": {
        "kind": "leaf", "dist": "normal", "params": { "mu": 0.0, "sigma": 1.0 },
        "capabilities": { "can_sample": true, "can_log_prob": false, "can_cdf": true } } });
    assert!(matches!(parse_value(&doc), Err(RvError::CapabilityMismatch(_))));
}

#[test]
fn rejects_invalid_parameter() {
    let doc = json!({ "format_version": "1.0.0", "rv": {
        "kind": "leaf", "dist": "normal", "params": { "mu": 0.0, "sigma": -1.0 } } });
    assert!(matches!(parse_value(&doc), Err(RvError::Validation(_))));
}
