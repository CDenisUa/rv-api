# RV Exchange - cross-language demo (Next.js)

The demo dashboard for the RV Exchange Format: build a random variable in the browser, watch it
sampled live, and see the **same `.rv.json` evaluated identically by Python, TypeScript, and Rust**.

## Run locally

Prerequisites: Node.js 20+ and pnpm. If pnpm is not installed, use Corepack:

```bash
corepack enable
corepack prepare pnpm@10 --activate
```

From the repository root:

```bash
cd demo
pnpm install
pnpm run dev
```

Open http://localhost:3000.

For a production build and local production server:

```bash
cd demo
pnpm run typecheck
pnpm run build
pnpm run start
```

`pnpm run start` serves the build at http://localhost:3000 and requires `pnpm run build` first.

> Uses **pnpm**. `pnpm-workspace.yaml` allows the optional `sharp` build dependency, so install
> isn't blocked by pnpm's ignored-builds guard.

> Requires the sibling `impl/typescript` package (linked via `file:../impl/typescript`) and the
> `conformance/` directory at the repo root (read at render time for the evidence panel).

You do not need to start Python or Rust services to run the UI. The browser demo uses the local
TypeScript package directly and the committed `wasm-rvx/` bundle for the Rust engine. Regenerate the
WASM bundle only after changing `impl/rust`.

## Useful commands

```bash
pnpm run dev        # Next.js dev server
pnpm run typecheck  # TypeScript check
pnpm run build      # production build
pnpm run start      # serve the production build
```

If the app cannot resolve `rvx`, reinstall from inside `demo/` so pnpm recreates the local
`file:../impl/typescript` link. If the conformance panel cannot load data, run the app from this
repository layout; the server component expects `../conformance` relative to `demo/`.

## What it shows

- **RV builder** - pick a leaf distribution, a deterministic transform of one, or a two-component
  mixture; tweak parameters and watch the portable `.rv.json` update live (copy it, hand it to any
  implementation).
- **Live sampling + density overlay** - samples are drawn off the main thread in a **Web Worker** (so
  the UI stays smooth at 200k draws); the analytic density is overlaid. An engine toggle switches the
  worker between the **TypeScript** reference and the **Rust core compiled to WebAssembly** - same
  `.rv.json`, same histogram, two engines. Non-invertible transforms (e.g. `abs`) honestly drop
  `log_prob`/`cdf`, which the capability badges reflect.
- **Python == TypeScript == Rust** - a **server-rendered** table that recomputes every conformance
  golden value (produced by scipy, verified by Rust) with the TypeScript engine at request time and
  shows the worst deviation per case. No client JavaScript for this proof.

## Architecture

Clean separation, server-first:

```
app/            # server components: page shell, layout
components/      # UI - Studio (client island), RvBuilder, Histogram (SVG), ConformancePanel (server), ...
hooks/           # useSampler - debounced, latest-wins worker driver
lib/             # pure logic: build-doc, histogram/curve binning, presets, format;
                 #   sampler.worker + worker-client (the Web Worker boundary);
                 #   conformance (server-only golden loader)
types/           # form-state model
consts/          # distribution / op catalog that drives the form
```

Only the interactive builder + chart ship as client JavaScript; the cross-language evidence is pure
server rendering. No charting dependency - the histogram is hand-drawn SVG to keep the bundle small.
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

## Images

Served from `public/images/`, grouped by purpose:

- `images/brand/mcl-logo.jpg` - the MCL mark in the header (right).
- `images/icons/logo_designed.svg` - the "Designed by Chepio" credit logo in the footer (per the
  global branding rule: `opacity-25`/white at rest, full-colour on hover).
