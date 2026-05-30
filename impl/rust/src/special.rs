//! Special functions needed to reproduce scipy.stats closed forms to ~1e-12.
//!
//! The conformance golden values were produced by scipy (the trusted reference). Without scipy in a
//! systems/WASM runtime we implement the same mathematics with comparable accuracy:
//!   - `lgamma`         - Lanczos approximation (≈1e-15).
//!   - `reg_lower_gamma`- regularized lower incomplete gamma P(a,x) via series + continued fraction.
//!   - `erf`            - derived from P(1/2, x²) (reuses the incomplete-gamma machinery).
//!   - `reg_inc_beta`   - regularized incomplete beta Iₓ(a,b) via Lentz continued fraction.
//!
//! Algorithms follow Numerical Recipes (gser/gcf/betacf); deterministic and well inside 1e-9.

const LANCZOS_G: f64 = 7.0;
const LANCZOS_C: [f64; 9] = [
    0.999_999_999_999_809_9,
    676.520_368_121_885_1,
    -1_259.139_216_722_402_8,
    771.323_428_777_653_1,
    -176.615_029_162_140_6,
    12.507_343_278_686_905,
    -0.138_571_095_265_720_12,
    9.984_369_578_019_572e-6,
    1.505_632_735_149_311_6e-7,
];

const ITMAX: usize = 300;
const EPS: f64 = 3e-16;
const FPMIN: f64 = 1e-300;

/// Natural log of the gamma function, valid for all real x (reflection for x < 0.5).
pub fn lgamma(x: f64) -> f64 {
    if x < 0.5 {
        // Reflection: Γ(x)Γ(1−x) = π / sin(πx)
        return (std::f64::consts::PI / (std::f64::consts::PI * x).sin()).ln() - lgamma(1.0 - x);
    }
    let x = x - 1.0;
    let mut a = LANCZOS_C[0];
    let t = x + LANCZOS_G + 0.5;
    for (i, c) in LANCZOS_C.iter().enumerate().skip(1) {
        a += c / (x + i as f64);
    }
    0.5 * (2.0 * std::f64::consts::PI).ln() + (x + 0.5) * t.ln() - t + a.ln()
}

/// Series expansion for P(a,x), accurate for x < a+1.
fn gser(a: f64, x: f64) -> f64 {
    if x <= 0.0 {
        return 0.0;
    }
    let mut ap = a;
    let mut sum = 1.0 / a;
    let mut del = sum;
    for _ in 0..ITMAX {
        ap += 1.0;
        del *= x / ap;
        sum += del;
        if del.abs() < sum.abs() * EPS {
            break;
        }
    }
    sum * (-x + a * x.ln() - lgamma(a)).exp()
}

/// Continued fraction for Q(a,x) = 1 − P(a,x), accurate for x ≥ a+1 (Lentz's method).
fn gcf(a: f64, x: f64) -> f64 {
    let mut b = x + 1.0 - a;
    let mut c = 1.0 / FPMIN;
    let mut d = 1.0 / b;
    let mut h = d;
    for i in 1..ITMAX {
        let an = -(i as f64) * (i as f64 - a);
        b += 2.0;
        d = an * d + b;
        if d.abs() < FPMIN {
            d = FPMIN;
        }
        c = b + an / c;
        if c.abs() < FPMIN {
            c = FPMIN;
        }
        d = 1.0 / d;
        let del = d * c;
        h *= del;
        if (del - 1.0).abs() < EPS {
            break;
        }
    }
    (-x + a * x.ln() - lgamma(a)).exp() * h
}

/// Regularized lower incomplete gamma P(a,x) = γ(a,x)/Γ(a). Requires x ≥ 0 and a > 0.
pub fn reg_lower_gamma(a: f64, x: f64) -> f64 {
    debug_assert!(x >= 0.0 && a > 0.0);
    if x == 0.0 {
        return 0.0;
    }
    if x < a + 1.0 {
        gser(a, x)
    } else {
        1.0 - gcf(a, x)
    }
}

/// Error function, computed as sign(x)·P(1/2, x²).
pub fn erf(x: f64) -> f64 {
    if x == 0.0 {
        return 0.0;
    }
    let p = reg_lower_gamma(0.5, x * x);
    if x >= 0.0 {
        p
    } else {
        -p
    }
}

/// Standard-normal CDF Φ(x) = ½·(1 + erf(x/√2)).
pub fn normal_cdf(x: f64) -> f64 {
    0.5 * (1.0 + erf(x / std::f64::consts::SQRT_2))
}

/// Continued fraction for the incomplete beta (Lentz's method).
fn betacf(a: f64, b: f64, x: f64) -> f64 {
    let qab = a + b;
    let qap = a + 1.0;
    let qam = a - 1.0;
    let mut c = 1.0;
    let mut d = 1.0 - qab * x / qap;
    if d.abs() < FPMIN {
        d = FPMIN;
    }
    d = 1.0 / d;
    let mut h = d;
    for m in 1..ITMAX {
        let m = m as f64;
        let m2 = 2.0 * m;
        let mut aa = m * (b - m) * x / ((qam + m2) * (a + m2));
        d = 1.0 + aa * d;
        if d.abs() < FPMIN {
            d = FPMIN;
        }
        c = 1.0 + aa / c;
        if c.abs() < FPMIN {
            c = FPMIN;
        }
        d = 1.0 / d;
        h *= d * c;
        aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2));
        d = 1.0 + aa * d;
        if d.abs() < FPMIN {
            d = FPMIN;
        }
        c = 1.0 + aa / c;
        if c.abs() < FPMIN {
            c = FPMIN;
        }
        d = 1.0 / d;
        let del = d * c;
        h *= del;
        if (del - 1.0).abs() < EPS {
            break;
        }
    }
    h
}

/// Regularized incomplete beta Iₓ(a,b).
pub fn reg_inc_beta(a: f64, b: f64, x: f64) -> f64 {
    if x <= 0.0 {
        return 0.0;
    }
    if x >= 1.0 {
        return 1.0;
    }
    let bt = (lgamma(a + b) - lgamma(a) - lgamma(b) + a * x.ln() + b * (1.0 - x).ln()).exp();
    if x < (a + 1.0) / (a + b + 2.0) {
        bt * betacf(a, b, x) / a
    } else {
        1.0 - bt * betacf(b, a, 1.0 - x) / b
    }
}
