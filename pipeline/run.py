#!/usr/bin/env python3
"""
Live LLM pipeline runner for the RV Exchange Format.

This is the executable form of the two-prompt pipeline:

    Prompt #1  ──►  SPEC.md + rv.schema.json          (the spec)
    Prompt #2  ──►  reader/writer in one language      (the implementation)

It feeds `pipeline/prompts/01-generate-spec.md` (and, for implementations,
`pipeline/prompts/02-generate-impl.md` with the machine-readable spec attached) to the local
**Claude Code** CLI in headless mode and
writes the model's output to disk. Claude Code runs on the machine's subscription auth, so there is
no API key and no quota. The committed artifacts in `generated/` are the *canonical* (replay)
outputs; this runner produces a *fresh* set on demand - the "live" half of the demo's duality.

No third-party dependencies: it uses only the Python standard library (subprocess).

Environment:
    RVX_MODEL           Claude model alias/id (default: "sonnet").
    ANTHROPIC_API_KEY   enables the Anthropic API backend when the Claude Code CLI is unavailable.

Usage (from repo root):
    python3 pipeline/run.py spec                 # Prompt #1 -> spec artifacts
    python3 pipeline/run.py impl python          # Prompt #2 -> one implementation
    python3 pipeline/run.py all                  # spec, then all three implementations
    # add --out DIR to write somewhere other than generated/.live (never clobbers canonical
    # generated/ unless you pass --out generated)
    # add --backend cli|api|auto to pick the LLM backend (default auto: CLI if found, else API key)

Every run also writes `<out>/PROVENANCE.json`: backend, model, UTC timestamp, prompt SHA-256
hashes, written files, durations, and token usage - so a generated artifact set is traceable to
the exact prompts and model that produced it.
"""

from __future__ import annotations

# Core
import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Union

REPO_ROOT = Path(__file__).resolve().parents[1]
PROMPTS = REPO_ROOT / "pipeline" / "prompts"
CANONICAL_SPEC = REPO_ROOT / "generated" / "spec"

DEFAULT_MODEL = "sonnet"          # Claude Code CLI model alias
CLI_TIMEOUT_SEC = 900
LANGUAGES = ("python", "typescript", "rust")

# Anthropic API backend (used when the Claude Code CLI is unavailable; needs ANTHROPIC_API_KEY).
API_URL = "https://api.anthropic.com/v1/messages"
API_VERSION = "2023-06-01"
API_MAX_TOKENS = 32000
# The raw API takes full model ids, not CLI aliases.
API_MODEL_ALIASES = {
    "sonnet": "claude-sonnet-4-6",
    "opus": "claude-opus-4-8",
    "haiku": "claude-haiku-4-5-20251001",
}

# Map a target language to the on-disk subtree of generated/impl.
IMPL_DIR = {"python": "python", "typescript": "typescript", "rust": "rust"}


class LLMError(RuntimeError):
    """Any backend failure (CLI non-zero exit, timeout, empty/garbled completion)."""


class ClaudeCliClient:
    """Claude Code CLI in headless print mode - prompt in, result text out.

    Uses the machine's existing Claude Code subscription auth, so no API key is required. All tools
    are disabled (`--tools ""`) so the model emits the requested files inside the JSON `result`
    rather than trying to write them itself - which is exactly the contract the parser expects.
    `--strict-mcp-config` with an empty `--mcp-config` loads no MCP servers, so machine-configured
    MCP tools (e.g. Google Drive) can't leak in past `--tools ""` and tempt the model to "write" a
    file via a tool - which would trigger a permission denial and a clarifying question instead.
    """

    name = "claude-cli"

    def __init__(self, model: str):
        self.model = model
        self.last_meta: dict[str, object] = {}
        self.exe = shutil.which("claude")
        if not self.exe:
            raise SystemExit(
                "`claude` CLI not found on PATH. Install Claude Code to run the live pipeline; the "
                "committed artifacts in generated/ are the replay (offline) outputs."
            )

    def complete(self, prompt: str, system: str | None = None) -> str:
        cmd = [self.exe, "-p", "--tools", "", "--strict-mcp-config", "--mcp-config",
               '{"mcpServers":{}}', "--output-format", "json", "--model", self.model]
        if system:
            cmd += ["--append-system-prompt", system]
        try:
            proc = subprocess.run(
                cmd, input=prompt, capture_output=True, text=True, timeout=CLI_TIMEOUT_SEC
            )
        except subprocess.TimeoutExpired as e:
            raise LLMError(f"claude CLI timed out after {e.timeout}s") from e
        payload = _parse_json(proc.stdout)
        if proc.returncode != 0:
            raise LLMError(f"claude CLI exited {proc.returncode}: {_format_claude_error(payload, proc.stdout, proc.stderr)}")
        if payload is not None:
            if payload.get("is_error"):
                raise LLMError(f"claude CLI error: {_format_claude_error(payload, proc.stdout, proc.stderr)}")
            text = str(payload.get("result") or "").strip()
        else:
            text = proc.stdout.strip()
        if not text:
            raise LLMError(f"claude CLI returned empty output; {_format_claude_error(payload, proc.stdout, proc.stderr)}")
        self.last_meta = {
            k: payload.get(k)
            for k in ("usage", "total_cost_usd", "duration_ms", "model")
            if payload is not None and payload.get(k) is not None
        }
        return text


class AnthropicApiClient:
    """Anthropic Messages API backend over the Python standard library (no SDK dependency).

    Used when the Claude Code CLI is not installed - e.g. on a reviewer's machine - so the live
    pipeline stays runnable with nothing but Python and an API key.
    """

    name = "anthropic-api"

    def __init__(self, model: str):
        self.model = API_MODEL_ALIASES.get(model, model)
        self.last_meta: dict[str, object] = {}
        self.key = os.environ.get("ANTHROPIC_API_KEY")
        if not self.key:
            raise SystemExit(
                "ANTHROPIC_API_KEY is not set. Either install the Claude Code CLI (subscription "
                "auth) or export an API key to use the Anthropic API backend."
            )

    def complete(self, prompt: str, system: str | None = None) -> str:
        body: dict[str, object] = {
            "model": self.model,
            "max_tokens": API_MAX_TOKENS,
            "messages": [{"role": "user", "content": prompt}],
        }
        if system:
            body["system"] = system
        req = urllib.request.Request(
            API_URL,
            data=json.dumps(body).encode("utf-8"),
            headers={
                "x-api-key": self.key,
                "anthropic-version": API_VERSION,
                "content-type": "application/json",
            },
        )
        started = time.monotonic()
        try:
            with urllib.request.urlopen(req, timeout=CLI_TIMEOUT_SEC) as resp:
                payload = json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            detail = e.read().decode("utf-8", errors="replace")
            raise LLMError(f"Anthropic API HTTP {e.code}: {_compact(detail)}") from e
        except (urllib.error.URLError, TimeoutError) as e:
            raise LLMError(f"Anthropic API request failed: {e}") from e
        text = "".join(
            block.get("text", "")
            for block in payload.get("content", [])
            if block.get("type") == "text"
        ).strip()
        if not text:
            raise LLMError(f"Anthropic API returned empty output: {_compact(payload)}")
        self.last_meta = {
            "usage": payload.get("usage"),
            "duration_ms": int((time.monotonic() - started) * 1000),
            "model": payload.get("model"),
        }
        return text


def _parse_json(text: str) -> dict[str, object] | None:
    try:
        value = json.loads(text)
    except json.JSONDecodeError:
        return None
    return value if isinstance(value, dict) else None


def _compact(value: object, limit: int = 1200) -> str:
    text = re.sub(r"\s+", " ", str(value)).strip()
    return text[:limit] + "..." if len(text) > limit else text


def _format_claude_error(payload: dict[str, object] | None, stdout: str, stderr: str) -> str:
    parts: list[str] = []
    if payload is not None:
        result = payload.get("result")
        if result:
            parts.append(_compact(result))
        errors = payload.get("errors")
        if isinstance(errors, list):
            parts.extend(_compact(e) for e in errors[:3] if e)
        subtype = payload.get("subtype")
        if subtype and subtype != "success":
            parts.append(_compact(subtype))
    if stderr.strip():
        parts.append(_compact(stderr))
    elif stdout.strip() and payload is None:
        parts.append(_compact(stdout))
    return " | ".join(parts) if parts else "no error details were returned"


def load_prompt(name: str) -> str:
    path = PROMPTS / name
    if not path.exists():
        raise SystemExit(f"missing prompt: {path}")
    return path.read_text(encoding="utf-8")


_FILE_RE = re.compile(
    r"<<<FILE:\s*(?P<name>[^\n>]+?)\s*>>>\n(?P<body>.*?)(?=\n?<<<FILE:|\n?<<<END FILE>>>|\Z)",
    re.DOTALL,
)
_FENCE_WRAP = re.compile(r"\A```[^\n]*\n(?P<inner>.*)\n```\s*\Z", re.DOTALL)


def _unwrap_fence(body: str) -> str:
    """If the model wrapped a file body in a single markdown fence, drop the fence."""
    m = _FENCE_WRAP.match(body.strip())
    return m.group("inner") if m else body


def parse_files(text: str) -> dict[str, str]:
    """
    Parse the model's response into {path: content} using the explicit
    `<<<FILE: path>>> ... <<<END FILE>>>` markers the prompts mandate. These markers are robust to
    files (like SPEC.md) that themselves contain markdown code fences - which naive fence parsing is
    not.
    """
    files: dict[str, str] = {}
    for m in _FILE_RE.finditer(text):
        name = m.group("name").strip()
        body = _unwrap_fence(m.group("body")).rstrip("\n")
        files[name] = body
    return files


def write_file(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if not content.endswith("\n"):
        content += "\n"
    path.write_text(content, encoding="utf-8")
    print(f"  wrote {path.relative_to(REPO_ROOT)}  ({len(content)} bytes)")


def cmd_spec(client: LLMClient, out: Path) -> dict:
    print("Prompt #1 -> spec (SPEC.md + rv.schema.json)")
    reply = client.complete(load_prompt("01-generate-spec.md"))
    files = parse_files(reply)
    spec_md = files.get("SPEC.md")
    schema = files.get("rv.schema.json")
    if spec_md is None or schema is None:
        raw = _dump_reply(out, "spec", reply)
        raise LLMError(
            "could not locate both SPEC.md and rv.schema.json in the reply "
            f"(found: {sorted(files)}); raw reply saved to {raw}"
        )
    json.loads(schema)  # fail fast if the schema is not valid JSON
    write_file(out / "spec" / "SPEC.md", spec_md)
    write_file(out / "spec" / "rv.schema.json", schema)
    return _provenance_entry("spec", "01-generate-spec.md", ["spec/SPEC.md", "spec/rv.schema.json"], client)


def cmd_impl(client: LLMClient, language: str, out: Path) -> dict:
    if language not in LANGUAGES:
        raise SystemExit(f"language must be one of {LANGUAGES}, got {language!r}")
    print(f"Prompt #2 -> implementation ({language})")
    prompt = load_prompt("02-generate-impl.md").replace("{{LANGUAGE}}", language)
    schema = (CANONICAL_SPEC / "rv.schema.json").read_text(encoding="utf-8")
    attached = (
        f"{prompt}\n\n"
        f"--- ATTACHMENT: rv.schema.json ---\n```json\n{schema}\n```\n"
    )
    reply = client.complete(attached)
    files = parse_files(reply)
    if not files:
        raw = _dump_reply(out, f"impl-{language}", reply)
        raise LLMError(f"no <<<FILE: ...>>> blocks in the implementation reply; raw reply saved to {raw}")
    target = out / "impl" / IMPL_DIR[language] / "_live"
    if target.exists():
        shutil.rmtree(target)  # start clean so a prior run's files never mix into this one
    written = []
    for name, content in files.items():
        # Normalise to the library root: drop any leading generated/impl/<lang>/ prefix the model
        # may echo from the attachments, and neutralise parent escapes.
        rel = Path(re.sub(r"^generated/impl/[^/]+/", "", name.strip()).replace("..", "_"))
        write_file(target / rel, content)
        written.append(str(Path("impl") / IMPL_DIR[language] / "_live" / rel))
    entry = _provenance_entry(f"impl:{language}", "02-generate-impl.md", written, client)
    entry["attachment_sha256"] = {"rv.schema.json": hashlib.sha256(schema.encode("utf-8")).hexdigest()}
    return entry


def _dump_reply(out: Path, step: str, reply: str) -> Path:
    """Save an unparseable model reply for debugging (the error alone hides what came back)."""
    path = out / f"_raw-{step}.txt"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(reply, encoding="utf-8")
    return path


def _provenance_entry(step: str, prompt_name: str, files: list[str], client: LLMClient) -> dict:
    prompt_bytes = (PROMPTS / prompt_name).read_bytes()
    return {
        "step": step,
        "prompt": prompt_name,
        "prompt_sha256": hashlib.sha256(prompt_bytes).hexdigest(),
        "files": files,
        **client.last_meta,
    }


def write_provenance(out: Path, client: LLMClient, runs: list[dict]) -> None:
    """Record what produced this artifact set: backend, model, prompt hashes, files, usage."""
    doc = {
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "backend": client.name,
        "requested_model": client.model,
        "runs": runs,
        "oracle": (
            "conformance/: every generated implementation must reproduce the golden values within "
            "an absolute 1e-9 to be accepted"
        ),
    }
    path = out / "PROVENANCE.json"
    path.write_text(json.dumps(doc, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(f"  wrote {path.relative_to(REPO_ROOT) if path.is_relative_to(REPO_ROOT) else path}")


# Either backend satisfies the same informal protocol: .name, .model, .last_meta, .complete().
LLMClient = Union[ClaudeCliClient, AnthropicApiClient]


def build_client(backend: str) -> LLMClient:
    """Construct the LLM backend. `auto` prefers the Claude Code CLI (subscription auth, no key)
    and falls back to the Anthropic API when an ANTHROPIC_API_KEY is set."""
    model = os.environ.get("RVX_MODEL", DEFAULT_MODEL)
    if backend == "cli":
        return ClaudeCliClient(model)
    if backend == "api":
        return AnthropicApiClient(model)
    if shutil.which("claude"):
        return ClaudeCliClient(model)
    if os.environ.get("ANTHROPIC_API_KEY"):
        return AnthropicApiClient(model)
    raise SystemExit(
        "no LLM backend available: install the Claude Code CLI (subscription auth) or export "
        "ANTHROPIC_API_KEY for the API backend. The committed artifacts in generated/ are the "
        "replay (offline) outputs."
    )


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description="Live LLM pipeline runner for the RV Exchange Format.")
    parser.add_argument("command", choices=["spec", "impl", "all"])
    parser.add_argument("language", nargs="?", help="for `impl`: one of python|typescript|rust")
    parser.add_argument("--out", default=str(REPO_ROOT / "generated" / ".live"),
                        help="output root (default: generated/.live; never clobbers canonical unless you point here)")
    parser.add_argument("--backend", choices=["auto", "cli", "api"], default="auto",
                        help="LLM backend: Claude Code CLI, Anthropic API (ANTHROPIC_API_KEY), or auto")
    args = parser.parse_args(argv)
    out = Path(args.out).resolve()

    client = build_client(args.backend)
    rel_out = out.relative_to(REPO_ROOT) if out.is_relative_to(REPO_ROOT) else out
    print(f"backend: {client.name}   model: {client.model}   out: {rel_out}\n")

    runs: list[dict] = []
    if args.command == "spec":
        runs.append(cmd_spec(client, out))
    elif args.command == "impl":
        if not args.language:
            raise SystemExit("`impl` requires a language: python|typescript|rust")
        runs.append(cmd_impl(client, args.language, out))
    elif args.command == "all":
        runs.append(cmd_spec(client, out))
        for lang in LANGUAGES:
            runs.append(cmd_impl(client, lang, out))
    write_provenance(out, client, runs)
    print("\ndone.")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
