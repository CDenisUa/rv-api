//! Headless half of the formal task demo: import (read) an `.rv-list.json` bundle written by
//! another language (e.g. `demo/cli/write_rv_list.py`) with the Rust core, validate every
//! document, and sample it. Exits non-zero if any document fails to read. Run from the repo root:
//!     cargo run --manifest-path generated/impl/rust/Cargo.toml --example read_rv_list -- demo/cli/rv-batch.rv-list.json

use rvx::{capabilities, parse_value, Prepared, Rng, Samples};
use serde_json::Value;
use std::process::exit;

const SAMPLE_N: usize = 100_000;
const SEED: u64 = 4242;

fn main() {
    let path = match std::env::args().nth(1) {
        Some(p) => p,
        None => {
            eprintln!("usage: cargo run --example read_rv_list -- <bundle.rv-list.json>");
            exit(2);
        }
    };
    let text = std::fs::read_to_string(&path).unwrap_or_else(|e| {
        eprintln!("read {path}: {e}");
        exit(2);
    });
    let bundle: Value = serde_json::from_str(&text).unwrap_or_else(|e| {
        eprintln!("parse {path}: {e}");
        exit(2);
    });
    let items = match (bundle["kind"].as_str(), bundle["items"].as_array()) {
        (Some("rv_list"), Some(items)) => items,
        _ => {
            eprintln!("not an .rv-list.json bundle (expected kind=\"rv_list\" with items[])");
            exit(2);
        }
    };

    let producer = bundle["producer"]["language"].as_str().unwrap_or("unknown");
    println!("reading {} RV documents written by {producer} with Rust/rvx\n", items.len());

    let mut failures = 0usize;
    for item in items {
        let id = item["id"].as_str().unwrap_or("?");
        let rv_type = item["type"].as_str().unwrap_or("?");
        match read_item(&item["document"]) {
            Ok((caps, mean)) => println!("  ok   {id} [{rv_type}] {caps} - sample mean {mean:.4}"),
            Err(e) => {
                failures += 1;
                println!("  FAIL {id}: {e}");
            }
        }
    }

    println!("\n{}/{} documents read + sampled", items.len() - failures, items.len());
    exit(if failures == 0 { 0 } else { 1 });
}

/// Parse + validate one document, then sample it (Joint: report dim 0).
fn read_item(doc: &Value) -> Result<(String, f64), rvx::RvError> {
    let node = parse_value(doc)?;
    let caps = capabilities(&node)?;
    let caps_text: Vec<&str> = [
        (caps.can_sample, "sample"),
        (caps.can_log_prob, "log_prob"),
        (caps.can_cdf, "cdf"),
    ]
    .iter()
    .filter_map(|&(on, name)| if on { Some(name) } else { None })
    .collect();
    let prepared = Prepared::compile(&node)?;
    let xs = match prepared.sample(&mut Rng::new(SEED), SAMPLE_N) {
        Samples::Univariate(v) => v,
        Samples::Joint(mut dims) => dims.swap_remove(0),
    };
    let mean = xs.iter().sum::<f64>() / xs.len() as f64;
    Ok((caps_text.join("+"), mean))
}
