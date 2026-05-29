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
- **Live sampling + density overlay** — samples are drawn off the main thread in a **Web Worker** by
  the TypeScript `rvx` engine (so the UI stays smooth at 200k draws); the analytic density is
  overlaid by the same engine. Non-invertible transforms (e.g. `abs`) honestly drop `log_prob`/`cdf`,
  which the capability badges reflect.
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

## Notes

- `public/images/icons/logo_designed.svg` is a placeholder — replace with the real brand asset.
- A Rust → WebAssembly sampler can drop into the worker later (the Rust crate already builds to
  `wasm32-unknown-unknown`); the TypeScript sampler is the default path.
