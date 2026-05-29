//! rvx — reference Rust implementation of the RV Exchange Format v1 (systems / WASM core).
//!
//! Parses/validates `*.rv.json`, evaluates `log_prob` / `cdf`, draws samples, and computes moments —
//! pinned to the same language-neutral conformance golden values as the Python and TypeScript
//! references. Closed forms match `scipy.stats` to 1e-9 via hand-rolled special functions, with no
//! scientific dependency, so the same core compiles to native and to WebAssembly.
//!
//! ```
//! let node = rvx::parse_str(r#"{"format_version":"1.0.0",
//!     "rv":{"kind":"leaf","dist":"normal","params":{"mu":0.0,"sigma":1.0}}}"#).unwrap();
//! let lp = rvx::log_prob(&node, &[0.0]).unwrap();
//! assert!((lp - (-0.9189385332046727)).abs() < 1e-12);
//! ```

pub mod bulk;
pub mod distributions;
pub mod errors;
pub mod model;
pub mod numerics;
pub mod operations;
pub mod ops;
pub mod parse;
pub mod rng;
pub mod special;

#[cfg(feature = "wasm")]
pub mod wasm;

pub use errors::{Result, RvError};
pub use model::{Capabilities, RvNode, Support};
pub use operations::{capabilities, cdf, log_prob, moments, sample, Moment, Prepared, Samples};
pub use ops::Op;
pub use parse::{parse_str, parse_value, to_document, to_value, validate_semantics};
pub use rng::Rng;

pub const VERSION: &str = "1.0.0";
