//! Transform ops as an exact ADT (`enum Op`).
//!
//! Each op is `Y = forward(X)`. Invertible+differentiable ops support change-of-variables for
//! log_prob; monotone ops support cdf composition. The non-invertible op (`abs`) supports neither
//! and degrades the transform's capabilities accordingly (SPEC.md §5.3, §8.4).

use crate::errors::{Result, RvError};
use std::collections::HashMap;

#[derive(Debug, Clone, PartialEq)]
pub enum Op {
    Affine { a: f64, b: f64 },
    Exp,
    Log,
    Pow { exponent: f64 },
    Abs,
}

impl Op {
    pub fn build(name: &str, params: &HashMap<String, f64>) -> Result<Op> {
        // Exact set of params each op accepts. exp/log/abs take none; unexpected keys are rejected
        // rather than silently ignored (SPEC.md §5.3) - a malformed op MUST NOT be misread.
        let allowed: &[&str] = match name {
            "affine" => &["a", "b"],
            "pow" => &["exponent"],
            "exp" | "log" | "abs" => &[],
            other => return Err(RvError::Validation(format!("unknown transform op '{other}'"))),
        };
        if let Some(extra) = params.keys().find(|k| !allowed.contains(&k.as_str())) {
            return Err(RvError::Validation(format!(
                "op '{name}' got unexpected param '{extra}'"
            )));
        }
        let need = |k: &str| -> Result<f64> {
            params
                .get(k)
                .copied()
                .ok_or_else(|| RvError::Validation(format!("op '{name}' requires param '{k}'")))
        };
        match name {
            "affine" => Ok(Op::Affine { a: need("a")?, b: need("b")? }),
            "exp" => Ok(Op::Exp),
            "log" => Ok(Op::Log),
            "pow" => Ok(Op::Pow { exponent: need("exponent")? }),
            "abs" => Ok(Op::Abs),
            _ => unreachable!("op name already validated above"),
        }
    }

    pub fn name(&self) -> &'static str {
        match self {
            Op::Affine { .. } => "affine",
            Op::Exp => "exp",
            Op::Log => "log",
            Op::Pow { .. } => "pow",
            Op::Abs => "abs",
        }
    }

    pub fn invertible(&self) -> bool {
        !matches!(self, Op::Abs)
    }

    /// Monotone direction: `Some(true)` increasing, `Some(false)` decreasing, `None` if not monotone.
    pub fn increasing(&self) -> Option<bool> {
        match self {
            Op::Affine { a, .. } => Some(*a > 0.0),
            Op::Exp | Op::Log => Some(true),
            Op::Pow { exponent } => Some(*exponent > 0.0),
            Op::Abs => None,
        }
    }

    pub fn monotone(&self) -> bool {
        self.increasing().is_some()
    }

    pub fn forward(&self, x: f64) -> f64 {
        match self {
            Op::Affine { a, b } => a * x + b,
            Op::Exp => x.exp(),
            Op::Log => x.ln(),
            Op::Pow { exponent } => x.powf(*exponent),
            Op::Abs => x.abs(),
        }
    }

    pub fn inverse(&self, y: f64) -> Result<f64> {
        match self {
            Op::Affine { a, b } => Ok((y - b) / a),
            Op::Exp => Ok(y.ln()),
            Op::Log => Ok(y.exp()),
            Op::Pow { exponent } => Ok(y.powf(1.0 / exponent)),
            Op::Abs => Err(RvError::NotInvertible("op 'abs' is not invertible".into())),
        }
    }

    /// log |d/dy inverse(y)| - the change-of-variables Jacobian term.
    pub fn log_abs_dinverse(&self, y: f64) -> Result<f64> {
        match self {
            Op::Affine { a, .. } => Ok(-a.abs().ln()),
            Op::Exp => Ok(-y.ln()),
            Op::Log => Ok(y),
            Op::Pow { exponent } => {
                let p = *exponent;
                Ok((1.0 / p).abs().ln() + (1.0 / p - 1.0) * y.ln())
            }
            Op::Abs => Err(RvError::NotInvertible("op 'abs' has no inverse Jacobian".into())),
        }
    }

    /// Serialize back to the wire `{ "name", "params"? }` form.
    pub fn to_json(&self) -> serde_json::Value {
        use serde_json::json;
        match self {
            Op::Affine { a, b } => json!({ "name": "affine", "params": { "a": a, "b": b } }),
            Op::Pow { exponent } => json!({ "name": "pow", "params": { "exponent": exponent } }),
            _ => json!({ "name": self.name() }),
        }
    }
}
