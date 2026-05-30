// Server component shell. Renders the interactive client island (Studio) and the server-rendered
// cross-language evidence (ConformancePanel), keeping client JavaScript to just the builder/chart.

// Components
import { ConformancePanel } from '@/components/ConformancePanel'
import { Footer } from '@/components/Footer'
import { Studio } from '@/components/Studio'

export default function Page() {
  return (
    <div className="min-h-screen">
      <main className="mx-auto max-w-7xl space-y-8 px-6 py-10 lg:px-8">
        <header className="flex items-start justify-between gap-6">
          <div className="space-y-3">
            <p className="text-sm font-medium uppercase tracking-wider text-sky-400">RV Exchange Format v1</p>
            <h1 className="text-3xl font-bold text-white sm:text-4xl">
              One random variable, three languages, one answer.
            </h1>
            <p className="max-w-3xl text-slate-400">
              Build a random variable below: a distribution, a transform of one, or a mixture. It
              serializes to a portable <code className="text-slate-300">.rv.json</code> document that any
              conforming implementation reconstructs identically. Samples are drawn off-thread in a Web
              Worker by the TypeScript engine; the analytic density is overlaid live.
            </p>
          </div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/logo.jpg"
            alt="Materials Center Leoben"
            className="hidden h-12 w-auto shrink-0 rounded-md sm:block"
          />
        </header>

        <Studio />
        <ConformancePanel />
      </main>
      <Footer />
    </div>
  )
}
