//! Shared statistical helpers for the integration tests (conformance + properties).
//!
//! Each test binary links this module independently, so not every binary uses every helper.
#![allow(dead_code)]

/// One-sample Kolmogorov-Smirnov statistic of `xs` against the continuous CDF `cdf`.
pub fn ks_statistic(xs: &[f64], cdf: impl Fn(f64) -> f64) -> f64 {
    let mut sorted = xs.to_vec();
    sorted.sort_by(|a, b| a.partial_cmp(b).unwrap());
    let n = sorted.len() as f64;
    let mut d: f64 = 0.0;
    for (i, &x) in sorted.iter().enumerate() {
        let f = cdf(x);
        d = d.max((i as f64 + 1.0) / n - f).max(f - i as f64 / n);
    }
    d
}

/// Population mean and variance (ddof = 0).
pub fn population_stats(xs: &[f64]) -> (f64, f64) {
    let n = xs.len() as f64;
    let mean = xs.iter().sum::<f64>() / n;
    let var = xs.iter().map(|&x| (x - mean) * (x - mean)).sum::<f64>() / n;
    (mean, var)
}
