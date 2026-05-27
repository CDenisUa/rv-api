<p align="center">
  <img src="logo.jpg" alt="MCL Logo" height="60" />
</p>

# RV Exchange API

A portable, language-neutral API for serializing and exchanging random variables across programming languages and frameworks.

## Overview

This project explores a two-stage LLM-assisted pipeline for generating interoperable Random Variable (RV) APIs:

1. **Specification generation** — a prompt fed to an LLM produces both a human-readable and a machine-readable RV-API specification
2. **Implementation generation** — the machine-readable spec (with optional human-readable context) is fed to a second LLM prompt to generate an implementation in a target programming language
3. **Demo application** — showcases cross-language RV exchange: generating random variables in one language/framework and consuming them in another

## Supported RV Kinds

| Kind | Description |
|------|-------------|
| `Leaf` | Atomic analytic or empirical distribution |
| `Joint` | Independent composition over multiple dimensions |
| `Mixture` | Weighted combination over components |
| `Transform` | Deterministic transformation of another RV |

## Design Principles

- **Semantic** — describes what an RV means, not how a library implements it
- **Declarative** — fully described by fields; no embedded executable code required
- **Portable** — readable and meaningful across languages and frameworks
- **Explicit capabilities** — states valid operations (sampling, log-probability evaluation, etc.)

## Project Structure

```
rv-exchange/
├── spec/           # RV-API specification (human-readable + machine-readable)
├── impl/           # Generated implementations per language
└── demo/           # Cross-language demo application
```

## Technical Assessment

This project is a technical exploration task. The goal is to evaluate the feasibility of using LLMs as specification and code generation tools for scientific/interoperability APIs.
