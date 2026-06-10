# Prompt #2 - Generate a reader/writer for one language

## Role

This is the second prompt in the RV Exchange Format pipeline. It is deliberately short. All domain
knowledge is in the attached machine-readable `rv.schema.json`, including its `x-rvx-semantics`
extension.

Run this prompt once per target language by substituting `{{LANGUAGE}}`. The deliverable languages are
Python, TypeScript, and Rust.

## Attachment

- `rv.schema.json` - the only RV-format input. Treat it as the full contract: JSON Schema structure
  plus `x-rvx-semantics` for algorithms, validation rules, capability rules, versioning, tolerances,
  and canonical serialization.

## Prompt

Using only the attached `rv.schema.json`, implement the RV Exchange Format reader/writer in
**{{LANGUAGE}}**.

Provide an idiomatic library that:

1. Reads a `*.rv.json` document into an in-memory tagged-union model over `leaf | joint | mixture |
   transform`, running structural validation and semantic validation from the machine-readable spec.
2. Writes the model back to canonical form, so `read -> write -> read -> write` is byte-stable.
3. Exposes `sample(n, seed)`, `log_prob(x)`, `cdf(x)`, and analytic moments where the node's
   capabilities allow them. Operations on unsupported nodes MUST fail explicitly.
4. Decodes mandatory inline `base64` `bulk_ref` sample arrays. Unsupported optional transports, such as
   `.npy` sidecars, MUST be rejected explicitly rather than misread.
5. Rejects malformed documents, invalid parameters, invalid weights/probabilities, capability
   mismatches, support contradictions, and unsupported future major versions.

Prove conformance by including tests that load every case under `conformance/cases/*.rv.json`, compare
against `conformance/golden/*.json`, and assert deterministic outputs within absolute `1e-9`.
Sampling tests should use the per-case statistical tolerances from the golden files. The conformance
fixtures are a runtime **test oracle** provided by the environment the generated code runs in - they
are not part of the format definition; `rv.schema.json` remains the only RV-format input to this
prompt.

The code MUST run as-is: no placeholders, no stubs, no `...` bodies, and no references to files you did
not emit.

## Output format

Emit every file wrapped in explicit markers using the file's relative path. Emit nothing outside the
markers and do not wrap file bodies in markdown fences:

```text
<<<FILE: src/model.py>>>
...file contents...
<<<END FILE>>>
```
