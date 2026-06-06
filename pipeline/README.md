# Pipeline - the two-prompt generator

This directory turns the prompts in [`./prompts/`](./prompts/) into artifacts by feeding them to an
LLM. It is the **executable** form of the project's thesis:

```
pipeline/prompts/01-generate-spec.md  ──LLM──►  SPEC.md + rv.schema.json          (the contract)
pipeline/prompts/02-generate-impl.md  ──LLM──►  reader/writer in <language>        (one implementation)
   + rv.schema.json attached as the only RV-format input
```

## Live vs replay

- **Replay (offline, deterministic):** the committed artifacts under [`../generated/`](../generated/)
  are the canonical outputs. They never need the network and are what the conformance oracle in
  [`../conformance/`](../conformance/) validates.
- **Live:** `run.py` feeds the prompts to the local **Claude Code CLI** (headless mode) and writes a
  *fresh* set, demonstrating that the prompts genuinely produce working artifacts. Claude Code runs on
  your subscription auth, so there is **no API key and no quota**. The web demo exposes the same
  live/replay duality (its `/api/generate` route shells out to the same CLI).

The independent oracle is the same in both modes: canonical outputs must reproduce the golden values
within `1e-9`; the web Live mode uses a compact normal/uniform subset for fast interactive generation
and labels that proof separately.

## Usage

From the repo root (needs the `claude` CLI on PATH; no API key):

```bash
python3 pipeline/run.py spec                 # Prompt #1  -> spec artifacts
python3 pipeline/run.py impl python          # Prompt #2  -> one implementation (python|typescript|rust)
python3 pipeline/run.py all                  # spec, then all three implementations
```

Output goes to `generated/.live/` by default (git-ignored) so a live run never clobbers the canonical
artifacts. Point `--out generated` if you deliberately want to refresh the canonical set, then re-run
the conformance suite before committing.

| Env var     | Default  | Meaning                                  |
|-------------|----------|------------------------------------------|
| `RVX_MODEL` | `sonnet` | Claude model alias/id used for generation |

`run.py` shells out to the local `claude` CLI in headless mode (`-p --tools "" --output-format json`)
and uses your Claude Code subscription - nothing to configure, no key, no quota.

No third-party dependencies - `run.py` uses only the Python standard library (subprocess).
