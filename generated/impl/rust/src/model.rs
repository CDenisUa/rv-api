//! Core model: the random-variable ADT as a Rust `enum` (the exact algebraic-data-type encoding).
//!
//! Operations match exhaustively on this enum (see operations.rs); the compiler enforces that adding
//! a variant forces every operation to handle it. Capability propagation is a real correctness
//! concern: a non-invertible Transform loses `can_log_prob` (SPEC.md §7).

use crate::ops::Op;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct Capabilities {
    pub can_sample: bool,
    pub can_log_prob: bool,
    pub can_cdf: bool,
}

impl Capabilities {
    pub const ALL: Capabilities = Capabilities {
        can_sample: true,
        can_log_prob: true,
        can_cdf: true,
    };
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Support {
    pub lower: Option<f64>,
    pub upper: Option<f64>,
    pub lower_inclusive: bool,
    pub upper_inclusive: bool,
}

/// A random-variable node: the recursive tagged union over four semantic kinds.
#[derive(Debug, Clone)]
pub enum RvNode {
    Leaf {
        dist: String,
        /// Canonical parameters as the original wire object (read by the distribution catalog).
        params: serde_json::Value,
        support: Option<Support>,
        declared: Option<Capabilities>,
    },
    Joint {
        dims: Vec<RvNode>,
        declared: Option<Capabilities>,
    },
    Mixture {
        weights: Vec<f64>,
        components: Vec<RvNode>,
        declared: Option<Capabilities>,
    },
    Transform {
        base: Box<RvNode>,
        op: Op,
        declared: Option<Capabilities>,
    },
}

impl RvNode {
    pub fn declared(&self) -> Option<Capabilities> {
        match self {
            RvNode::Leaf { declared, .. }
            | RvNode::Joint { declared, .. }
            | RvNode::Mixture { declared, .. }
            | RvNode::Transform { declared, .. } => *declared,
        }
    }

    pub fn kind(&self) -> &'static str {
        match self {
            RvNode::Leaf { .. } => "leaf",
            RvNode::Joint { .. } => "joint",
            RvNode::Mixture { .. } => "mixture",
            RvNode::Transform { .. } => "transform",
        }
    }
}
