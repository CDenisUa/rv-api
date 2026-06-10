//! Leaf distribution catalog (factory keyed by name).
//!
//! Each distribution is created by name from canonical, library-independent parameters (SPEC.md §5)
//! and exposes a uniform trait (`Distribution`). The analytic leaves implement the same closed forms
//! scipy.stats uses, via the special functions in `special.rs` - so the Rust core reproduces the
//! conformance golden to 1e-9 without any scientific dependency.

use crate::bulk;
use crate::errors::{Result, RvError};
use crate::model::Capabilities;
use crate::numerics::AliasSampler;
use crate::rng::Rng;
use crate::special::{lgamma, normal_cdf, reg_inc_beta, reg_lower_gamma};
use serde_json::Value;

const LOG_2PI: f64 = 1.837_877_066_409_345_5; // ln(2π)
const NEG_INF: f64 = f64::NEG_INFINITY;

pub trait Distribution {
    fn log_prob(&self, x: f64) -> f64;
    fn cdf(&self, x: f64) -> f64;
    fn sample(&self, rng: &mut Rng, n: usize) -> Vec<f64>;
    fn moments(&self) -> (f64, f64);
    fn capabilities(&self) -> Capabilities {
        Capabilities::ALL
    }
    /// Natural support as (lower, upper); ±inf when unbounded (SPEC.md §5.1, §6.1).
    fn support(&self) -> (f64, f64) {
        (f64::NEG_INFINITY, f64::INFINITY)
    }
}

struct Normal {
    mu: f64,
    sigma: f64,
}
impl Distribution for Normal {
    fn log_prob(&self, x: f64) -> f64 {
        let z = (x - self.mu) / self.sigma;
        -self.sigma.ln() - 0.5 * LOG_2PI - 0.5 * z * z
    }
    fn cdf(&self, x: f64) -> f64 {
        normal_cdf((x - self.mu) / self.sigma)
    }
    fn sample(&self, rng: &mut Rng, n: usize) -> Vec<f64> {
        (0..n).map(|_| self.mu + self.sigma * rng.normal()).collect()
    }
    fn moments(&self) -> (f64, f64) {
        (self.mu, self.sigma * self.sigma)
    }
}

struct LogNormal {
    mu: f64,
    sigma: f64,
}
impl Distribution for LogNormal {
    fn log_prob(&self, x: f64) -> f64 {
        if x <= 0.0 {
            return NEG_INF;
        }
        let z = (x.ln() - self.mu) / self.sigma;
        -x.ln() - self.sigma.ln() - 0.5 * LOG_2PI - 0.5 * z * z
    }
    fn cdf(&self, x: f64) -> f64 {
        if x <= 0.0 {
            0.0
        } else {
            normal_cdf((x.ln() - self.mu) / self.sigma)
        }
    }
    fn sample(&self, rng: &mut Rng, n: usize) -> Vec<f64> {
        (0..n).map(|_| (self.mu + self.sigma * rng.normal()).exp()).collect()
    }
    fn moments(&self) -> (f64, f64) {
        let s2 = self.sigma * self.sigma;
        let mean = (self.mu + s2 / 2.0).exp();
        let var = (s2.exp() - 1.0) * (2.0 * self.mu + s2).exp();
        (mean, var)
    }
    fn support(&self) -> (f64, f64) {
        (0.0, f64::INFINITY)
    }
}

struct Weibull {
    shape: f64,
    scale: f64,
}
impl Distribution for Weibull {
    fn log_prob(&self, x: f64) -> f64 {
        let (k, lam) = (self.shape, self.scale);
        if x < 0.0 {
            return NEG_INF;
        }
        if x == 0.0 {
            return if k > 1.0 {
                NEG_INF
            } else if k == 1.0 {
                -lam.ln()
            } else {
                f64::INFINITY
            };
        }
        k.ln() - lam.ln() + (k - 1.0) * (x.ln() - lam.ln()) - (x / lam).powf(k)
    }
    fn cdf(&self, x: f64) -> f64 {
        if x <= 0.0 {
            0.0
        } else {
            1.0 - (-(x / self.scale).powf(self.shape)).exp()
        }
    }
    fn sample(&self, rng: &mut Rng, n: usize) -> Vec<f64> {
        (0..n)
            .map(|_| self.scale * rng.standard_exponential().powf(1.0 / self.shape))
            .collect()
    }
    fn moments(&self) -> (f64, f64) {
        let g1 = lgamma(1.0 + 1.0 / self.shape).exp();
        let g2 = lgamma(1.0 + 2.0 / self.shape).exp();
        (self.scale * g1, self.scale * self.scale * (g2 - g1 * g1))
    }
    fn support(&self) -> (f64, f64) {
        (0.0, f64::INFINITY)
    }
}

struct Uniform {
    low: f64,
    high: f64,
}
impl Distribution for Uniform {
    fn log_prob(&self, x: f64) -> f64 {
        if x >= self.low && x <= self.high {
            -(self.high - self.low).ln()
        } else {
            NEG_INF
        }
    }
    fn cdf(&self, x: f64) -> f64 {
        if x < self.low {
            0.0
        } else if x > self.high {
            1.0
        } else {
            (x - self.low) / (self.high - self.low)
        }
    }
    fn sample(&self, rng: &mut Rng, n: usize) -> Vec<f64> {
        (0..n).map(|_| rng.range(self.low, self.high)).collect()
    }
    fn moments(&self) -> (f64, f64) {
        let w = self.high - self.low;
        ((self.low + self.high) / 2.0, w * w / 12.0)
    }
    fn support(&self) -> (f64, f64) {
        (self.low, self.high)
    }
}

struct Exponential {
    rate: f64,
}
impl Distribution for Exponential {
    fn log_prob(&self, x: f64) -> f64 {
        if x < 0.0 {
            NEG_INF
        } else {
            self.rate.ln() - self.rate * x
        }
    }
    fn cdf(&self, x: f64) -> f64 {
        if x < 0.0 {
            0.0
        } else {
            1.0 - (-self.rate * x).exp()
        }
    }
    fn sample(&self, rng: &mut Rng, n: usize) -> Vec<f64> {
        (0..n).map(|_| rng.standard_exponential() / self.rate).collect()
    }
    fn moments(&self) -> (f64, f64) {
        (1.0 / self.rate, 1.0 / (self.rate * self.rate))
    }
    fn support(&self) -> (f64, f64) {
        (0.0, f64::INFINITY)
    }
}

struct Gamma {
    shape: f64,
    scale: f64,
}
impl Distribution for Gamma {
    fn log_prob(&self, x: f64) -> f64 {
        let (a, th) = (self.shape, self.scale);
        if x < 0.0 {
            return NEG_INF;
        }
        if x == 0.0 {
            return if a < 1.0 {
                f64::INFINITY
            } else if a == 1.0 {
                -th.ln()
            } else {
                NEG_INF
            };
        }
        -lgamma(a) - a * th.ln() + (a - 1.0) * x.ln() - x / th
    }
    fn cdf(&self, x: f64) -> f64 {
        if x <= 0.0 {
            0.0
        } else {
            reg_lower_gamma(self.shape, x / self.scale)
        }
    }
    fn sample(&self, rng: &mut Rng, n: usize) -> Vec<f64> {
        (0..n).map(|_| self.scale * rng.standard_gamma(self.shape)).collect()
    }
    fn moments(&self) -> (f64, f64) {
        (self.shape * self.scale, self.shape * self.scale * self.scale)
    }
    fn support(&self) -> (f64, f64) {
        (0.0, f64::INFINITY)
    }
}

struct Beta {
    alpha: f64,
    beta: f64,
    log_b: f64,
}
impl Beta {
    fn new(alpha: f64, beta: f64) -> Self {
        let log_b = lgamma(alpha) + lgamma(beta) - lgamma(alpha + beta);
        Beta { alpha, beta, log_b }
    }
}
impl Distribution for Beta {
    fn log_prob(&self, x: f64) -> f64 {
        if x <= 0.0 || x >= 1.0 {
            return NEG_INF;
        }
        (self.alpha - 1.0) * x.ln() + (self.beta - 1.0) * (1.0 - x).ln() - self.log_b
    }
    fn cdf(&self, x: f64) -> f64 {
        reg_inc_beta(self.alpha, self.beta, x)
    }
    fn sample(&self, rng: &mut Rng, n: usize) -> Vec<f64> {
        (0..n)
            .map(|_| {
                let ga = rng.standard_gamma(self.alpha);
                let gb = rng.standard_gamma(self.beta);
                ga / (ga + gb)
            })
            .collect()
    }
    fn moments(&self) -> (f64, f64) {
        let s = self.alpha + self.beta;
        (self.alpha / s, self.alpha * self.beta / (s * s * (s + 1.0)))
    }
    fn support(&self) -> (f64, f64) {
        (0.0, 1.0)
    }
}

struct Categorical {
    categories: Vec<f64>,
    probs: Vec<f64>,
    cats_sorted: Vec<f64>,
    cum_sorted: Vec<f64>,
    alias: AliasSampler,
}
impl Categorical {
    fn new(categories: Vec<f64>, probs: Vec<f64>) -> Self {
        let mut order: Vec<usize> = (0..categories.len()).collect();
        order.sort_by(|&i, &j| categories[i].partial_cmp(&categories[j]).unwrap());
        let cats_sorted: Vec<f64> = order.iter().map(|&i| categories[i]).collect();
        let mut acc = 0.0;
        let cum_sorted: Vec<f64> = order
            .iter()
            .map(|&i| {
                acc += probs[i];
                acc
            })
            .collect();
        let alias = AliasSampler::new(&probs);
        Categorical { categories, probs, cats_sorted, cum_sorted, alias }
    }
}
impl Distribution for Categorical {
    fn log_prob(&self, x: f64) -> f64 {
        for (c, p) in self.categories.iter().zip(&self.probs) {
            if (x - c).abs() <= 1e-8 + 1e-5 * c.abs() {
                return p.ln();
            }
        }
        NEG_INF
    }
    fn cdf(&self, x: f64) -> f64 {
        // Count of categories ≤ x (upper_bound); cumulative prob up to that index.
        let idx = self.cats_sorted.partition_point(|&c| c <= x);
        if idx == 0 {
            0.0
        } else {
            self.cum_sorted[idx - 1]
        }
    }
    fn sample(&self, rng: &mut Rng, n: usize) -> Vec<f64> {
        self.alias.sample(rng, n).into_iter().map(|i| self.categories[i]).collect()
    }
    fn moments(&self) -> (f64, f64) {
        let mean: f64 = self.categories.iter().zip(&self.probs).map(|(c, p)| c * p).sum();
        let var: f64 = self
            .categories
            .iter()
            .zip(&self.probs)
            .map(|(c, p)| p * (c - mean) * (c - mean))
            .sum();
        (mean, var)
    }
    fn support(&self) -> (f64, f64) {
        let lower = self.categories.iter().cloned().fold(f64::INFINITY, f64::min);
        let upper = self.categories.iter().cloned().fold(f64::NEG_INFINITY, f64::max);
        (lower, upper)
    }
}

/// Integer-snap tolerance for integer-valued discrete leaves (SPEC.md §5.1).
const INTEGER_SNAP_TOL: f64 = 1e-9;

/// Snap x to round(x) within tolerance; `None` signals "not an integer".
fn snap_integer(x: f64) -> Option<f64> {
    let k = x.round();
    if (x - k).abs() <= INTEGER_SNAP_TOL {
        Some(k)
    } else {
        None
    }
}

struct Poisson {
    rate: f64,
    log_rate: f64,
}
impl Distribution for Poisson {
    fn log_prob(&self, x: f64) -> f64 {
        match snap_integer(x) {
            Some(k) if k >= 0.0 => k * self.log_rate - self.rate - lgamma(k + 1.0),
            _ => NEG_INF,
        }
    }
    fn cdf(&self, x: f64) -> f64 {
        let k = snap_integer(x).unwrap_or(x).floor();
        if k < 0.0 {
            0.0
        } else {
            1.0 - reg_lower_gamma(k + 1.0, self.rate)
        }
    }
    fn sample(&self, rng: &mut Rng, n: usize) -> Vec<f64> {
        // Count standard-exponential arrivals until their sum exceeds rate - exact and
        // underflow-safe for any rate, unlike the classic exp(-rate) uniform-product loop.
        (0..n)
            .map(|_| {
                let mut k: f64 = -1.0;
                let mut acc = 0.0;
                while acc < self.rate {
                    acc += rng.standard_exponential();
                    k += 1.0;
                }
                k
            })
            .collect()
    }
    fn moments(&self) -> (f64, f64) {
        (self.rate, self.rate)
    }
    fn support(&self) -> (f64, f64) {
        (0.0, f64::INFINITY)
    }
}

struct Binomial {
    n: f64,
    p: f64,
    log_p: f64,
    log_1m_p: f64,
    log_choose_base: f64,
}
impl Binomial {
    fn new(n: f64, p: f64) -> Self {
        Binomial { n, p, log_p: p.ln(), log_1m_p: (-p).ln_1p(), log_choose_base: lgamma(n + 1.0) }
    }
}
impl Distribution for Binomial {
    fn log_prob(&self, x: f64) -> f64 {
        match snap_integer(x) {
            Some(k) if (0.0..=self.n).contains(&k) => {
                self.log_choose_base - lgamma(k + 1.0) - lgamma(self.n - k + 1.0)
                    + k * self.log_p
                    + (self.n - k) * self.log_1m_p
            }
            _ => NEG_INF,
        }
    }
    fn cdf(&self, x: f64) -> f64 {
        let k = snap_integer(x).unwrap_or(x).floor();
        if k < 0.0 {
            0.0
        } else if k >= self.n {
            1.0
        } else {
            reg_inc_beta(self.n - k, k + 1.0, 1.0 - self.p)
        }
    }
    fn sample(&self, rng: &mut Rng, n: usize) -> Vec<f64> {
        let trials = self.n as usize;
        (0..n)
            .map(|_| (0..trials).filter(|_| rng.uniform() < self.p).count() as f64)
            .collect()
    }
    fn moments(&self) -> (f64, f64) {
        (self.n * self.p, self.n * self.p * (1.0 - self.p))
    }
    fn support(&self) -> (f64, f64) {
        (0.0, self.n)
    }
}

struct Empirical {
    samples: Vec<f64>,
    sorted: Vec<f64>,
    mean: f64,
    cov: f64,
}
impl Empirical {
    fn new(samples: Vec<f64>) -> Self {
        let n = samples.len();
        let mut sorted = samples.clone();
        sorted.sort_by(|a, b| a.partial_cmp(b).unwrap());
        let mean = samples.iter().sum::<f64>() / n as f64;
        let ss: f64 = samples.iter().map(|&v| (v - mean) * (v - mean)).sum();
        // Scott's-rule bandwidth: h² = factor²·Var(ddof=1), factor = n^(−1/5) (SPEC.md §8.5).
        let var1 = ss / (n as f64 - 1.0);
        let factor = (n as f64).powf(-1.0 / 5.0);
        Empirical { samples, sorted, mean, cov: var1 * factor * factor }
    }
}
impl Distribution for Empirical {
    fn log_prob(&self, x: f64) -> f64 {
        let inv2cov = 0.5 / self.cov;
        let terms: Vec<f64> = self
            .samples
            .iter()
            .map(|&xi| {
                let d = x - xi;
                -d * d * inv2cov
            })
            .collect();
        crate::numerics::log_sum_exp(&terms)
            - (self.samples.len() as f64).ln()
            - 0.5 * (2.0 * std::f64::consts::PI * self.cov).ln()
    }
    fn cdf(&self, x: f64) -> f64 {
        self.sorted.partition_point(|&v| v <= x) as f64 / self.samples.len() as f64
    }
    fn sample(&self, rng: &mut Rng, n: usize) -> Vec<f64> {
        let len = self.samples.len();
        (0..n).map(|_| self.samples[rng.int(len)]).collect()
    }
    fn moments(&self) -> (f64, f64) {
        let ss: f64 = self.samples.iter().map(|&v| (v - self.mean) * (v - self.mean)).sum();
        (self.mean, ss / self.samples.len() as f64) // population variance (ddof=0)
    }
}

// --- Factory ---------------------------------------------------------------------------------

/// Leaves whose log_prob is a log-mass, not a log-density. A transform whose base subtree contains
/// one of these is invalid: change-of-variables applies to densities only (SPEC.md §4.4).
pub const DISCRETE_DISTS: [&str; 3] = ["categorical", "poisson", "binomial"];

/// Construct the leaf distribution named `dist` from its canonical params (validates parameters).
pub fn create(dist: &str, params: &Value) -> Result<Box<dyn Distribution>> {
    match dist {
        "normal" => Ok(Box::new(Normal { mu: num(params, "mu", dist)?, sigma: pos(params, "sigma", dist)? })),
        "lognormal" => Ok(Box::new(LogNormal { mu: num(params, "mu", dist)?, sigma: pos(params, "sigma", dist)? })),
        "weibull" => Ok(Box::new(Weibull { shape: pos(params, "shape", dist)?, scale: pos(params, "scale", dist)? })),
        "uniform" => {
            let low = num(params, "low", dist)?;
            let high = num(params, "high", dist)?;
            if high <= low {
                return Err(RvError::Validation("uniform requires high > low".into()));
            }
            Ok(Box::new(Uniform { low, high }))
        }
        "exponential" => Ok(Box::new(Exponential { rate: pos(params, "rate", dist)? })),
        "gamma" => Ok(Box::new(Gamma { shape: pos(params, "shape", dist)?, scale: pos(params, "scale", dist)? })),
        "beta" => Ok(Box::new(Beta::new(pos(params, "alpha", dist)?, pos(params, "beta", dist)?))),
        "categorical" => Ok(Box::new(Categorical::new(
            num_array(params, "categories", dist)?,
            num_array(params, "probs", dist)?,
        ))),
        "poisson" => {
            let rate = pos(params, "rate", dist)?;
            Ok(Box::new(Poisson { rate, log_rate: rate.ln() }))
        }
        "binomial" => {
            let n = num(params, "n", dist)?;
            if n.fract() != 0.0 || n < 1.0 {
                return Err(RvError::Validation("binomial requires integer n >= 1".into()));
            }
            let p = num(params, "p", dist)?;
            if p <= 0.0 || p >= 1.0 {
                return Err(RvError::Validation("binomial requires 0 < p < 1".into()));
            }
            Ok(Box::new(Binomial::new(n, p)))
        }
        "empirical" => {
            let samples = params
                .get("samples")
                .ok_or_else(|| RvError::Validation("empirical requires 'samples'".into()))?;
            Ok(Box::new(Empirical::new(bulk::decode(samples)?)))
        }
        other => Err(RvError::Validation(format!("unknown distribution '{other}'"))),
    }
}

fn num(params: &Value, key: &str, dist: &str) -> Result<f64> {
    params
        .get(key)
        .and_then(Value::as_f64)
        .ok_or_else(|| RvError::Validation(format!("distribution '{dist}' requires numeric param '{key}'")))
}

fn pos(params: &Value, key: &str, dist: &str) -> Result<f64> {
    let v = num(params, key, dist)?;
    if v <= 0.0 {
        return Err(RvError::Validation(format!("distribution '{dist}' param '{key}' must be > 0")));
    }
    Ok(v)
}

fn num_array(params: &Value, key: &str, dist: &str) -> Result<Vec<f64>> {
    params
        .get(key)
        .and_then(Value::as_array)
        .map(|a| a.iter().filter_map(Value::as_f64).collect::<Vec<f64>>())
        .filter(|v| !v.is_empty())
        .ok_or_else(|| RvError::Validation(format!("distribution '{dist}' requires numeric array '{key}'")))
}
