'use client'

// Core
import { useState } from 'react'

/** The live `.rv.json` document, with copy-to-clipboard — this is the portable artifact other
 *  languages consume. */
export function JsonPreview({ value }: { value: unknown }) {
  const [copied, setCopied] = useState(false)
  const text = JSON.stringify(value, null, 2)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1200)
    } catch {
      /* clipboard unavailable; ignore */
    }
  }

  return (
    <div className="relative">
      <button
        onClick={copy}
        className="absolute right-2 top-2 rounded-md bg-slate-700/70 px-2.5 py-1 text-xs text-slate-200 hover:bg-slate-600"
      >
        {copied ? 'copied' : 'copy'}
      </button>
      <pre className="max-h-80 overflow-auto rounded-lg bg-slate-950/70 p-4 text-xs leading-relaxed text-slate-300 ring-1 ring-slate-800">
        <code>{text}</code>
      </pre>
    </div>
  )
}
