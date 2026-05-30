//! Deterministic, seedable PRNG and the standard sampling primitives built on it.
//!
//! Uses `sfc32` (a small fast counter-based generator of good statistical quality) seeded via
//! `splitmix32`. RNG streams differ across languages by design, so the conformance suite checks
//! sampling statistically (KS + moments), not byte-for-byte - this generator only needs to be
//! correct in distribution.

pub struct Rng {
    a: u32,
    b: u32,
    c: u32,
    d: u32,
    spare_normal: Option<f64>,
}

impl Rng {
    pub fn new(seed: u64) -> Self {
        let mut s = seed as u32;
        let mut mix = || {
            s = s.wrapping_add(0x9e37_79b9);
            let mut t = s;
            t = (t ^ (t >> 16)).wrapping_mul(0x21f0_aaad);
            t = (t ^ (t >> 15)).wrapping_mul(0x735a_2d97);
            t ^ (t >> 15)
        };
        let mut rng = Rng {
            a: mix(),
            b: mix(),
            c: mix(),
            d: mix(),
            spare_normal: None,
        };
        for _ in 0..16 {
            rng.u32();
        }
        rng
    }

    fn u32(&mut self) -> u32 {
        let t = self.a.wrapping_add(self.b).wrapping_add(self.d);
        self.d = self.d.wrapping_add(1);
        self.a = self.b ^ (self.b >> 9);
        self.b = self.c.wrapping_add(self.c << 3);
        self.c = self.c.rotate_left(21);
        self.c = self.c.wrapping_add(t);
        t
    }

    /// Uniform f64 in [0, 1).
    pub fn uniform(&mut self) -> f64 {
        self.u32() as f64 / 4_294_967_296.0
    }

    /// Uniform f64 in [lo, hi).
    pub fn range(&mut self, lo: f64, hi: f64) -> f64 {
        lo + self.uniform() * (hi - lo)
    }

    /// Uniform integer in [0, k).
    pub fn int(&mut self, k: usize) -> usize {
        (self.uniform() * k as f64) as usize
    }

    /// Standard normal via Box-Muller (caches the second deviate).
    pub fn normal(&mut self) -> f64 {
        if let Some(v) = self.spare_normal.take() {
            return v;
        }
        let mut u1 = self.uniform();
        if u1 < 1e-300 {
            u1 = 1e-300;
        }
        let u2 = self.uniform();
        let r = (-2.0 * u1.ln()).sqrt();
        let theta = 2.0 * std::f64::consts::PI * u2;
        self.spare_normal = Some(r * theta.sin());
        r * theta.cos()
    }

    /// Standard exponential (rate 1) via inverse CDF.
    pub fn standard_exponential(&mut self) -> f64 {
        -(1.0 - self.uniform()).ln()
    }

    /// Standard gamma (scale 1) via Marsaglia-Tsang, with the U^(1/k) boost for shape < 1.
    pub fn standard_gamma(&mut self, shape: f64) -> f64 {
        if shape < 1.0 {
            let u = self.uniform();
            return self.standard_gamma(shape + 1.0) * u.powf(1.0 / shape);
        }
        let d = shape - 1.0 / 3.0;
        let c = 1.0 / (9.0 * d).sqrt();
        loop {
            let mut x;
            let mut v;
            loop {
                x = self.normal();
                v = 1.0 + c * x;
                if v > 0.0 {
                    break;
                }
            }
            v = v * v * v;
            let u = self.uniform();
            let x2 = x * x;
            if u < 1.0 - 0.0331 * x2 * x2 {
                return d * v;
            }
            if u.ln() < 0.5 * x2 + d * (1.0 - v + v.ln()) {
                return d * v;
            }
        }
    }
}
