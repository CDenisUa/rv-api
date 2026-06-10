'use client'

// Formal task demo: generate a list of RVs in one framework (TypeScript/React), write/export it as
// RV documents, then read/import those same documents in another language runtime (Rust/WASM).

// Core
import { useEffect, useMemo, useRef, useState } from 'react'
// Components
import { JsonPreview } from '@/components/JsonPreview'
// Services
import { capabilities, moments, parseDocument, toDocument } from 'rvx'
import { BATCH_ITEMS, buildRvListBundle, type BatchItem, type BatchRvType } from '@/lib/batch-docs'
import { canonicalText, canonicalize } from '@/lib/canonical-json'
import { SamplerClient } from '@/lib/worker-client'
// Utils
import { fmt, fmtMoment } from '@/lib/format'

const SAMPLE_N = 12_000

interface BatchSource {
  /** 'built-in' for the TypeScript-written list, otherwise the uploaded file name. */
  name: string
  /** Producer language declared by an uploaded bundle (e.g. "Python"). */
  producer?: string
  items: BatchItem[]
}

const BUILT_IN: BatchSource = { name: 'built-in', items: BATCH_ITEMS }

/** Parse an uploaded `.rv-list.json` bundle into batch items (throws on a malformed bundle). */
function parseBundle(text: string, fileName: string): BatchSource {
  const bundle = JSON.parse(text) as Record<string, unknown>
  if (bundle['kind'] !== 'rv_list' || !Array.isArray(bundle['items'])) {
    throw new Error('not an .rv-list.json bundle (expected kind="rv_list" with items[])')
  }
  const items: BatchItem[] = (bundle['items'] as Record<string, unknown>[]).map((it, i) => ({
    id: String(it['id'] ?? `item_${i}`),
    label: String(it['label'] ?? it['id'] ?? `item ${i}`),
    type: it['type'] === 'discrete' ? 'discrete' : 'continuous',
    doc: it['document'] as BatchItem['doc'],
  }))
  if (items.length === 0) throw new Error('bundle has no items')
  const producer = (bundle['producer'] as Record<string, unknown> | undefined)?.['language']
  return { name: fileName, ...(producer ? { producer: String(producer) } : {}), items }
}

interface ExportRow {
  id: string
  label: string
  type: BatchRvType
  document: Record<string, unknown>
  caps: string
  moments: string
  error: string | null
}

interface RustImport {
  status: 'pending' | 'ok' | 'error'
  mean?: number
  variance?: number
  error?: string
}

function buildRows(batchItems: BatchItem[]): ExportRow[] {
  return batchItems.map((item) => {
    try {
      const node = parseDocument(item.doc)
      const doc = toDocument(node, { metadata: item.doc.metadata })
      const caps = capabilities(node)
      let momentText = 'unavailable'
      try {
        const [mean, variance] = moments(node)
        momentText = `${fmtMoment(mean)} / ${fmtMoment(variance)}`
      } catch {
        momentText = 'sample only'
      }
      return {
        id: item.id,
        label: item.label,
        type: item.type,
        document: doc,
        caps: compactCaps(caps),
        moments: momentText,
        error: null,
      }
    } catch (e) {
      return {
        id: item.id,
        label: item.label,
        type: item.type,
        document: item.doc as Record<string, unknown>,
        caps: '-',
        moments: '-',
        error: e instanceof Error ? e.message : String(e),
      }
    }
  })
}

export function BatchDemo() {
  const [seed, setSeed] = useState(4242)
  const [source, setSource] = useState<BatchSource>(BUILT_IN)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const rows = useMemo(() => buildRows(source.items), [source])
  const bundle = useMemo(
    () =>
      buildRvListBundle(
        rows.map((row) => ({
          id: row.id,
          label: row.label,
          type: row.type,
          document: row.document,
        })),
      ),
    [rows],
  )
  const [imports, setImports] = useState<Record<string, RustImport>>(() => pending(rows))

  useEffect(() => {
    let cancelled = false
    const client = new SamplerClient()
    setImports(pending(rows))

    Promise.all(
      rows.map(async (row, index) => {
        if (row.error) return [row.id, { status: 'error', error: row.error } satisfies RustImport] as const
        try {
          const res = await client.sample(row.document, SAMPLE_N, seed + index * 101, 'wasm', 0)
          return [
            row.id,
            {
              status: 'ok',
              mean: res.mean ?? 0,
              variance: res.variance ?? 0,
            } satisfies RustImport,
          ] as const
        } catch (e) {
          return [row.id, { status: 'error', error: e instanceof Error ? e.message : String(e) } satisfies RustImport] as const
        }
      }),
    ).then((pairs) => {
      if (!cancelled) setImports(Object.fromEntries(pairs) as Record<string, RustImport>)
    })

    return () => {
      cancelled = true
      client.terminate()
    }
  }, [rows, seed])

  const canonicalBundle = useMemo(() => canonicalize(bundle), [bundle])
  const exportedText = canonicalText(bundle)
  const okCount = Object.values(imports).filter((r) => r.status === 'ok').length

  function onUpload(file: File) {
    file
      .text()
      .then((text) => {
        setSource(parseBundle(text, file.name))
        setUploadError(null)
      })
      .catch((e) => setUploadError(e instanceof Error ? e.message : String(e)))
  }

  return (
    <section className="space-y-4 rounded-2xl bg-slate-900/40 p-4 ring-1 ring-slate-800 sm:p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-white">Batch export/import</h2>
          <p className="mt-1 max-w-3xl text-sm leading-relaxed text-slate-400">
            TypeScript builds a mixed list of RV documents (discrete and continuous), writes the
            canonical export bundle, and the Rust WebAssembly engine reads the same documents in a
            worker. Or upload an <code className="text-slate-300">.rv-list.json</code> written by
            another language - e.g. the Python writer in{' '}
            <code className="text-slate-300">demo/cli/write_rv_list.py</code>.
          </p>
          <p className="mt-1 text-xs text-slate-500">
            source: <span className="text-slate-300">{source.name}</span>
            {source.producer ? <> · written by <span className="text-slate-300">{source.producer}</span></> : null}
            {source.name !== 'built-in' ? (
              <button onClick={() => { setSource(BUILT_IN); setUploadError(null) }} className="ml-2 text-sky-400 hover:text-sky-300">
                reset to built-in
              </button>
            ) : null}
          </p>
          {uploadError ? <p className="mt-1 text-xs text-red-300">upload failed: {uploadError}</p> : null}
        </div>
        <div className="flex flex-wrap justify-start gap-2 sm:justify-end">
          <input
            ref={fileInput}
            type="file"
            accept=".json,application/json"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) onUpload(file)
              e.target.value = ''
            }}
          />
          <button
            onClick={() => fileInput.current?.click()}
            className="rounded-md bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-200 ring-1 ring-slate-700 hover:bg-slate-700"
          >
            upload list
          </button>
          <button
            onClick={() => setSeed((s) => s + 1)}
            className="rounded-md bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-200 ring-1 ring-slate-700 hover:bg-slate-700"
          >
            re-import
          </button>
          <button
            onClick={() => download('rv-batch.rv-list.json', exportedText)}
            className="rounded-md bg-sky-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-sky-400"
          >
            download list
          </button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_minmax(320px,0.85fr)]">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs uppercase tracking-wider text-slate-500">
              <tr>
                <th className="py-2 pr-4 font-medium">RV</th>
                <th className="py-2 pr-4 font-medium">type</th>
                <th className="py-2 pr-4 font-medium">TS write</th>
                <th className="py-2 pr-4 font-medium">Rust import</th>
                <th className="py-2 font-medium">Rust sample mean / var</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const imported = imports[row.id] ?? { status: 'pending' as const }
                return (
                  <tr key={row.id} className="border-t border-slate-800">
                    <td className="py-2 pr-4">
                      <div className="font-medium text-slate-200">{row.label}</div>
                      <div className="text-xs text-slate-500">{row.id}</div>
                    </td>
                    <td className="py-2 pr-4">
                      <TypeBadge type={row.type} />
                    </td>
                    <td className="py-2 pr-4 text-xs text-slate-400">
                      {row.error ? <span className="text-red-300">{row.error}</span> : `canonical .rv.json · ${row.caps}`}
                    </td>
                    <td className="py-2 pr-4 text-xs">
                      <ImportBadge result={imported} />
                    </td>
                    <td className="py-2 text-xs tabular-nums text-slate-300">
                      {imported.status === 'ok' ? `${fmt(imported.mean ?? 0)} / ${fmt(imported.variance ?? 0)}` : row.moments}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <p className="mt-3 text-xs text-slate-500">
            {okCount}/{rows.length} documents imported by Rust/WASM from the{' '}
            {source.name === 'built-in' ? 'TypeScript-written' : `uploaded (${source.name})`} bundle
            (n={SAMPLE_N.toLocaleString()}, seed {seed}). Joint rows show dimension 0.
          </p>
        </div>

        <div>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">
            Exported .rv-list.json
          </h3>
          <JsonPreview value={canonicalBundle} />
        </div>
      </div>
    </section>
  )
}

function pending(rows: ExportRow[]): Record<string, RustImport> {
  return Object.fromEntries(
    rows.map((row) => [
      row.id,
      { status: row.error ? 'error' : 'pending', error: row.error ?? undefined } satisfies RustImport,
    ]),
  ) as Record<string, RustImport>
}

function compactCaps(caps: { can_sample: boolean; can_log_prob: boolean; can_cdf: boolean }): string {
  return [
    caps.can_sample ? 'sample' : null,
    caps.can_log_prob ? 'log_prob' : null,
    caps.can_cdf ? 'cdf' : null,
  ]
    .filter(Boolean)
    .join('+')
}

function TypeBadge({ type }: { type: BatchRvType }) {
  return (
    <span className={`rounded px-2 py-0.5 text-xs font-medium ${type === 'discrete' ? 'bg-fuchsia-500/15 text-fuchsia-300' : 'bg-emerald-500/15 text-emerald-300'}`}>
      {type}
    </span>
  )
}

function ImportBadge({ result }: { result: RustImport }) {
  if (result.status === 'pending') return <span className="text-slate-500">reading...</span>
  if (result.status === 'error') return <span className="text-red-300">{result.error}</span>
  return <span className="text-emerald-300">read + sampled</span>
}

function download(name: string, text: string) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }))
  a.download = name
  a.click()
  URL.revokeObjectURL(a.href)
}
