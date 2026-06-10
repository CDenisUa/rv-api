//! WebAssembly surface (enabled with `--features wasm`).
//!
//! Thin wasm-bindgen wrappers so the M5 Next.js demo can run the Rust core in the browser: load a
//! `.rv.json` produced by Python or TypeScript and evaluate it at native speed. Documents are passed
//! as JSON strings; results come back as numbers / `Float64Array`.
//!
//! Build:  `cargo build --release --target wasm32-unknown-unknown --features wasm`
//! (or `wasm-pack build --features wasm` to emit JS bindings).

use crate::{operations::Samples, parse_str, Prepared, Rng};
use wasm_bindgen::prelude::*;

fn to_js<E: std::fmt::Display>(e: E) -> JsError {
    JsError::new(&e.to_string())
}

/// Recomputed capabilities as a JSON string `{ "can_sample", "can_log_prob", "can_cdf" }`.
#[wasm_bindgen]
pub fn rv_capabilities(doc: &str) -> std::result::Result<String, JsError> {
    let node = parse_str(doc).map_err(to_js)?;
    let caps = crate::capabilities(&node).map_err(to_js)?;
    Ok(serde_json::to_string(&caps).unwrap())
}

/// log-density/mass at a scalar point.
#[wasm_bindgen]
pub fn rv_log_prob(doc: &str, x: f64) -> std::result::Result<f64, JsError> {
    let node = parse_str(doc).map_err(to_js)?;
    Prepared::compile(&node).map_err(to_js)?.log_prob(&[x]).map_err(to_js)
}

/// Cumulative probability P(X ≤ x) at a scalar point.
#[wasm_bindgen]
pub fn rv_cdf(doc: &str, x: f64) -> std::result::Result<f64, JsError> {
    let node = parse_str(doc).map_err(to_js)?;
    Prepared::compile(&node).map_err(to_js)?.cdf(&[x]).map_err(to_js)
}

/// Draw `n` samples (univariate RVs only) as a `Float64Array`.
#[wasm_bindgen]
pub fn rv_sample(doc: &str, seed: f64, n: usize) -> std::result::Result<Vec<f64>, JsError> {
    let node = parse_str(doc).map_err(to_js)?;
    let prepared = Prepared::compile(&node).map_err(to_js)?;
    match prepared.sample(&mut Rng::new(seed as u64), n) {
        Samples::Univariate(v) => Ok(v),
        Samples::Joint(_) => Err(JsError::new("rv_sample: joint RVs are multi-dimensional")),
    }
}

/// Draw `n` samples of dimension `dim` as a `Float64Array`. Univariate RVs use `dim = 0`; for a
/// Joint the full vector is drawn and the requested dimension is returned.
#[wasm_bindgen]
pub fn rv_sample_dim(doc: &str, seed: f64, n: usize, dim: usize) -> std::result::Result<Vec<f64>, JsError> {
    let node = parse_str(doc).map_err(to_js)?;
    let prepared = Prepared::compile(&node).map_err(to_js)?;
    match prepared.sample(&mut Rng::new(seed as u64), n) {
        Samples::Univariate(v) if dim == 0 => Ok(v),
        Samples::Univariate(_) => Err(JsError::new("rv_sample_dim: univariate RV has only dim 0")),
        Samples::Joint(mut dims) if dim < dims.len() => Ok(dims.swap_remove(dim)),
        Samples::Joint(dims) => Err(JsError::new(&format!(
            "rv_sample_dim: dim {dim} out of range for {} dimensions",
            dims.len()
        ))),
    }
}
