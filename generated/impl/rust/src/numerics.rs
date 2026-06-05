//! Numerically-careful primitives used across operations.
//!  - `log_sum_exp`: stable log(Σ exp(a)) for mixture log-prob (SPEC.md §8.3).
//!  - `AliasSampler`: Vose's alias method, O(1) per draw after O(k) setup (SPEC.md §8.3, §8.6).

use crate::rng::Rng;

/// log(Σ exp(vᵢ)) computed as m + log(Σ exp(vᵢ − m)), m = max(v). Avoids overflow/underflow.
/// Treats −∞ entries correctly; returns −∞ when every entry is −∞.
pub fn log_sum_exp(values: &[f64]) -> f64 {
    let mut m = f64::NEG_INFINITY;
    for &v in values {
        if v > m {
            m = v;
        }
    }
    if !m.is_finite() {
        return m; // all −∞ → −∞; +∞ → +∞
    }
    let sum: f64 = values.iter().map(|&v| (v - m).exp()).sum();
    m + sum.ln()
}

/// Vose's alias method for sampling from a finite categorical distribution.
/// Setup is O(k); each draw is O(1). Returns category *indices*.
pub struct AliasSampler {
    k: usize,
    prob: Vec<f64>,
    alias: Vec<usize>,
}

impl AliasSampler {
    pub fn new(weights: &[f64]) -> Self {
        let total: f64 = weights.iter().sum();
        assert!(weights.iter().all(|&w| w >= 0.0), "weights must be non-negative");
        assert!(total > 0.0, "weights must sum to a positive value");

        let k = weights.len();
        let mut prob = vec![0.0; k];
        let mut alias = vec![0usize; k];
        let mut scaled: Vec<f64> = weights.iter().map(|&w| w * k as f64 / total).collect();

        let mut small: Vec<usize> = Vec::new();
        let mut large: Vec<usize> = Vec::new();
        for (i, &s) in scaled.iter().enumerate() {
            if s < 1.0 {
                small.push(i);
            } else {
                large.push(i);
            }
        }
        // Pop from both worklists only when each has an element; popping `large` unconditionally
        // (e.g. via `while let (Some, Some)`) would discard an index when `small` is already empty.
        while !small.is_empty() && !large.is_empty() {
            let s = small.pop().unwrap();
            let l = large.pop().unwrap();
            prob[s] = scaled[s];
            alias[s] = l;
            scaled[l] = scaled[l] + scaled[s] - 1.0;
            if scaled[l] < 1.0 {
                small.push(l);
            } else {
                large.push(l);
            }
        }
        for i in large.into_iter().chain(small) {
            prob[i] = 1.0;
        }
        AliasSampler { k, prob, alias }
    }

    /// Draw `n` category indices.
    pub fn sample(&self, rng: &mut Rng, n: usize) -> Vec<usize> {
        (0..n)
            .map(|_| {
                let col = rng.int(self.k);
                if rng.uniform() < self.prob[col] {
                    col
                } else {
                    self.alias[col]
                }
            })
            .collect()
    }
}
