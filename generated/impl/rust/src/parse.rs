//! Document ↔ model conversion plus semantic validation (SPEC.md §6.2).
//!
//! serde deserializes the wire document into a `Raw*` representation (structural stage); this module
//! then builds the model and runs the semantic stage: weight/alignment rules, parameter sanity (via
//! distribution construction), and capability re-validation - declared MUST equal recomputed.

use crate::distributions::{create, Distribution, DISCRETE_DISTS};
use crate::errors::{Result, RvError};
use crate::model::{Capabilities, RvNode, Support};
use crate::operations::capabilities;
use crate::ops::Op;
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::HashMap;

const WEIGHT_TOL: f64 = 1e-9;

/// Highest format MAJOR this implementation understands. A document whose MAJOR exceeds this MUST be
/// rejected rather than silently misinterpreted (SPEC.md §9).
pub const SUPPORTED_FORMAT_MAJOR: u64 = 1;

#[derive(Deserialize)]
struct RawDocument {
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
    check_format_version(&doc.format_version)?;
    let node = build(doc.rv)?;
    validate_semantics(&node)?;
    Ok(node)
}

/// Reject a document whose format MAJOR exceeds what we implement (SPEC.md §9).
fn check_format_version(version: &str) -> Result<()> {
    let major: u64 = version
        .split('.')
        .next()
        .and_then(|s| s.parse().ok())
        .ok_or_else(|| RvError::Validation(format!("malformed format_version: {version:?}")))?;
    if major > SUPPORTED_FORMAT_MAJOR {
        return Err(RvError::Validation(format!(
            "unsupported format_version {version}: MAJOR {major} exceeds supported {SUPPORTED_FORMAT_MAJOR}"
        )));
    }
    Ok(())
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
        RvNode::Leaf { dist, params, support, .. } => {
            // Constructing the distribution validates parameters (and, for empirical, the bulk_ref).
            let d = create(dist, params)?;
            if dist == "categorical" {
                let probs = f64_array(params, "probs")?;
                let categories = f64_array(params, "categories")?;
                check_weights(&probs, "categorical probs")?;
                if categories.len() != probs.len() {
                    return Err(RvError::Validation("categorical categories/probs length mismatch".into()));
                }
            }
            if let Some(s) = support {
                check_support_consistency(s, d.as_ref())?;
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
        RvNode::Transform { base, .. } => {
            if contains_discrete_leaf(base) {
                return Err(RvError::Validation(
                    "transform over a discrete base is invalid: change-of-variables applies to \
                     densities, not masses (SPEC.md §4.4)"
                        .into(),
                ));
            }
            validate_semantics(base)?;
        }
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

/// A declared support MUST NOT extend beyond the distribution's natural support (SPEC.md §6.1).
fn check_support_consistency(support: &Support, dist: &dyn Distribution) -> Result<()> {
    let (nat_lower, nat_upper) = dist.support();
    if let Some(lower) = support.lower {
        if lower < nat_lower - bound_tol(nat_lower) {
            return Err(RvError::Validation(format!(
                "declared support lower {lower} is below the distribution's natural lower bound {nat_lower}"
            )));
        }
    }
    if let Some(upper) = support.upper {
        if upper > nat_upper + bound_tol(nat_upper) {
            return Err(RvError::Validation(format!(
                "declared support upper {upper} is above the distribution's natural upper bound {nat_upper}"
            )));
        }
    }
    Ok(())
}

fn bound_tol(bound: f64) -> f64 {
    if bound.is_finite() {
        1e-9 * (1.0 + bound.abs())
    } else {
        0.0
    }
}

fn contains_discrete_leaf(node: &RvNode) -> bool {
    match node {
        RvNode::Leaf { dist, .. } => DISCRETE_DISTS.contains(&dist.as_str()),
        RvNode::Joint { dims, .. } => dims.iter().any(contains_discrete_leaf),
        RvNode::Mixture { components, .. } => components.iter().any(contains_discrete_leaf),
        RvNode::Transform { base, .. } => contains_discrete_leaf(base),
    }
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
