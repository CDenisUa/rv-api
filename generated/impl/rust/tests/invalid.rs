//! Negative conformance suite: every document under conformance/invalid/ MUST be rejected.
//!
//! This is the cross-language negative contract that complements the happy-path golden suite. Error
//! messages differ by language, so the assertion is "rejected", not "rejected with message X".

use rvx::parse_value;
use serde_json::Value;
use std::fs;
use std::path::{Path, PathBuf};

fn repo_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../..").canonicalize().unwrap()
}

fn load(path: &Path) -> Value {
    serde_json::from_str(&fs::read_to_string(path).unwrap_or_else(|e| panic!("read {path:?}: {e}")))
        .unwrap_or_else(|e| panic!("parse {path:?}: {e}"))
}

#[test]
fn invalid_documents_are_rejected() {
    let dir = repo_root().join("conformance/invalid");
    let manifest = load(&dir.join("manifest.json"));
    let cases = manifest["cases"].as_array().expect("cases array");
    assert!(!cases.is_empty(), "no invalid fixtures found");

    for entry in cases {
        let name = entry["name"].as_str().unwrap();
        let doc = load(&dir.join(entry["doc"].as_str().unwrap()));
        assert!(
            parse_value(&doc).is_err(),
            "[{name}] was accepted but must be rejected ({})",
            entry["reason"].as_str().unwrap_or("")
        );
    }
}
