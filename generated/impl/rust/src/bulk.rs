//! Bulk array references (SPEC.md "Scalability"). Empirical sample arrays live either inline as
//! base64 or in an external .npy sidecar. The Rust reference decodes the inline base64 form
//! (little-endian raw buffer) into a `Vec<f64>`.

use crate::errors::{Result, RvError};
use base64::{engine::general_purpose::STANDARD, Engine};
use serde_json::Value;

/// Materialize an inline base64 bulk_ref into a `Vec<f64>`.
pub fn decode(reference: &Value) -> Result<Vec<f64>> {
    let format = reference.get("format").and_then(Value::as_str);
    let dtype = reference.get("dtype").and_then(Value::as_str);
    match format {
        Some("base64") => {}
        Some("npy") => {
            return Err(RvError::Validation(
                "npy sidecar bulk_ref is not supported by the Rust reference".into(),
            ))
        }
        other => return Err(RvError::Validation(format!("unsupported bulk format: {other:?}"))),
    }
    let data = reference
        .get("data")
        .and_then(Value::as_str)
        .ok_or_else(|| RvError::Validation("base64 bulk_ref requires \"data\"".into()))?;
    let bytes = STANDARD
        .decode(data)
        .map_err(|e| RvError::Validation(format!("invalid base64: {e}")))?;
    decode_le(&bytes, dtype)
}

fn decode_le(bytes: &[u8], dtype: Option<&str>) -> Result<Vec<f64>> {
    match dtype {
        Some("float64") => Ok(bytes
            .chunks_exact(8)
            .map(|c| f64::from_le_bytes(c.try_into().unwrap()))
            .collect()),
        Some("float32") => Ok(bytes
            .chunks_exact(4)
            .map(|c| f32::from_le_bytes(c.try_into().unwrap()) as f64)
            .collect()),
        Some("int32") => Ok(bytes
            .chunks_exact(4)
            .map(|c| i32::from_le_bytes(c.try_into().unwrap()) as f64)
            .collect()),
        Some("int64") => Ok(bytes
            .chunks_exact(8)
            .map(|c| i64::from_le_bytes(c.try_into().unwrap()) as f64)
            .collect()),
        other => Err(RvError::Validation(format!("unsupported bulk dtype: {other:?}"))),
    }
}
