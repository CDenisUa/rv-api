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

Usage (from repo root):
    python3 pipeline/run.py spec                 # Prompt #1 -> spec artifacts
    python3 pipeline/run.py impl python          # Prompt #2 -> one implementation
    python3 pipeline/run.py all                  # spec, then all three implementations
    # add --out DIR to write somewhere other than generated/.live (never clobbers canonical
    # generated/ unless you pass --out generated)
"""

from __future__ import annotations

# Core
import argparse
import json
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
PROMPTS = REPO_ROOT / "pipeline" / "prompts"
CANONICAL_SPEC = REPO_ROOT / "generated" / "spec"

DEFAULT_MODEL = "sonnet"          # Claude Code CLI model alias
CLI_TIMEOUT_SEC = 900
LANGUAGES = ("python", "typescript", "rust")

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

    def __init__(self, model: str):
        self.model = model
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


def cmd_spec(client: ClaudeCliClient, out: Path) -> None:
    print("Prompt #1 -> spec (SPEC.md + rv.schema.json)")
    reply = client.complete(load_prompt("01-generate-spec.md"))
    files = parse_files(reply)
    spec_md = files.get("SPEC.md")
    schema = files.get("rv.schema.json")
    if spec_md is None or schema is None:
        raise LLMError(
            "could not locate both SPEC.md and rv.schema.json in the reply "
            f"(found: {sorted(files)})"
        )
    json.loads(schema)  # fail fast if the schema is not valid JSON
    write_file(out / "spec" / "SPEC.md", spec_md)
    write_file(out / "spec" / "rv.schema.json", schema)


def cmd_impl(client: ClaudeCliClient, language: str, out: Path) -> None:
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
        raise LLMError("no <<<FILE: ...>>> blocks in the implementation reply")
    target = out / "impl" / IMPL_DIR[language] / "_live"
    if target.exists():
        shutil.rmtree(target)  # start clean so a prior run's files never mix into this one
    for name, content in files.items():
        # Normalise to the library root: drop any leading generated/impl/<lang>/ prefix the model
        # may echo from the attachments, and neutralise parent escapes.
        rel = Path(re.sub(r"^generated/impl/[^/]+/", "", name.strip()).replace("..", "_"))
        write_file(target / rel, content)


def build_client() -> ClaudeCliClient:
    """Construct the Claude Code CLI backend (subscription auth, no key). RVX_MODEL overrides model."""
    return ClaudeCliClient(os.environ.get("RVX_MODEL", DEFAULT_MODEL))


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description="Live LLM pipeline runner for the RV Exchange Format.")
    parser.add_argument("command", choices=["spec", "impl", "all"])
    parser.add_argument("language", nargs="?", help="for `impl`: one of python|typescript|rust")
    parser.add_argument("--out", default=str(REPO_ROOT / "generated" / ".live"),
                        help="output root (default: generated/.live; never clobbers canonical unless you point here)")
    args = parser.parse_args(argv)
    out = Path(args.out).resolve()

    client = build_client()
    rel_out = out.relative_to(REPO_ROOT) if out.is_relative_to(REPO_ROOT) else out
    print(f"provider: claude   model: {client.model}   out: {rel_out}\n")

    if args.command == "spec":
        cmd_spec(client, out)
    elif args.command == "impl":
        if not args.language:
            raise SystemExit("`impl` requires a language: python|typescript|rust")
        cmd_impl(client, args.language, out)
    elif args.command == "all":
        cmd_spec(client, out)
        for lang in LANGUAGES:
            cmd_impl(client, lang, out)
    print("\ndone.")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
