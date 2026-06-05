# Prompt #2 - Generate a reader/writer for one language

> **Role of this file.** This is the *second* prompt of the pipeline. It is deliberately **short**:
> all the domain knowledge lives in the specification produced by Prompt #1, which is **attached**.
> The brevity is the point - if a short prompt plus the machine-readable spec is enough to produce a
> correct implementation, the spec is self-sufficient.
>
> You run this prompt once per target language, substituting `{{LANGUAGE}}`. The three deliverable
> languages are **Python**, **TypeScript**, and **Rust**.

---

## Attachments (provided with this prompt)
- `rv.schema.json` - the machine-readable contract (JSON Schema, draft 2020-12). **Primary input.**
- `SPEC.md` - the human-readable companion (normative algorithms and semantic rules the schema cannot
  encode: capability propagation, change-of-variables, KDE, validation stages).

## Prompt

Using the attached `rv.schema.json` (and `SPEC.md` for the math the schema cannot express), implement
the **RV Exchange Format** reader/writer in **{{LANGUAGE}}**.

Provide a single idiomatic library that:

1. **Reads** a `*.rv.json` document into an in-memory model (a tagged union over `leaf | joint |
   mixture | transform`), running both validation stages from `SPEC.md` (schema-level, then semantic:
   weight/probability sums, parameter constraints, support consistency, and **capability
   re-computation** - reject on any mismatch). Reject a document whose `format_version` MAJOR exceeds
   what this library implements, and reject an `npy` `bulk_ref` with an explicit error (decode the
   mandatory inline `base64` transport).
2. **Writes** the model back to the **canonical form** defined in `SPEC.md` (sorted keys, shortest
   round-trippable numbers), so read -> write round-trips are byte-stable.
3. Exposes the three operations where the node's capabilities allow them: `sample(n, seed)`,
   `log_prob(x)`, `cdf(x)`, using the normative formulas in `SPEC.md` (log-space throughout;
   `logsumexp` for mixtures; change-of-variables for transforms; Gaussian KDE with Scott's-rule
   bandwidth for empirical). An operation on a node that lacks the capability MUST fail explicitly.

Make it idiomatic for {{LANGUAGE}} (e.g. discriminated unions / enums, the standard error type, the
standard test framework). The code MUST run **as-is**: every name you use must be imported or defined
in the same file, no placeholders, stubs, or `...` bodies, and no references to modules you did not
emit. Then **prove conformance**: load every case under `conformance/cases/*.rv.json`,
compute the outputs, and assert they match `conformance/golden/*.json` - deterministic outputs
(`log_prob`, `cdf`, analytic moments) within absolute `1e-9`, and sampling within the per-case
statistical tolerances (KS statistic + mean/variance bounds). Include those tests.

## Output format (strict)

Emit every file wrapped in explicit file markers, using the file's **relative path** as the name, and
nothing outside the markers. Do not wrap the bodies in markdown code fences. For example:

```
<<<FILE: src/model.py>>>
...file contents...
<<<END FILE>>>
<<<FILE: tests/test_conformance.py>>>
...file contents...
<<<END FILE>>>
```

Output the complete file tree for the library and its conformance tests this way.
