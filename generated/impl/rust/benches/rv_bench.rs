//! Criterion benchmarks for the hot paths: compiling a document, evaluating log_prob/cdf, and
//! drawing samples. Demonstrates the systems-language angle (native throughput; same core → WASM).

use criterion::{black_box, criterion_group, criterion_main, Criterion};
use rvx::{parse_str, Prepared, Rng};

const NORMAL: &str =
    r#"{"format_version":"1.0.0","rv":{"kind":"leaf","dist":"normal","params":{"mu":0.0,"sigma":1.0}}}"#;
const MIXTURE: &str = r#"{"format_version":"1.0.0","rv":{"kind":"mixture","weights":[0.6,0.4],
    "components":[{"kind":"leaf","dist":"normal","params":{"mu":0.0,"sigma":1.0}},
    {"kind":"transform","op":{"name":"exp"},"base":{"kind":"leaf","dist":"normal","params":{"mu":0.0,"sigma":1.0}}}]}}"#;
const GAMMA: &str =
    r#"{"format_version":"1.0.0","rv":{"kind":"leaf","dist":"gamma","params":{"shape":2.0,"scale":2.0}}}"#;

fn bench(c: &mut Criterion) {
    let normal = Prepared::compile(&parse_str(NORMAL).unwrap()).unwrap();
    let gamma = Prepared::compile(&parse_str(GAMMA).unwrap()).unwrap();
    let mixture = Prepared::compile(&parse_str(MIXTURE).unwrap()).unwrap();

    c.bench_function("parse+compile normal", |b| {
        b.iter(|| Prepared::compile(&parse_str(black_box(NORMAL)).unwrap()).unwrap())
    });
    c.bench_function("normal log_prob", |b| b.iter(|| normal.log_prob(black_box(&[0.3])).unwrap()));
    c.bench_function("gamma cdf (incomplete gamma)", |b| {
        b.iter(|| gamma.cdf(black_box(&[2.5])).unwrap())
    });
    c.bench_function("mixture log_prob (logsumexp + change-of-vars)", |b| {
        b.iter(|| mixture.log_prob(black_box(&[1.0])).unwrap())
    });
    c.bench_function("normal sample 10k", |b| {
        let mut rng = Rng::new(42);
        b.iter(|| normal.sample(&mut rng, black_box(10_000)))
    });
}

criterion_group!(benches, bench);
criterion_main!(benches);
