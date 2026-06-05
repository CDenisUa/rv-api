//! Run the language-neutral conformance suite against the rvx Rust implementation.
//!
//! Deterministic outputs (log_prob, cdf, analytic moments) must match golden within 1e-9. Stochastic
//! sampling is checked statistically (KS against the case's own CDF + moment tolerances). Each case
//! is also validated against the canonical JSON Schema (spec/rv.schema.json) with the `jsonschema`
//! crate, independently of the crate's own serde door - proving the fixtures and the contract agree.

mod common;

use common::{ks_statistic, population_stats};
use rvx::{capabilities, parse_value, Moment, Prepared, Rng, RvError, Samples};
use serde_json::Value;
use std::fs;
use std::path::{Path, PathBuf};

const ABS_TOL: f64 = 1e-9;

fn repo_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../..").canonicalize().unwrap()
}

fn load(path: &Path) -> Value {
    serde_json::from_str(&fs::read_to_string(path).unwrap_or_else(|e| panic!("read {path:?}: {e}")))
        .unwrap_or_else(|e| panic!("parse {path:?}: {e}"))
}

fn point(v: &Value) -> Vec<f64> {
    match v {
        Value::Array(a) => a.iter().map(|x| x.as_f64().unwrap()).collect(),
        _ => vec![v.as_f64().unwrap()],
    }
}

fn moment_values(m: &Moment) -> Vec<f64> {
    match m {
        Moment::Scalar(v) => vec![*v],
        Moment::Vector(v) => v.clone(),
    }
}

fn golden_moment_values(v: &Value) -> Vec<f64> {
    point(v)
}

#[test]
fn conformance_suite() {
    let root = repo_root();
    let conf = root.join("conformance");
    let schema = load(&root.join("generated/spec/rv.schema.json"));
    let validator = jsonschema::validator_for(&schema).expect("compile schema");
    let manifest = load(&conf.join("manifest.json"));

    for entry in manifest["cases"].as_array().unwrap() {
        let name = entry["name"].as_str().unwrap();
        let case = load(&conf.join(entry["case"].as_str().unwrap()));
        let golden = load(&conf.join(entry["golden"].as_str().unwrap()));
        run_case(name, &case, &golden, &validator);
    }
}

fn run_case(name: &str, case: &Value, golden: &Value, validator: &jsonschema::Validator) {
    // 1. Structural validity against the canonical JSON Schema.
    assert!(validator.is_valid(case), "[{name}] does not validate against rv.schema.json");

    // 2. Semantic validation (incl. capability re-check) + golden capabilities.
    let node = parse_value(case).unwrap_or_else(|e| panic!("[{name}] parse failed: {e}"));
    let caps = serde_json::to_value(capabilities(&node).unwrap()).unwrap();
    assert_eq!(caps, golden["capabilities"], "[{name}] capabilities mismatch");

    let prepared = Prepared::compile(&node).unwrap();

    // 3. log_prob.
    if golden["log_prob"].is_null() {
        assert_eq!(golden["capabilities"]["can_log_prob"], Value::Bool(false), "[{name}]");
        assert!(prepared.log_prob(&[0.0]).is_err(), "[{name}] expected log_prob unavailable");
    } else {
        for pt in golden["log_prob"].as_array().unwrap() {
            let got = prepared.log_prob(&point(&pt["x"])).unwrap();
            let want = pt["value"].as_f64().unwrap();
            assert!((got - want).abs() <= ABS_TOL, "[{name}] log_prob @ {}: {got} vs {want}", pt["x"]);
        }
    }

    // 4. cdf.
    if golden["cdf"].is_null() {
        assert_eq!(golden["capabilities"]["can_cdf"], Value::Bool(false), "[{name}]");
        assert!(prepared.cdf(&[0.0]).is_err(), "[{name}] expected cdf unavailable");
    } else {
        for pt in golden["cdf"].as_array().unwrap() {
            let got = prepared.cdf(&point(&pt["x"])).unwrap();
            let want = pt["value"].as_f64().unwrap();
            assert!((got - want).abs() <= ABS_TOL, "[{name}] cdf @ {}: {got} vs {want}", pt["x"]);
        }
    }

    let samp = &golden["sampling"];
    let seed = samp["seed"].as_u64().unwrap();
    let n = samp["n"].as_u64().unwrap() as usize;
    let mean_atol = samp["mean_atol"].as_f64().unwrap();
    let var_rtol = samp["var_rtol"].as_f64().unwrap();

    // 5. moments.
    if !golden["moments"].is_null() {
        let mom = &golden["moments"];
        match prepared.moments() {
            Ok((mean, var)) => {
                let (gm, gv) = (golden_moment_values(&mom["mean"]), golden_moment_values(&mom["variance"]));
                for (a, b) in moment_values(&mean).iter().zip(&gm) {
                    assert!((a - b).abs() <= ABS_TOL, "[{name}] moment mean: {a} vs {b}");
                }
                for (a, b) in moment_values(&var).iter().zip(&gv) {
                    assert!((a - b).abs() <= ABS_TOL, "[{name}] moment var: {a} vs {b}");
                }
            }
            Err(RvError::MomentsNotAvailable(_)) => {
                // No closed form → validate against golden via Monte Carlo (sampling tolerances).
                if let Samples::Univariate(xs) = prepared.sample(&mut Rng::new(seed), n) {
                    let (m, v) = population_stats(&xs);
                    let gm = mom["mean"].as_f64().unwrap();
                    let gv = mom["variance"].as_f64().unwrap();
                    assert!((m - gm).abs() <= mean_atol, "[{name}] MC mean: {m} vs {gm}");
                    assert!((v - gv).abs() <= var_rtol * gv.abs(), "[{name}] MC var: {v} vs {gv}");
                }
            }
            Err(e) => panic!("[{name}] unexpected moments error: {e}"),
        }
    }

    // 6. sampling (KS + moments).
    let kind = case["rv"]["kind"].as_str().unwrap();
    let is_categorical = kind == "leaf" && case["rv"]["dist"].as_str() == Some("categorical");
    match prepared.sample(&mut Rng::new(seed), n) {
        Samples::Joint(dims) => {
            assert_eq!(dims.len(), case["rv"]["dims"].as_array().unwrap().len(), "[{name}] joint dims");
        }
        Samples::Univariate(xs) => {
            if !samp["ks_stat_max"].is_null() && !is_categorical {
                let ks = ks_statistic(&xs, |x| prepared.cdf(&[x]).unwrap());
                let max = samp["ks_stat_max"].as_f64().unwrap();
                assert!(ks <= max, "[{name}] KS={ks} > {max}");
            }
            if !golden["moments"].is_null() {
                let (m, v) = population_stats(&xs);
                let gm = golden["moments"]["mean"].as_f64().unwrap();
                let gv = golden["moments"]["variance"].as_f64().unwrap();
                assert!((m - gm).abs() <= mean_atol, "[{name}] sample mean: {m} vs {gm}");
                assert!((v - gv).abs() <= var_rtol * gv.abs(), "[{name}] sample var: {v} vs {gv}");
            }
        }
    }
}
