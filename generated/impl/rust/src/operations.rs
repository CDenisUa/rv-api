//! Operations over the RV tree.
//!
//! A declarative `RvNode` document is *compiled* into a `Prepared` evaluator that owns its built
//! leaf distributions. Compiling once and evaluating many times means a KS sweep over 200k points
//! does not rebuild the empirical KDE per call. Capability recomputation stays a structural pass on
//! `RvNode` (used during parse-time validation). Both match exhaustively on the ADT.

use crate::distributions::{create, Distribution};
use crate::errors::{Result, RvError};
use crate::model::{Capabilities, RvNode};
use crate::numerics::{log_sum_exp, AliasSampler};
use crate::ops::Op;
use crate::rng::Rng;

const NEG_INF: f64 = f64::NEG_INFINITY;

/// Sample output: univariate nodes yield a flat vector; Joint yields one vector per dimension.
#[derive(Debug, Clone, PartialEq)]
pub enum Samples {
    Univariate(Vec<f64>),
    Joint(Vec<Vec<f64>>),
}

/// A moment value: scalar for univariate RVs, per-dimension vector for Joint.
#[derive(Debug, Clone, PartialEq)]
pub enum Moment {
    Scalar(f64),
    Vector(Vec<f64>),
}

/// Recompute capabilities bottom-up (SPEC.md §7). Structural; used by parse-time validation.
pub fn capabilities(node: &RvNode) -> Result<Capabilities> {
    match node {
        RvNode::Leaf { dist, params, .. } => Ok(create(dist, params)?.capabilities()),
        RvNode::Joint { dims, .. } => and_caps(dims),
        RvNode::Mixture { components, .. } => and_caps(components),
        RvNode::Transform { base, op, .. } => {
            let b = capabilities(base)?;
            Ok(Capabilities {
                can_sample: b.can_sample,
                can_log_prob: b.can_log_prob && op.invertible(),
                can_cdf: b.can_cdf && op.monotone(),
            })
        }
    }
}

fn and_caps(children: &[RvNode]) -> Result<Capabilities> {
    let mut acc = Capabilities::ALL;
    for c in children {
        let cap = capabilities(c)?;
        acc.can_sample &= cap.can_sample;
        acc.can_log_prob &= cap.can_log_prob;
        acc.can_cdf &= cap.can_cdf;
    }
    Ok(acc)
}

/// A compiled evaluator that owns its built distributions (build once, evaluate many).
pub enum Prepared {
    Leaf(Box<dyn Distribution>),
    Joint(Vec<Prepared>),
    Mixture { weights: Vec<f64>, comps: Vec<Prepared> },
    Transform { base: Box<Prepared>, op: Op },
}

impl Prepared {
    pub fn compile(node: &RvNode) -> Result<Prepared> {
        match node {
            RvNode::Leaf { dist, params, .. } => Ok(Prepared::Leaf(create(dist, params)?)),
            RvNode::Joint { dims, .. } => {
                Ok(Prepared::Joint(dims.iter().map(Prepared::compile).collect::<Result<_>>()?))
            }
            RvNode::Mixture { weights, components, .. } => Ok(Prepared::Mixture {
                weights: weights.clone(),
                comps: components.iter().map(Prepared::compile).collect::<Result<_>>()?,
            }),
            RvNode::Transform { base, op, .. } => Ok(Prepared::Transform {
                base: Box::new(Prepared::compile(base)?),
                op: op.clone(),
            }),
        }
    }

    /// Evaluate log-density/mass at `x` (a scalar slice; a vector for Joint).
    pub fn log_prob(&self, x: &[f64]) -> Result<f64> {
        match self {
            Prepared::Leaf(d) => Ok(d.log_prob(x[0])),
            Prepared::Joint(dims) => {
                let mut sum = 0.0;
                for (i, dim) in dims.iter().enumerate() {
                    sum += dim.log_prob(&x[i..i + 1])?;
                }
                Ok(sum)
            }
            Prepared::Mixture { weights, comps } => {
                let mut terms = Vec::with_capacity(comps.len());
                for (w, c) in weights.iter().zip(comps) {
                    terms.push(w.ln() + c.log_prob(x)?);
                }
                Ok(log_sum_exp(&terms))
            }
            Prepared::Transform { base, op } => {
                if !op.invertible() {
                    return Err(RvError::Capability(format!(
                        "log_prob unavailable: op '{}' is not invertible",
                        op.name()
                    )));
                }
                let y = x[0];
                let x_inv = op.inverse(y)?;
                let base_lp = base.log_prob(&[x_inv])?;
                let out = base_lp + op.log_abs_dinverse(y)?;
                Ok(if out.is_finite() { out } else { NEG_INF })
            }
        }
    }

    /// Evaluate P(X ≤ x).
    pub fn cdf(&self, x: &[f64]) -> Result<f64> {
        match self {
            Prepared::Leaf(d) => Ok(d.cdf(x[0])),
            Prepared::Joint(dims) => {
                let mut prod = 1.0;
                for (i, dim) in dims.iter().enumerate() {
                    prod *= dim.cdf(&x[i..i + 1])?;
                }
                Ok(prod)
            }
            Prepared::Mixture { weights, comps } => {
                let mut sum = 0.0;
                for (w, c) in weights.iter().zip(comps) {
                    sum += w * c.cdf(x)?;
                }
                Ok(sum)
            }
            Prepared::Transform { base, op } => {
                let increasing = op.increasing().ok_or_else(|| {
                    RvError::Capability(format!("cdf unavailable: op '{}' is not monotonic", op.name()))
                })?;
                let x_inv = op.inverse(x[0])?;
                if x_inv.is_nan() {
                    // Points below the op's image map to the appropriate tail (e.g. exp(x) ≤ 0 → 0).
                    return Ok(if increasing { 0.0 } else { 1.0 });
                }
                let base_cdf = base.cdf(&[x_inv])?;
                Ok(if increasing { base_cdf } else { 1.0 - base_cdf })
            }
        }
    }

    /// Draw `n` samples.
    pub fn sample(&self, rng: &mut Rng, n: usize) -> Samples {
        match self {
            Prepared::Leaf(d) => Samples::Univariate(d.sample(rng, n)),
            Prepared::Joint(dims) => Samples::Joint(
                dims.iter()
                    .map(|d| match d.sample(rng, n) {
                        Samples::Univariate(v) => v,
                        Samples::Joint(_) => unreachable!("nested joint is out of v1 scope"),
                    })
                    .collect(),
            ),
            Prepared::Mixture { weights, comps } => {
                // Bucket draw positions by component in one O(n) pass, then sample each component
                // once and scatter back - O(n + k) rather than scanning all n per component.
                let idx = AliasSampler::new(weights).sample(rng, n);
                let mut buckets: Vec<Vec<usize>> = vec![Vec::new(); comps.len()];
                for (j, &c) in idx.iter().enumerate() {
                    buckets[c].push(j);
                }
                let mut out = vec![0.0; n];
                for (comp, positions) in comps.iter().zip(&buckets) {
                    if positions.is_empty() {
                        continue;
                    }
                    if let Samples::Univariate(drawn) = comp.sample(rng, positions.len()) {
                        for (&pos, &value) in positions.iter().zip(&drawn) {
                            out[pos] = value;
                        }
                    }
                }
                Samples::Univariate(out)
            }
            Prepared::Transform { base, op } => {
                if let Samples::Univariate(v) = base.sample(rng, n) {
                    Samples::Univariate(v.into_iter().map(|x| op.forward(x)).collect())
                } else {
                    unreachable!("transform of joint is out of v1 scope")
                }
            }
        }
    }

    /// Closed-form (mean, variance) where known; `MomentsNotAvailable` otherwise.
    pub fn moments(&self) -> Result<(Moment, Moment)> {
        match self {
            Prepared::Leaf(d) => {
                let (m, v) = d.moments();
                Ok((Moment::Scalar(m), Moment::Scalar(v)))
            }
            Prepared::Joint(dims) => {
                let mut means = Vec::with_capacity(dims.len());
                let mut vars = Vec::with_capacity(dims.len());
                for dim in dims {
                    let (m, v) = dim.moments()?;
                    means.push(scalar(m)?);
                    vars.push(scalar(v)?);
                }
                Ok((Moment::Vector(means), Moment::Vector(vars)))
            }
            Prepared::Mixture { weights, comps } => {
                let mut mean = 0.0;
                let mut ex2 = 0.0;
                for (w, c) in weights.iter().zip(comps) {
                    let (m, v) = c.moments()?;
                    let (m, v) = (scalar(m)?, scalar(v)?);
                    mean += w * m;
                    ex2 += w * (v + m * m);
                }
                Ok((Moment::Scalar(mean), Moment::Scalar(ex2 - mean * mean)))
            }
            Prepared::Transform { base, op } => {
                if let Op::Affine { a, b } = op {
                    let (m, v) = base.moments()?;
                    let (m, v) = (scalar(m)?, scalar(v)?);
                    Ok((Moment::Scalar(a * m + b), Moment::Scalar(a * a * v)))
                } else {
                    Err(RvError::MomentsNotAvailable(format!(
                        "no closed-form moments for transform op '{}'",
                        op.name()
                    )))
                }
            }
        }
    }
}

fn scalar(m: Moment) -> Result<f64> {
    match m {
        Moment::Scalar(v) => Ok(v),
        Moment::Vector(_) => Err(RvError::Validation("expected scalar moment".into())),
    }
}

// --- One-shot convenience wrappers (compile then evaluate) -----------------------------------

pub fn log_prob(node: &RvNode, x: &[f64]) -> Result<f64> {
    Prepared::compile(node)?.log_prob(x)
}

pub fn cdf(node: &RvNode, x: &[f64]) -> Result<f64> {
    Prepared::compile(node)?.cdf(x)
}

pub fn sample(node: &RvNode, rng: &mut Rng, n: usize) -> Result<Samples> {
    Ok(Prepared::compile(node)?.sample(rng, n))
}

pub fn moments(node: &RvNode) -> Result<(Moment, Moment)> {
    Prepared::compile(node)?.moments()
}
