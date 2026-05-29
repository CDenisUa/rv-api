//! Error type for the RV Exchange reference implementation.
//!
//! Mirrors the Python/TypeScript references so error semantics are portable across the three impls.

use std::fmt;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RvError {
    /// A document is structurally or semantically invalid.
    Validation(String),
    /// An operation was requested that the RV does not support (e.g. log_prob of a
    /// non-invertible transform).
    Capability(String),
    /// Declared capabilities contradict the capabilities recomputed from structure.
    CapabilityMismatch(String),
    /// No closed-form moments are available for this node (use sampling instead).
    MomentsNotAvailable(String),
    /// The transform op has no inverse, so change-of-variables is undefined.
    NotInvertible(String),
}

impl fmt::Display for RvError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            RvError::Validation(m) => write!(f, "validation error: {m}"),
            RvError::Capability(m) => write!(f, "capability error: {m}"),
            RvError::CapabilityMismatch(m) => write!(f, "capability mismatch: {m}"),
            RvError::MomentsNotAvailable(m) => write!(f, "moments not available: {m}"),
            RvError::NotInvertible(m) => write!(f, "not invertible: {m}"),
        }
    }
}

impl std::error::Error for RvError {}

pub type Result<T> = std::result::Result<T, RvError>;
