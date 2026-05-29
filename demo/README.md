# RV Exchange — cross-language demo (Next.js)

The demo dashboard for the RV Exchange Format: build a random variable in the browser, watch it
sampled live, and see the **same `.rv.json` evaluated identically by Python, TypeScript, and Rust**.

```bash
npm install
npm run dev        # http://localhost:3000
npm run build      # production build
```

> Requires the sibling `impl/typescript` package (linked via `file:../impl/typescript`) and the
> `conformance/` directory at the repo root (read at render time for the evidence panel).

## What it shows

- **RV builder** — pick a leaf distribution, a deterministic transform of one, or a two-component
  mixture; tweak parameters and watch the portable `.rv.json` update live (copy it, hand it to any
  implementation).
- **Live sampling + density overlay** — samples are drawn off the main thread in a **Web Worker** (so
  the UI stays smooth at 200k draws); the analytic density is overlaid. An engine toggle switches the
  worker between the **TypeScript** reference and the **Rust core compiled to WebAssembly** — same
  `.rv.json`, same histogram, two engines. Non-invertible transforms (e.g. `abs`) honestly drop
  `log_prob`/`cdf`, which the capability badges reflect.
- **Python == TypeScript == Rust** — a **server-rendered** table that recomputes every conformance
  golden value (produced by scipy, verified by Rust) with the TypeScript engine at request time and
  shows the worst deviation per case. No client JavaScript for this proof.

## Architecture

Clean separation, server-first:

```
app/            # server components: page shell, layout
components/      # UI — Studio (client island), RvBuilder, Histogram (SVG), ConformancePanel (server), ...
hooks/           # useSampler — debounced, latest-wins worker driver
lib/             # pure logic: build-doc, histogram/curve binning, presets, format;
                 #   sampler.worker + worker-client (the Web Worker boundary);
                 #   conformance (server-only golden loader)
types/           # form-state model
consts/          # distribution / op catalog that drives the form
```

Only the interactive builder + chart ship as client JavaScript; the cross-language evidence is pure
server rendering. No charting dependency — the histogram is hand-drawn SVG to keep the bundle small.
The TypeScript reference (`rvx`) runs unchanged in three places here: the Web Worker (sampling), the
main thread (live density), and the server (the conformance proof).

## Deploy (Vercel)

The demo lives in this subdirectory of the monorepo. In the Vercel project settings set
**Root Directory = `demo`** (Next.js is auto-detected; no `vercel.json` needed). Then:

```bash
npm i -g vercel
vercel            # link + preview deploy
vercel --prod     # production
```

The committed `wasm-rvx/` lets the build run without a Rust toolchain.

## The WASM engine

`wasm-rvx/` is generated from the Rust crate and committed so the demo builds anywhere. Regenerate
after changing `impl/rust`:

```bash
cd impl/rust && wasm-pack build --release --target bundler --out-dir ../../demo/wasm-rvx --features wasm
```

`next.config.mjs` enables webpack's `asyncWebAssembly` so the worker can import it.

## Notes

- `public/images/icons/logo_designed.svg` is a placeholder — replace with the real brand asset.
- The interactive UI (worker, chart) is build- and SSR-verified; give it a visual pass in a browser
  (`npm run dev`) before shipping.
