// Live generation endpoint. Runs server-side and shells out to the local Claude Code CLI. It mirrors
// pipeline/run.py: Prompt #1 -> spec; Prompt #2 (+ the canonical machine-readable spec attached) ->
// one implementation. The same `<<<FILE: ...>>>` contract is parsed out of the reply.

// Core
import { NextResponse } from 'next/server'
// Services
import { ClaudeError, completeStream, modelId, parseFiles } from '@/lib/claude'
import { loadCanonicalSpec } from '@/lib/pipeline-data'
// Types
import type { GenerateRequest } from '@/types/pipeline'

// A live CLI generation (especially a full implementation) can take minutes; allow a long window.
export const maxDuration = 300

// Naive in-memory rate limit (per warm server instance) so a public deploy can't be drained.
const WINDOW_MS = 60_000
const MAX_PER_WINDOW = 5
const hits: number[] = []

function rateLimited(): boolean {
  const now = Date.now()
  while (hits.length && now - hits[0] > WINDOW_MS) hits.shift()
  if (hits.length >= MAX_PER_WINDOW) return true
  hits.push(now)
  return false
}

export async function POST(req: Request) {
  let body: GenerateRequest
  try {
    body = (await req.json()) as GenerateRequest
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 })
  }

  if (body.stage !== 'spec' && body.stage !== 'impl') {
    return NextResponse.json({ error: 'stage must be "spec" or "impl"' }, { status: 400 })
  }
  if (body.stage === 'impl' && !body.language) {
    return NextResponse.json({ error: 'language is required for stage "impl"' }, { status: 400 })
  }
  if (!body.prompt?.trim()) {
    return NextResponse.json({ error: 'prompt is empty' }, { status: 400 })
  }
  if (rateLimited()) {
    return NextResponse.json(
      { error: `rate limit: at most ${MAX_PER_WINDOW} live generations per minute` },
      { status: 429 },
    )
  }

  // For an implementation, attach the canonical machine-readable spec exactly as the CLI does.
  let prompt = body.prompt
  if (body.stage === 'impl') {
    const { schema, specMd } = loadCanonicalSpec()
    prompt =
      `${body.prompt}\n\n` +
      `--- ATTACHMENT: rv.schema.json ---\n\`\`\`json\n${schema}\n\`\`\`\n\n` +
      `--- ATTACHMENT: SPEC.md ---\n\`\`\`markdown\n${specMd}\n\`\`\`\n`
  }

  // Stream newline-delimited JSON progress events so the client can show a live timer, character
  // count and (on completion) the exact token usage. Event shapes:
  //   { type: 'progress', chars }
  //   { type: 'snapshot', text }
  //   { type: 'done', files, model, usage, costUsd, durationMs }
  //   { type: 'error', message }
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const enc = new TextEncoder()
      let closed = false
      const send = (o: unknown) => {
        if (closed) return
        try {
          controller.enqueue(enc.encode(JSON.stringify(o) + '\n'))
        } catch {
          closed = true
        }
      }
      try {
        const result = await completeStream(
          prompt,
          (chars) => send({ type: 'progress', chars }),
          (text) => send({ type: 'snapshot', text }),
        )
        const files = parseFiles(result.text)
        if (Object.keys(files).length === 0) {
          const preview = result.text.replace(/\s+/g, ' ').trim().slice(0, 300)
          send({
            type: 'error',
            message:
              `the model returned no <<<FILE: ...>>> blocks (got ${result.text.length} chars). ` +
              `It replied: "${preview}${result.text.length > 300 ? '…' : ''}". Try again, or use Replay.`,
          })
        } else {
          send({
            type: 'done',
            files,
            model: modelId(),
            usage: result.usage,
            costUsd: result.costUsd,
            durationMs: result.durationMs,
          })
        }
      } catch (e) {
        send({ type: 'error', message: e instanceof ClaudeError ? e.message : 'unexpected server error' })
      } finally {
        if (!closed) {
          closed = true
          try {
            controller.close()
          } catch {
            // The client may have disconnected after the last chunk.
          }
        }
      }
    },
  })

  return new Response(stream, {
    headers: { 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-store' },
  })
}
