//! Document ↔ model conversion plus semantic validation (SPEC.md §6.2).
//!
//! serde deserializes the wire document into a `Raw*` representation (structural stage); this module
//! then builds the model and runs the semantic stage: weight/alignment rules, parameter sanity (via
//! distribution construction), and capability re-validation — declared MUST equal recomputed.

use crate::distributions::create;
use crate::errors::{Result, RvError};
use crate::model::{Capabilities, RvNode, Support};
use crate::operations::capabilities;
use crate::ops::Op;
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::HashMap;

const WEIGHT_TOL: f64 = 1e-9;

#[derive(Deserialize)]
struct RawDocument {
    #[allow(dead_code)]
    format_version: String,
    rv: RawNode,
}

#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
enum RawNode {
    Leaf {
        dist: String,
        params: Value,
        #[serde(default)]
        capabilities: Option<Capabilities>,
        #[serde(default)]
        support: Option<RawSupport>,
    },
    Joint {
        dims: Vec<RawNode>,
        #[serde(default)]
        capabilities: Option<Capabilities>,
    },
    Mixture {
        weights: Vec<f64>,
        components: Vec<RawNode>,
        #[serde(default)]
        capabilities: Option<Capabilities>,
    },
    Transform {
        base: Box<RawNode>,
        op: RawOp,
        #[serde(default)]
        capabilities: Option<Capabilities>,
    },
}

#[derive(Deserialize)]
struct RawOp {
    name: String,
    #[serde(default)]
    params: Option<HashMap<String, f64>>,
}

#[derive(Deserialize)]
struct RawSupport {
    #[serde(default)]
    lower: Option<f64>,
    #[serde(default)]
    upper: Option<f64>,
    #[serde(default)]
    lower_inclusive: Option<bool>,
    #[serde(default)]
    upper_inclusive: Option<bool>,
}

/// Parse a JSON document string into the RV model, running structural + semantic validation.
pub fn parse_str(json: &str) -> Result<RvNode> {
    let doc: RawDocument =
        serde_json::from_str(json).map_err(|e| RvError::Validation(format!("invalid document: {e}")))?;
    finish(doc)
}

/// Parse a `serde_json::Value` document into the RV model.
pub fn parse_value(doc: &Value) -> Result<RvNode> {
    let doc: RawDocument = serde_json::from_value(doc.clone())
        .map_err(|e| RvError::Validation(format!("invalid document: {e}")))?;
    finish(doc)
}

fn finish(doc: RawDocument) -> Result<RvNode> {
    let node = build(doc.rv)?;
    validate_semantics(&node)?;
    Ok(node)
}

fn build(raw: RawNode) -> Result<RvNode> {
    match raw {
        RawNode::Leaf { dist, params, capabilities, support } => Ok(RvNode::Leaf {
            dist,
            params,
            support: support.map(build_support),
            declared: capabilities,
        }),
        RawNode::Joint { dims, capabilities } => Ok(RvNode::Joint {
            dims: dims.into_iter().map(build).collect::<Result<_>>()?,
            declared: capabilities,
        }),
        RawNode::Mixture { weights, components, capabilities } => Ok(RvNode::Mixture {
            weights,
            components: components.into_iter().map(build).collect::<Result<_>>()?,
            declared: capabilities,
        }),
        RawNode::Transform { base, op, capabilities } => Ok(RvNode::Transform {
            base: Box::new(build(*base)?),
            op: Op::build(&op.name, &op.params.unwrap_or_default())?,
            declared: capabilities,
        }),
    }
}

fn build_support(rs: RawSupport) -> Support {
    Support {
        lower: rs.lower,
        upper: rs.upper,
        lower_inclusive: rs.lower_inclusive.unwrap_or(true),
        upper_inclusive: rs.upper_inclusive.unwrap_or(true),
    }
}

/// Recursively enforce semantic invariants and capability consistency (SPEC.md §6.2).
pub fn validate_semantics(node: &RvNode) -> Result<()> {
    match node {
        RvNode::Leaf { dist, params, .. } => {
            // Constructing the distribution validates parameters (and, for empirical, the bulk_ref).
            create(dist, params)?;
            if dist == "categorical" {
                let probs = f64_array(params, "probs")?;
                let categories = f64_array(params, "categories")?;
                check_weights(&probs, "categorical probs")?;
                if categories.len() != probs.len() {
                    return Err(RvError::Validation("categorical categories/probs length mismatch".into()));
                }
            }
        }
        RvNode::Joint { dims, .. } => {
            for dim in dims {
                validate_semantics(dim)?;
            }
        }
        RvNode::Mixture { weights, components, .. } => {
            if weights.len() != components.len() {
                return Err(RvError::Validation("mixture weights/components length mismatch".into()));
            }
            check_weights(weights, "mixture weights")?;
            for comp in components {
                validate_semantics(comp)?;
            }
        }
        RvNode::Transform { base, .. } => validate_semantics(base)?,
    }

    if let Some(declared) = node.declared() {
        let computed = capabilities(node)?;
        if declared != computed {
            return Err(RvError::CapabilityMismatch(format!(
                "declared {declared:?} != computed {computed:?}"
            )));
        }
    }
    Ok(())
}

/// Serialize a model node back to a wire document object, emitting recomputed capabilities.
pub fn to_value(node: &RvNode) -> Result<Value> {
    let caps = serde_json::to_value(capabilities(node)?).unwrap();
    Ok(match node {
        RvNode::Leaf { dist, params, support, .. } => {
            let mut obj = json!({ "kind": "leaf", "dist": dist, "params": params, "capabilities": caps });
            if let Some(s) = support {
                obj["support"] = support_value(s);
            }
            obj
        }
        RvNode::Joint { dims, .. } => {
            let ds: Vec<Value> = dims.iter().map(to_value).collect::<Result<_>>()?;
            json!({ "kind": "joint", "dims": ds, "capabilities": caps })
        }
        RvNode::Mixture { weights, components, .. } => {
            let cs: Vec<Value> = components.iter().map(to_value).collect::<Result<_>>()?;
            json!({ "kind": "mixture", "weights": weights, "components": cs, "capabilities": caps })
        }
        RvNode::Transform { base, op, .. } => {
            json!({ "kind": "transform", "base": to_value(base)?, "op": op.to_json(), "capabilities": caps })
        }
    })
}

/// Serialize a full document (`format_version` + optional `metadata` + `rv`).
pub fn to_document(node: &RvNode, format_version: &str, metadata: Option<Value>) -> Result<Value> {
    let mut doc = json!({ "format_version": format_version, "rv": to_value(node)? });
    if let Some(m) = metadata {
        doc["metadata"] = m;
    }
    Ok(doc)
}

fn support_value(s: &Support) -> Value {
    let mut obj = json!({ "lower_inclusive": s.lower_inclusive, "upper_inclusive": s.upper_inclusive });
    if let Some(l) = s.lower {
        obj["lower"] = json!(l);
    }
    if let Some(u) = s.upper {
        obj["upper"] = json!(u);
    }
    obj
}

fn check_weights(weights: &[f64], label: &str) -> Result<()> {
    if weights.iter().any(|&w| w < 0.0) {
        return Err(RvError::Validation(format!("{label} must be non-negative")));
    }
    let sum: f64 = weights.iter().sum();
    if (sum - 1.0).abs() > WEIGHT_TOL {
        return Err(RvError::Validation(format!("{label} must sum to 1 (got {sum})")));
    }
    Ok(())
}

fn f64_array(params: &Value, key: &str) -> Result<Vec<f64>> {
    params
        .get(key)
        .and_then(Value::as_array)
        .map(|a| a.iter().filter_map(Value::as_f64).collect())
        .ok_or_else(|| RvError::Validation(format!("expected numeric array '{key}'")))
}
