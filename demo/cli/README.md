# Headless cross-language demo (CLI)

The formal task flow, runnable without a browser: **generate a list of RVs of different types
(discrete and continuous) in one language, export (write) it to the RV format, and import (read)
it in another language.**

```
Python (writes)  ──►  rv-batch.rv-list.json  ──►  TypeScript (reads)
                                              └─►  Rust (reads)
                                              └─►  demo app "upload list" (reads in the browser)
```

All commands run from the repository root:

```bash
# 1. Python writes the list (8 documents: 3 discrete, 5 continuous)
PYTHONPATH=generated/impl/python/src python3 demo/cli/write_rv_list.py

# 2. TypeScript imports it (validates + samples every document)
npx tsx demo/cli/read_rv_list.ts demo/cli/rv-batch.rv-list.json

# 3. Rust imports it (validates + samples every document)
cargo run --manifest-path generated/impl/rust/Cargo.toml --example read_rv_list -- demo/cli/rv-batch.rv-list.json
```

Each reader runs full structural + semantic validation, recomputes capabilities, and samples
100 000 draws per document; the sample means agree with the analytic means across languages. The
same `rv-batch.rv-list.json` can be uploaded into the **Batch export/import** panel of the web demo
(`upload list`), where the Rust/WebAssembly engine reads it in the browser.

The generated `rv-batch.rv-list.json` is a build artifact and is git-ignored; run step 1 to
produce it.
