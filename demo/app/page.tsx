// Server component shell. The whole page is one step-by-step pipeline (PipelineStudio); the builder
// demo and the cross-language proof are steps inside it. The proof is a server component passed in as
// a slot, so it renders with zero client JavaScript and appears only on the final step.

// Components
import { ConformancePanel } from '@/components/ConformancePanel'
import { Footer } from '@/components/Footer'
import { PipelineStudio } from '@/components/PipelineStudio'
// Services
import { liveAvailable } from '@/lib/claude'
import { loadCanonicalImpl, loadCanonicalSpec, loadPrompts } from '@/lib/pipeline-data'
// Types
import type { Language } from '@/types/pipeline'

export default function Page() {
  const prompts = loadPrompts()
  const canonicalSpec = loadCanonicalSpec()
  const canonicalImpl = {
    python: loadCanonicalImpl('python'),
    typescript: loadCanonicalImpl('typescript'),
    rust: loadCanonicalImpl('rust'),
  } as Record<Language, Record<string, string>>

  return (
    <div className="min-h-screen overflow-x-hidden">
      <main className="mx-auto max-w-7xl space-y-6 px-4 py-8 sm:space-y-8 sm:px-6 sm:py-10 lg:px-8">
        <header className="flex items-start justify-between gap-4 sm:gap-6">
          <div className="space-y-2 sm:space-y-3">
            <p className="text-xs font-medium uppercase tracking-wider text-sky-400 sm:text-sm">RV Exchange Format v1</p>
            <h1 className="text-2xl font-bold text-white sm:text-3xl lg:text-4xl">
              One random variable, three languages, one answer.
            </h1>
            <p className="max-w-3xl text-sm text-slate-400 sm:text-base">
              A prompt writes the format specification, a second short prompt turns it into a
              reader/writer in any language, a live demo exercises the portable{' '}
              <code className="text-slate-300">.rv.json</code> format, and an independent oracle proves
              the implementations agree. Step through it below.
            </p>
          </div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/images/brand/mcl-logo.jpg"
            alt="Materials Center Leoben"
            className="hidden h-10 w-auto shrink-0 rounded-md sm:block lg:h-12"
          />
        </header>

        <PipelineStudio
          prompts={prompts}
          canonicalSpec={canonicalSpec}
          canonicalImpl={canonicalImpl}
          liveAvailable={liveAvailable()}
          proofSlot={<ConformancePanel />}
        />
      </main>
      <Footer />
    </div>
  )
}
