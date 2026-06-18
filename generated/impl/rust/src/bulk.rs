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
    let values = decode_le(&bytes, dtype)?;
    // A decoded bulk_ref MUST be self-consistent (SPEC.md §8.5): the element count must equal the
    // product of the declared shape - reject a mismatch rather than silently misread the buffer.
    if let Some(shape) = reference.get("shape").and_then(Value::as_array) {
        let expected: usize = shape
            .iter()
            .filter_map(Value::as_u64)
            .map(|x| x as usize)
            .product();
        if values.len() != expected {
            return Err(RvError::Validation(format!(
                "bulk_ref element count {} does not match shape product {expected}",
                values.len()
            )));
        }
    }
    Ok(values)
}

fn decode_le(bytes: &[u8], dtype: Option<&str>) -> Result<Vec<f64>> {
    let size = match dtype {
        Some("float64") | Some("int64") => 8,
        Some("float32") | Some("int32") => 4,
        other => return Err(RvError::Validation(format!("unsupported bulk dtype: {other:?}"))),
    };
    // Reject a buffer that is not a whole number of dtype-sized elements rather than dropping the
    // remainder (chunks_exact would otherwise silently truncate).
    if !bytes.len().is_multiple_of(size) {
        return Err(RvError::Validation(format!(
            "bulk_ref byte length {} is not a multiple of dtype size {size}",
            bytes.len()
        )));
    }
    Ok(match dtype {
        Some("float64") => bytes
            .chunks_exact(8)
            .map(|c| f64::from_le_bytes(c.try_into().unwrap()))
            .collect(),
        Some("float32") => bytes
            .chunks_exact(4)
            .map(|c| f32::from_le_bytes(c.try_into().unwrap()) as f64)
            .collect(),
        Some("int32") => bytes
            .chunks_exact(4)
            .map(|c| i32::from_le_bytes(c.try_into().unwrap()) as f64)
            .collect(),
        Some("int64") => bytes
            .chunks_exact(8)
            .map(|c| i64::from_le_bytes(c.try_into().unwrap()) as f64)
            .collect(),
        _ => unreachable!("dtype size already validated above"),
    })
}
