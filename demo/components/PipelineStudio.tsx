'use client'

// The whole page, as one guided step-by-step pipeline:
//   1. a prompt generates the format specification (SPEC.md + rv.schema.json)
//   2. a short prompt + that spec generates a reader/writer in a chosen language
//   3. a live demo builds random variables, serializes them and samples them
//   4. an independent oracle proves "Python == TypeScript == Rust"
// One step is active at a time; the stepper runs 1 → last. The proof step shows only the proof.
// Two modes share the flow - REPLAY shows the committed canonical artifacts (deterministic, no
// network); LIVE calls the Claude Code CLI via the /api/generate route.

// Core
import { useState } from 'react'
// Components
import { GenerationProgress } from '@/components/GenerationProgress'
import { LiveDemo } from '@/components/LiveDemo'
import { LiveProof } from '@/components/LiveProof'
import { Studio } from '@/components/Studio'
// Hooks
import { useGeneration, type GenState } from '@/hooks/useGeneration'
// Services
import { loadLiveEngine, type LiveEngine } from '@/lib/live-engine'
// Types
import type { LiveProofCase } from '@/lib/conformance'
import type { Language, PipelineMode } from '@/types/pipeline'

interface Props {
  /** Full canonical prompts - shown read-only in Replay (they produce the committed artifacts). */
  prompts: { spec: string; impl: string }
  /** Compact prompts used (and editable) in Live, so a watch-it-stream run finishes in seconds. */
  livePrompts: { spec: string; impl: string }
  canonicalSpec: { specMd: string; schema: string }
  canonicalImpl: Record<Language, Record<string, string>>
  liveAvailable: boolean
  /** Server-rendered cross-language proof (the ConformancePanel), shown on the last step in Replay. */
  proofSlot: React.ReactNode
  /** Frozen normal/uniform golden cases the live-generated engine is proven against in Live mode. */
  liveProofCases: LiveProofCase[]
}

const LANGUAGES: Language[] = ['python', 'typescript', 'rust']
const STEPS = ['Specification', 'Implementation', 'Demo', 'Proof']
const LAST = STEPS.length

export function PipelineStudio({ prompts, livePrompts, canonicalSpec, canonicalImpl, liveAvailable, proofSlot, liveProofCases }: Props) {
  const [mode, setMode] = useState<PipelineMode>('replay')
  const [step, setStep] = useState(1)

  // Results carried across steps. The editable prompts seed from the compact Live versions; Replay
  // shows the full canonical prompts (read-only) instead - see `displayPrompt` below.
  const [specPrompt, setSpecPrompt] = useState(livePrompts.spec)
  const [specFiles, setSpecFiles] = useState<Record<string, string> | null>(null)
  const [implPrompt, setImplPrompt] = useState(livePrompts.impl)
  const [language, setLanguage] = useState<Language>('python')
  const [implByLang, setImplByLang] = useState<Partial<Record<Language, Record<string, string>>>>({})

  // Live-only: the generated JavaScript engine that powers steps 3-4. `engineFiles` is the raw
  // generated source (for the viewer); `engine` is the loaded module once it passes the contract.
  const [engineFiles, setEngineFiles] = useState<Record<string, string> | null>(null)
  const [engine, setEngine] = useState<LiveEngine | null>(null)
  const [engineError, setEngineError] = useState<string | null>(null)

  // Live generation drivers (elapsed timer + token/progress stream). Replay sets files directly.
  const specGen = useGeneration()
  const implGen = useGeneration()

  function resetEngine() {
    setEngineFiles(null)
    setEngine(null)
    setEngineError(null)
  }

  function switchMode(m: PipelineMode) {
    setMode(m)
    setStep(1)
    setSpecFiles(null)
    setImplByLang({})
    resetEngine()
    specGen.reset()
    implGen.reset()
  }

  async function runSpec() {
    if (mode === 'replay') {
      specGen.reset()
      setSpecFiles({ 'SPEC.md': canonicalSpec.specMd, 'rv.schema.json': canonicalSpec.schema })
      return
    }
    const files = await specGen.run({ stage: 'spec', prompt: specPrompt, compact: true })
    if (files) setSpecFiles(files)
  }

  async function runImpl() {
    if (mode === 'replay') {
      implGen.reset()
      setImplByLang((s) => ({ ...s, [language]: canonicalImpl[language] }))
      return
    }
    // Live: generate one JavaScript engine, then load it so steps 3-4 can run it.
    resetEngine()
    const files = await implGen.run({ stage: 'impl', prompt: implPrompt, compact: true })
    if (!files) return
    setEngineFiles(files)
    const source = files['engine.js'] ?? Object.values(files)[0]
    try {
      setEngine(await loadLiveEngine(source))
    } catch (e) {
      setEngineError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <section className="space-y-5 rounded-2xl bg-slate-900/40 p-4 ring-1 ring-slate-800 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-white">How the format builds itself</h2>
          <p className="mt-1 max-w-2xl text-sm text-slate-400">
            Walk the pipeline end to end: a prompt writes the specification, a second short prompt turns
            that spec into working code, a live demo exercises the format, and an independent oracle
            proves the result.
          </p>
        </div>
        <ModeToggle mode={mode} switchMode={switchMode} liveAvailable={liveAvailable} />
      </div>

      <Stepper step={step} />

      {step === 1 && (
        <SpecStep
          mode={mode}
          prompt={mode === 'live' ? specPrompt : prompts.spec}
          setPrompt={setSpecPrompt}
          files={specFiles}
          gen={specGen.state}
          onRun={runSpec}
          onNext={() => setStep(2)}
        />
      )}

      {step === 2 && (
        <ImplStep
          mode={mode}
          prompt={mode === 'live' ? implPrompt : prompts.impl}
          setPrompt={setImplPrompt}
          language={language}
          setLanguage={setLanguage}
          files={mode === 'live' ? engineFiles : implByLang[language] ?? null}
          generatedLangs={Object.keys(implByLang) as Language[]}
          engine={engine}
          engineError={engineError}
          gen={implGen.state}
          onRun={runImpl}
          onBack={() => setStep(1)}
          onNext={() => setStep(3)}
        />
      )}

      {step === 3 && (
        <DemoStep mode={mode} engine={engine} onBack={() => setStep(2)} onNext={() => setStep(4)} />
      )}

      {step === 4 && (
        <ProofStep
          mode={mode}
          proofSlot={proofSlot}
          engine={engine}
          liveProofCases={liveProofCases}
          onBack={() => setStep(3)}
          onRestart={() => {
            setStep(1)
            setSpecFiles(null)
            setImplByLang({})
            resetEngine()
          }}
        />
      )}
    </section>
  )
}

// ---------- chrome ----------

function ModeToggle({
  mode,
  switchMode,
  liveAvailable,
}: {
  mode: PipelineMode
  switchMode: (m: PipelineMode) => void
  liveAvailable: boolean
}) {
  return (
    <div className="flex flex-col items-end gap-1">
      <div className="inline-flex rounded-lg bg-slate-800 p-0.5 text-sm">
        <button
          onClick={() => switchMode('replay')}
          className={`rounded-md px-3 py-1 font-medium transition ${
            mode === 'replay' ? 'bg-sky-500 text-white' : 'text-slate-300 hover:text-white'
          }`}
        >
          Replay
        </button>
        <button
          onClick={() => switchMode('live')}
          className={`rounded-md px-3 py-1 font-medium transition ${
            mode === 'live' ? 'bg-emerald-500 text-white' : 'text-slate-300 hover:text-white'
          }`}
        >
          Live (Claude)
        </button>
      </div>
      <p className="max-w-[16rem] text-right text-xs text-slate-500">
        {mode === 'replay'
          ? 'Committed canonical output — deterministic, no network.'
          : liveAvailable
            ? 'Generates fresh via the Claude Code CLI (server-side).'
            : 'claude CLI not found here — live will error; use Replay.'}
      </p>
    </div>
  )
}

function Stepper({ step }: { step: number }) {
  return (
    <ol className="flex items-center gap-2 text-sm">
      {STEPS.map((label, i) => {
        const n = i + 1
        const state = n < step ? 'done' : n === step ? 'current' : 'todo'
        return (
          <li key={label} className="flex flex-1 items-center gap-2">
            <span
              className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                state === 'done'
                  ? 'bg-emerald-500 text-white'
                  : state === 'current'
                    ? 'bg-sky-500 text-white'
                    : 'bg-slate-800 text-slate-500'
              }`}
            >
              {state === 'done' ? '✓' : n}
            </span>
            <span className={state === 'todo' ? 'text-slate-500' : 'text-slate-200'}>{label}</span>
            {n < STEPS.length && <span className="mx-1 hidden h-px flex-1 bg-slate-800 sm:block" />}
          </li>
        )
      })}
    </ol>
  )
}

// ---------- step 1 ----------

function SpecStep({
  mode,
  prompt,
  setPrompt,
  files,
  gen,
  onRun,
  onNext,
}: {
  mode: PipelineMode
  prompt: string
  setPrompt: (v: string) => void
  files: Record<string, string> | null
  gen: GenState
  onRun: () => void
  onNext: () => void
}) {
  return (
    <StepBody
      title="Step 1 — Write the specification"
      info="One prompt states the requirements (which distributions, parameterization, numerical rules). The model returns two artifacts at once: a human-readable SPEC.md and a machine-readable rv.schema.json. This is the contract everything else builds on."
    >
      <PromptBox value={prompt} onChange={setPrompt} editable={mode === 'live'} label="Prompt #1" />
      <RunButton mode={mode} loading={gen.status === 'running'} onRun={onRun} label="specification" done={!!files} />
      {mode === 'live' && <GenerationProgress state={gen} />}
      {files && (
        <>
          <DownloadRow files={files} />
          <FileViewer key={Object.keys(files).join(',')} files={files} />
        </>
      )}
      <NavRow>
        <NextButton onClick={onNext} enabled={!!files} hint="Generate the spec to continue" label="Continue to code →" />
      </NavRow>
    </StepBody>
  )
}

function DownloadRow({ files }: { files: Record<string, string> }) {
  return (
    <div className="flex flex-wrap gap-2">
      <DownloadButton name="SPEC.md" content={files['SPEC.md']} label="⬇ SPEC.md (human-readable)" />
      <DownloadButton name="rv.schema.json" content={files['rv.schema.json']} label="⬇ rv.schema.json (machine-readable)" />
    </div>
  )
}

function DownloadButton({ name, content, label }: { name: string; content: string | undefined; label: string }) {
  if (content === undefined) return null
  return (
    <button
      onClick={() => downloadText(name, content)}
      className="rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-200 ring-1 ring-slate-700 transition hover:bg-slate-700"
    >
      {label}
    </button>
  )
}

// ---------- step 2 ----------

function ImplStep({
  mode,
  prompt,
  setPrompt,
  language,
  setLanguage,
  files,
  generatedLangs,
  engine,
  engineError,
  gen,
  onRun,
  onBack,
  onNext,
}: {
  mode: PipelineMode
  prompt: string
  setPrompt: (v: string) => void
  language: Language
  setLanguage: (l: Language) => void
  files: Record<string, string> | null
  generatedLangs: Language[]
  engine: LiveEngine | null
  engineError: string | null
  gen: GenState
  onRun: () => void
  onBack: () => void
  onNext: () => void
}) {
  const live = mode === 'live'
  return (
    <StepBody
      title="Step 2 — Generate the engine"
      info={
        live
          ? 'A tiny prompt, plus the spec from step 1, generates one browser-ready JavaScript engine with a fixed API. The demo and proof below run this exact code — so what Claude writes here is what gets exercised and verified next.'
          : 'A deliberately tiny prompt, plus the machine-readable spec from step 1, produces a full reader/writer in the language you pick. The prompt carries no maths — the spec does all the work. Generate one, two, or all three languages from the same spec.'
      }
    >
      {live ? (
        <p className="text-xs text-slate-400">
          Live generates <span className="text-slate-200">JavaScript</span> so it can run in your browser. The
          cross-language proof in step 4 still checks it against the frozen Python (scipy) and Rust references.
        </p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {LANGUAGES.map((l) => (
            <button
              key={l}
              onClick={() => setLanguage(l)}
              className={`relative rounded-md px-3 py-1 text-sm font-medium transition ${
                language === l ? 'bg-sky-500 text-white' : 'bg-slate-800 text-slate-300 hover:text-white'
              }`}
            >
              {l}
              {generatedLangs.includes(l) && <span className="ml-1 text-emerald-300">✓</span>}
            </button>
          ))}
        </div>
      )}
      <PromptBox value={prompt} onChange={setPrompt} editable={live} label="Prompt #2 (short)" />
      <RunButton
        mode={mode}
        loading={gen.status === 'running'}
        onRun={onRun}
        label={live ? 'JavaScript engine' : `${language} reader/writer`}
        done={live ? !!engine : !!files}
      />
      {live && <GenerationProgress state={gen} />}
      {live && engineError && (
        <div className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-300 ring-1 ring-red-500/30">
          The generated engine didn’t match the required API: {engineError}. Regenerate, or switch to Replay.
        </div>
      )}
      {live && engine && (
        <div className="rounded-lg bg-emerald-500/10 px-3 py-2 text-sm text-emerald-300 ring-1 ring-emerald-500/30">
          Engine loaded ✓ — it exposes the full contract and is ready to drive the demo and proof.
        </div>
      )}
      {files && <FileViewer key={(live ? 'live' : language) + Object.keys(files).join(',')} files={files} />}
      <NavRow>
        <BackButton onClick={onBack} />
        <NextButton
          onClick={onNext}
          enabled={live ? !!engine : generatedLangs.length > 0}
          hint={live ? 'Generate the engine to continue' : 'Generate at least one implementation'}
          label="Continue to demo →"
        />
      </NavRow>
    </StepBody>
  )
}

// ---------- step 3 (demo) ----------

function DemoStep({
  mode,
  engine,
  onBack,
  onNext,
}: {
  mode: PipelineMode
  engine: LiveEngine | null
  onBack: () => void
  onNext: () => void
}) {
  const live = mode === 'live'
  return (
    <StepBody
      title="Step 3 — Use the format"
      info={
        live
          ? 'Build a normal or uniform random variable. It serializes to a portable .rv.json document and is sampled and evaluated by the JavaScript engine you generated in step 2 — the very same code the proof validates next.'
          : 'Build random variables of different kinds (a distribution, a transform of one, or a mixture). Each serializes to a portable .rv.json document and is sampled off-thread by the canonical engine — the same format the proof step validates across languages.'
      }
    >
      {live ? (
        engine ? (
          <LiveDemo engine={engine} />
        ) : (
          <NeedEngine />
        )
      ) : (
        <Studio />
      )}
      <NavRow>
        <BackButton onClick={onBack} />
        <NextButton onClick={onNext} enabled={!live || !!engine} hint="Generate the engine in step 2" label="Continue to proof →" />
      </NavRow>
    </StepBody>
  )
}

function NeedEngine() {
  return (
    <div className="rounded-lg bg-amber-500/10 px-4 py-3 text-sm text-amber-200 ring-1 ring-amber-500/30">
      No generated engine yet — go back to step 2 and generate the JavaScript engine, then this step runs it.
    </div>
  )
}

// ---------- step 4 (proof only) ----------

function ProofStep({
  mode,
  proofSlot,
  engine,
  liveProofCases,
  onBack,
  onRestart,
}: {
  mode: PipelineMode
  proofSlot: React.ReactNode
  engine: LiveEngine | null
  liveProofCases: LiveProofCase[]
  onBack: () => void
  onRestart: () => void
}) {
  return (
    <div className="space-y-3">
      {mode === 'live' ? engine ? <LiveProof engine={engine} cases={liveProofCases} /> : <NeedEngine /> : proofSlot}
      <NavRow>
        <BackButton onClick={onBack} />
        <button onClick={onRestart} className="rounded-lg px-4 py-2 text-sm font-medium text-slate-300 hover:text-white">
          ↻ Start over
        </button>
      </NavRow>
    </div>
  )
}

// ---------- shared building blocks ----------

function StepBody({ title, info, children }: { title: string; info: string; children: React.ReactNode }) {
  return (
    <div className="space-y-3 rounded-xl bg-slate-950/40 p-4 ring-1 ring-slate-800">
      <h3 className="font-semibold text-white">{title}</h3>
      <p className="rounded-lg bg-sky-500/5 px-3 py-2 text-sm leading-relaxed text-slate-300 ring-1 ring-sky-500/10">
        {info}
      </p>
      {children}
    </div>
  )
}

function PromptBox({ value, onChange, editable, label }: { value: string; onChange: (v: string) => void; editable: boolean; label: string }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/60">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between px-3 py-2 text-left text-xs font-medium text-slate-300"
      >
        <span>
          {open ? '▾' : '▸'} {label} {editable ? '(editable)' : '(read-only in replay)'}
        </span>
        <span className="text-slate-500">{value.length} chars</span>
      </button>
      {open && (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          readOnly={!editable}
          spellCheck={false}
          className="h-48 w-full resize-y rounded-b-lg bg-slate-950 p-3 font-mono text-xs text-slate-300 outline-none"
        />
      )}
    </div>
  )
}

function RunButton({ mode, loading, onRun, label, done }: { mode: PipelineMode; loading: boolean; onRun: () => void; label: string; done: boolean }) {
  return (
    <button
      onClick={onRun}
      disabled={loading}
      className={`w-fit rounded-lg px-4 py-2 text-sm font-semibold text-white transition disabled:opacity-50 ${
        mode === 'live' ? 'bg-emerald-500 hover:bg-emerald-400' : 'bg-sky-500 hover:bg-sky-400'
      }`}
    >
      {loading ? 'Generating…' : done ? `Regenerate ${label}` : mode === 'live' ? `Generate ${label} (Claude)` : `Show generated ${label}`}
    </button>
  )
}

function FileViewer({ files }: { files: Record<string, string> }) {
  const names = Object.keys(files)
  const [active, setActive] = useState(names[0] ?? '')
  const current = files[active] ?? files[names[0]] ?? ''
  return (
    <div className="grid gap-2 sm:grid-cols-[minmax(8rem,12rem)_1fr]">
      <div className="flex max-h-72 flex-wrap gap-1 overflow-auto sm:flex-col sm:flex-nowrap">
        {names.map((n) => (
          <button
            key={n}
            onClick={() => setActive(n)}
            className={`rounded-md px-2 py-1 text-left font-mono text-xs transition ${
              n === active ? 'bg-slate-700 text-white' : 'bg-slate-800/60 text-slate-400 hover:text-slate-200'
            }`}
          >
            {n}
          </button>
        ))}
      </div>
      <pre className="max-h-72 overflow-auto rounded-md bg-slate-950 p-3 text-xs leading-relaxed text-slate-300">
        <code>{current}</code>
      </pre>
    </div>
  )
}

function NavRow({ children }: { children: React.ReactNode }) {
  return <div className="flex items-center justify-between gap-3 pt-1">{children}</div>
}

function BackButton({ onClick }: { onClick: () => void }) {
  return (
    <button onClick={onClick} className="rounded-lg px-4 py-2 text-sm font-medium text-slate-300 hover:text-white">
      ← Back
    </button>
  )
}

function NextButton({ onClick, enabled, hint, label }: { onClick: () => void; enabled: boolean; hint: string; label: string }) {
  return (
    <div className="ml-auto flex items-center gap-2">
      {!enabled && <span className="text-xs text-slate-500">{hint}</span>}
      <button
        onClick={onClick}
        disabled={!enabled}
        className="rounded-lg bg-slate-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-600 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {label}
      </button>
    </div>
  )
}

function downloadText(name: string, content: string) {
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
