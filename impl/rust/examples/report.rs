//! Emits a JSON conformance + timing report for the evidence pack (`evidence/build_evidence.py`).
//! For each conformance case it records how many deterministic values were checked and the worst
//! absolute deviation from golden; then it micro-benchmarks the hot paths. Run:
//!     cargo run --release --quiet --example report

use rvx::{parse_value, Moment, Prepared, Rng};
use serde_json::{json, Value};
use std::hint::black_box;
use std::path::{Path, PathBuf};
use std::time::Instant;

fn root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../..").canonicalize().unwrap()
}

fn load(path: PathBuf) -> Value {
    serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap()
}

fn point(v: &Value) -> Vec<f64> {
    match v {
        Value::Array(a) => a.iter().map(|x| x.as_f64().unwrap()).collect(),
        _ => vec![v.as_f64().unwrap()],
    }
}

fn moment_vals(m: &Moment) -> Vec<f64> {
    match m {
        Moment::Scalar(v) => vec![*v],
        Moment::Vector(v) => v.clone(),
    }
}

fn main() {
    let conf = root().join("conformance");
    let manifest = load(conf.join("manifest.json"));

    let mut cases = Vec::new();
    for entry in manifest["cases"].as_array().unwrap() {
        let name = entry["name"].as_str().unwrap().to_string();
        let doc = load(conf.join(entry["case"].as_str().unwrap()));
        let golden = load(conf.join(entry["golden"].as_str().unwrap()));
        let prepared = Prepared::compile(&parse_value(&doc).unwrap()).unwrap();

        let mut max_err = 0.0f64;
        let mut count = 0u32;
        let mut track = |got: f64, want: f64| {
            max_err = max_err.max((got - want).abs());
            count += 1;
        };
        if let Some(arr) = golden["log_prob"].as_array() {
            for pt in arr {
                track(prepared.log_prob(&point(&pt["x"])).unwrap(), pt["value"].as_f64().unwrap());
            }
        }
        if let Some(arr) = golden["cdf"].as_array() {
            for pt in arr {
                track(prepared.cdf(&point(&pt["x"])).unwrap(), pt["value"].as_f64().unwrap());
            }
        }
        if !golden["moments"].is_null() {
            if let Ok((mean, var)) = prepared.moments() {
                for (g, w) in moment_vals(&mean).iter().zip(point(&golden["moments"]["mean"])) {
                    track(*g, w);
                }
                for (g, w) in moment_vals(&var).iter().zip(point(&golden["moments"]["variance"])) {
                    track(*g, w);
                }
            }
        }
        cases.push(json!({ "name": name, "comparisons": count, "max_abs_error": max_err }));
    }

    println!("{}", json!({
        "language": "Rust",
        "version": rvx::VERSION,
        "cases": cases,
        "timings": timings(),
    }));
}

fn timings() -> Value {
    let normal = Prepared::compile(
        &parse_value(&json!({"format_version":"1.0.0","rv":{"kind":"leaf","dist":"normal","params":{"mu":0.0,"sigma":1.0}}})).unwrap(),
    )
    .unwrap();
    let gamma = Prepared::compile(
        &parse_value(&json!({"format_version":"1.0.0","rv":{"kind":"leaf","dist":"gamma","params":{"shape":2.0,"scale":2.0}}})).unwrap(),
    )
    .unwrap();

    let n = 200_000;
    let t = Instant::now();
    black_box(normal.sample(&mut Rng::new(1), n));
    let sample_ns_per_draw = t.elapsed().as_nanos() as f64 / n as f64;

    let iters = 2_000_000u64;
    let t = Instant::now();
    let mut acc = 0.0;
    for i in 0..iters {
        acc += normal.log_prob(&[i as f64 * 1e-6]).unwrap();
    }
    black_box(acc);
    let log_prob_ns = t.elapsed().as_nanos() as f64 / iters as f64;

    let t = Instant::now();
    let mut acc = 0.0;
    for i in 0..iters {
        acc += gamma.cdf(&[i as f64 * 1e-6]).unwrap();
    }
    black_box(acc);
    let cdf_ns = t.elapsed().as_nanos() as f64 / iters as f64;

    json!({
        "sample_ns_per_draw": sample_ns_per_draw,
        "normal_log_prob_ns": log_prob_ns,
        "gamma_cdf_ns": cdf_ns,
    })
}
