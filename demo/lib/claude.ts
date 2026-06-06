// Server-only Claude Code CLI client and file-marker parser. This mirrors pipeline/run.py: the same
// prompts, the same `<<<FILE: ...>>>` output contract, the same headless invocation
// (`claude -p --tools "" --output-format stream-json`). It shells out to the local `claude` binary,
// which runs on the machine's Claude Code subscription auth - no API key, no quota. The browser never
// spawns anything; only this module (running on the server) does.

// Core
import { spawn, spawnSync } from 'node:child_process'
// Types
import type { Usage } from '@/types/pipeline'

export interface GenResult {
  text: string
  usage: Usage
  costUsd: number
  durationMs: number
}

type RawClaudeEvent = Record<string, unknown>

// Consts
// Haiku keeps the live demo snappy (a compact spec/impl finishes in seconds). Override with RVX_MODEL
// for a higher-quality but slower run. The canonical artifacts in generated/ are produced separately
// by pipeline/run.py and are not affected by this default.
const DEFAULT_MODEL = 'haiku'
const TIMEOUT_MS = 15 * 60 * 1000
const PROGRESS_THROTTLE_MS = 120

// Pinned at the system level so the model never adds a preamble or wraps file bodies in fences -
// the two failure modes that leave the parser with no <<<FILE: ...>>> markers to extract.
const SYSTEM_PROMPT =
  'You are a non-interactive file generator in an automated pipeline. Output ONLY the requested ' +
  'files, each wrapped EXACTLY in `<<<FILE: relative/path>>>` on its own line, the raw file body, ' +
  'then `<<<END FILE>>>` on its own line. Emit nothing else: no preamble, no explanation, no ' +
  'commentary, and never wrap a file body in a markdown code fence. Do not ask questions - if ' +
  'something is ambiguous, make a reasonable choice and proceed.'

export class ClaudeError extends Error {}

export function modelId(): string {
  return process.env.RVX_MODEL || DEFAULT_MODEL
}

let cachedAvailable: boolean | null = null

/** True when the `claude` CLI is installed and responsive, so live generation can run here. */
export function liveAvailable(): boolean {
  if (cachedAvailable === null) {
    try {
      cachedAvailable = spawnSync('claude', ['--version'], { timeout: 5000 }).status === 0
    } catch {
      cachedAvailable = false
    }
  }
  return cachedAvailable
}

/**
 * Feed a prompt to the headless Claude Code CLI and stream its progress. `onProgress` is called
 * (throttled) with the running character count as text arrives; the resolved value carries the full
 * text plus the exact token usage, cost and duration from the final `result` event.
 */
export function completeStream(
  prompt: string,
  onProgress: (chars: number) => void,
  onSnapshot: (text: string) => void,
): Promise<GenResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      'claude',
      // stream-json (+ --verbose, which the CLI requires for it) emits one JSON event per line:
      // content_block_delta carries text chunks; the final `result` carries usage/cost/duration.
      // --append-system-prompt pins the output contract so the reply is parseable file blocks only.
      // --strict-mcp-config + an empty --mcp-config loads NO MCP servers: without this, any MCP
      // servers configured on the machine (e.g. Google Drive) leak in as tools that --tools ""
      // does not strip, so the model "writes a file" via an MCP tool, hits a permission denial, and
      // asks a clarifying question instead of emitting <<<FILE: ...>>> blocks - the generation hangs.
      ['-p', '--tools', '', '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}',
        '--output-format', 'stream-json', '--include-partial-messages', '--verbose',
        '--append-system-prompt', SYSTEM_PROMPT, '--model', modelId()],
      { stdio: ['pipe', 'pipe', 'pipe'] },
    )

    let buf = ''
    let text = ''
    let err = ''
    let result: GenResult | null = null
    let lastEmit = 0
    let settled = false
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      rejectOnce(new ClaudeError('claude CLI timed out'))
    }, TIMEOUT_MS)

    function rejectOnce(error: ClaudeError) {
      if (settled) return
      settled = true
      clearTimeout(timer)
      reject(error)
    }

    function resolveOnce(value: GenResult) {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(value)
    }

    function handleLine(line: string) {
      if (settled) return
      const trimmed = line.trim()
      if (!trimmed) return
      let o: RawClaudeEvent
      try {
        o = JSON.parse(trimmed)
      } catch {
        return
      }
      if (o.type === 'stream_event') {
        const ev = o.event as { type?: string; delta?: { text?: string } } | undefined
        if (ev?.type === 'content_block_delta' && typeof ev.delta?.text === 'string') {
          text += ev.delta.text
          emitProgress()
        }
      } else if (o.type === 'assistant') {
        // Claude Code stream-json emits assistant messages; with --include-partial-messages these
        // are usually growing snapshots, not deltas. Keep the longest version so the progress bar
        // moves without double-counting repeated partial content.
        const assistantText = assistantMessageText(o)
        if (assistantText) {
          text = assistantText.length >= text.length ? assistantText : text + assistantText
          emitProgress()
        }
      } else if (o.type === 'result') {
        const u = (o.usage ?? {}) as Record<string, number>
        result = {
          text: typeof o.result === 'string' && o.result ? o.result : text,
          usage: {
            input: u.input_tokens ?? 0,
            output: u.output_tokens ?? 0,
            cacheRead: u.cache_read_input_tokens ?? 0,
            cacheCreate: u.cache_creation_input_tokens ?? 0,
          },
          costUsd: (o.total_cost_usd as number) ?? 0,
          durationMs: (o.duration_ms as number) ?? 0,
        }
        if (o.is_error) {
          rejectOnce(new ClaudeError(formatClaudeError(o, err)))
          child.kill('SIGKILL')
        }
      }
    }

    function emitProgress() {
      if (settled) return
      const now = Date.now()
      if (now - lastEmit > PROGRESS_THROTTLE_MS) {
        lastEmit = now
        onProgress(text.length)
        onSnapshot(text)
      }
    }

    child.stdout.on('data', (d) => {
      buf += d.toString()
      let idx: number
      while ((idx = buf.indexOf('\n')) >= 0) {
        handleLine(buf.slice(0, idx))
        buf = buf.slice(idx + 1)
      }
    })
    child.stderr.on('data', (d) => (err += d))
    child.on('error', (e) => {
      rejectOnce(new ClaudeError(`failed to spawn claude: ${e.message}`))
    })
    child.on('close', (code) => {
      if (buf.trim()) handleLine(buf)
      if (settled) return
      if (code !== 0) return rejectOnce(new ClaudeError(`claude CLI exited ${code}: ${formatProcessError(err, result?.text)}`))
      if (!result) return rejectOnce(new ClaudeError(`claude CLI produced no result event${err.trim() ? `: ${compact(err)}` : ''}`))
      onProgress(result.text.length)
      onSnapshot(result.text)
      resolveOnce(result)
    })

    child.stdin.write(prompt)
    child.stdin.end()
  })
}

function assistantMessageText(event: RawClaudeEvent): string {
  const message = event.message as { content?: unknown } | undefined
  const content = message?.content
  if (!Array.isArray(content)) return ''
  return content
    .map((part) => {
      if (part && typeof part === 'object' && 'text' in part) {
        const text = (part as { text?: unknown }).text
        return typeof text === 'string' ? text : ''
      }
      return ''
    })
    .join('')
}

function formatClaudeError(event: RawClaudeEvent, stderr: string): string {
  const parts: string[] = []
  const result = typeof event.result === 'string' ? compact(event.result, 1200) : ''
  if (result) parts.push(result)

  const errors = event.errors
  if (Array.isArray(errors)) {
    for (const error of errors.slice(0, 3)) {
      if (typeof error === 'string') parts.push(compact(error, 1200))
    }
  }

  const subtype = typeof event.subtype === 'string' ? event.subtype : ''
  if (subtype && subtype !== 'success') parts.push(subtype)

  const stderrMsg = compact(stderr, 1200)
  if (stderrMsg) parts.push(stderrMsg)

  return parts.length ? `Claude Code: ${parts.join(' | ')}` : 'Claude Code failed without an error message'
}

function formatProcessError(stderr: string, stdoutResult?: string): string {
  const result = compact(stdoutResult ?? '', 1200)
  const err = compact(stderr, 1200)
  return result || err || 'no error details were returned'
}

function compact(value: string, max = 1200): string {
  const text = value.replace(/\s+/g, ' ').trim()
  return text.length > max ? `${text.slice(0, max)}...` : text
}

const FILE_RE = /<<<FILE:\s*([^\n>]+?)\s*>>>\n([\s\S]*?)(?=\n?<<<FILE:|\n?<<<END FILE>>>|$)/g
const FENCE_WRAP = /^```[^\n]*\n([\s\S]*)\n```$/

function unwrapFence(body: string): string {
  const m = FENCE_WRAP.exec(body.trim())
  return m ? m[1] : body
}

/** Parse a model response into { path: content } using the `<<<FILE: path>>>` markers. */
export function parseFiles(text: string): Record<string, string> {
  const files: Record<string, string> = {}
  for (const m of text.matchAll(FILE_RE)) {
    const name = m[1].trim()
    files[name] = unwrapFence(m[2]).replace(/\n+$/, '')
  }
  return files
}
