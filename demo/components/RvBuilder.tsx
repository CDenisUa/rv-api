// The RV builder form. Stateless: it receives the current builder state and a setter, so all state
// lives in one place (Studio). Renders mode tabs (leaf / transform / mixture), preset shortcuts, and
// the fields for the active mode. Form metadata comes from consts/catalog.

// Core
import type { Dispatch, SetStateAction } from 'react'
// Consts
import { DISTRIBUTIONS, OPS, defaultParams, distSpec, opSpec } from '@/consts/catalog'
import { PRESETS } from '@/lib/presets'
// Types
import type { BuilderMode, BuilderState, LeafForm, OpForm } from '@/types/rv-form'

interface RvBuilderProps {
  state: BuilderState
  setState: Dispatch<SetStateAction<BuilderState>>
}

const MODES: { id: BuilderMode; label: string }[] = [
  { id: 'leaf', label: 'Leaf' },
  { id: 'transform', label: 'Transform' },
  { id: 'mixture', label: 'Mixture' },
]

export function RvBuilder({ state, setState }: RvBuilderProps) {
  return (
    <div className="space-y-5">
      <div>
        <Heading>Presets</Heading>
        <div className="flex flex-wrap gap-2">
          {PRESETS.map((preset) => (
            <button
              key={preset.id}
              title={preset.note}
              onClick={() => setState(preset.state)}
              className="rounded-md bg-slate-800 px-3 py-1.5 text-sm text-slate-200 ring-1 ring-slate-700 hover:bg-slate-700"
            >
              {preset.label}
            </button>
          ))}
        </div>
      </div>

      <div>
        <Heading>Kind</Heading>
        <div className="inline-flex rounded-lg bg-slate-800 p-1 ring-1 ring-slate-700">
          {MODES.map((m) => (
            <button
              key={m.id}
              onClick={() => setState((s) => ({ ...s, mode: m.id }))}
              className={`rounded-md px-4 py-1.5 text-sm font-medium transition ${
                state.mode === m.id ? 'bg-sky-500 text-white' : 'text-slate-300 hover:text-white'
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>

      {state.mode === 'leaf' && (
        <LeafFields
          title="Distribution"
          value={state.leaf}
          onChange={(leaf) => setState((s) => ({ ...s, leaf }))}
        />
      )}

      {state.mode === 'transform' && (
        <div className="space-y-5">
          <OpFields value={state.op} onChange={(op) => setState((s) => ({ ...s, op }))} />
          <LeafFields title="Base X" value={state.base} onChange={(base) => setState((s) => ({ ...s, base }))} />
        </div>
      )}

      {state.mode === 'mixture' && (
        <div className="space-y-5">
          <div>
            <Heading>Weight of component A</Heading>
            <div className="flex items-center gap-3">
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={state.weight}
                onChange={(e) => setState((s) => ({ ...s, weight: Number(e.target.value) }))}
                className="w-full accent-sky-500"
              />
              <span className="w-24 tabular-nums text-sm text-slate-300">
                {state.weight.toFixed(2)} / {(1 - state.weight).toFixed(2)}
              </span>
            </div>
          </div>
          <LeafFields title="Component A" value={state.componentA} onChange={(componentA) => setState((s) => ({ ...s, componentA }))} />
          <LeafFields title="Component B" value={state.componentB} onChange={(componentB) => setState((s) => ({ ...s, componentB }))} />
        </div>
      )}
    </div>
  )
}

function LeafFields({ title, value, onChange }: { title: string; value: LeafForm; onChange: (v: LeafForm) => void }) {
  const spec = distSpec(value.dist)
  return (
    <fieldset className="rounded-lg bg-slate-900/60 p-4 ring-1 ring-slate-800">
      <Heading>{title}</Heading>
      <select
        value={value.dist}
        onChange={(e) => {
          const next = distSpec(e.target.value)
          onChange({ dist: next.name, params: defaultParams(next) })
        }}
        className="mb-3 w-full rounded-md bg-slate-800 px-3 py-2 text-sm text-slate-100 ring-1 ring-slate-700"
      >
        {DISTRIBUTIONS.map((d) => (
          <option key={d.name} value={d.name}>
            {d.label}
          </option>
        ))}
      </select>
      <div className="grid grid-cols-2 gap-3">
        {spec.params.map((ps) => (
          <NumberField
            key={ps.key}
            label={ps.label}
            value={value.params[ps.key] ?? ps.default}
            step={ps.step}
            onChange={(n) => onChange({ ...value, params: { ...value.params, [ps.key]: n } })}
          />
        ))}
      </div>
    </fieldset>
  )
}

function OpFields({ value, onChange }: { value: OpForm; onChange: (v: OpForm) => void }) {
  const spec = opSpec(value.name)
  return (
    <fieldset className="rounded-lg bg-slate-900/60 p-4 ring-1 ring-slate-800">
      <Heading>Operation Y = op(X)</Heading>
      <select
        value={value.name}
        onChange={(e) => {
          const next = opSpec(e.target.value)
          onChange({ name: next.name, params: defaultParams(next) })
        }}
        className="mb-3 w-full rounded-md bg-slate-800 px-3 py-2 text-sm text-slate-100 ring-1 ring-slate-700"
      >
        {OPS.map((o) => (
          <option key={o.name} value={o.name}>
            {o.label}
          </option>
        ))}
      </select>
      {spec.params.length > 0 && (
        <div className="grid grid-cols-2 gap-3">
          {spec.params.map((ps) => (
            <NumberField
              key={ps.key}
              label={ps.label}
              value={value.params[ps.key] ?? ps.default}
              step={ps.step}
              onChange={(n) => onChange({ ...value, params: { ...value.params, [ps.key]: n } })}
            />
          ))}
        </div>
      )}
    </fieldset>
  )
}

function NumberField({ label, value, step, onChange }: { label: string; value: number; step?: number; onChange: (n: number) => void }) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block text-slate-400">{label}</span>
      <input
        type="number"
        value={value}
        step={step ?? 0.1}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full rounded-md bg-slate-800 px-3 py-2 tabular-nums text-slate-100 ring-1 ring-slate-700 focus:ring-sky-500 focus:outline-none"
      />
    </label>
  )
}

function Heading({ children }: { children: React.ReactNode }) {
  return <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">{children}</h3>
}
