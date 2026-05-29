// Density histogram with an analytic-density overlay, drawn as a single inline SVG (no chart
// dependency — keeps the bundle tiny). Pure/presentational: all data is computed by the caller.

// Utils
import { fmt } from '@/lib/format'
// Types
import type { Bin, CurvePoint, Range } from '@/lib/histogram'

interface HistogramProps {
  bins: Bin[]
  curve: CurvePoint[]
  range: Range
  curveLabel?: string
}

const W = 720
const H = 320
const PAD = { top: 16, right: 16, bottom: 36, left: 48 }

export function Histogram({ bins, curve, range, curveLabel = 'analytic density' }: HistogramProps) {
  const plotW = W - PAD.left - PAD.right
  const plotH = H - PAD.top - PAD.bottom

  const yMax = Math.max(
    1e-9,
    ...bins.map((b) => b.density),
    ...curve.map((p) => p.y),
  )

  const sx = (x: number) => PAD.left + ((x - range.min) / (range.max - range.min)) * plotW
  const sy = (y: number) => PAD.top + plotH - (y / yMax) * plotH

  const linePath = curve
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${sx(p.x).toFixed(1)},${sy(p.y).toFixed(1)}`)
    .join(' ')

  const xTicks = ticks(range.min, range.max, 6)
  const yTicks = ticks(0, yMax, 4)

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label="Sample histogram with density overlay">
      {/* y grid + labels */}
      {yTicks.map((t) => (
        <g key={`y${t}`}>
          <line x1={PAD.left} y1={sy(t)} x2={W - PAD.right} y2={sy(t)} stroke="currentColor" strokeOpacity={0.08} />
          <text x={PAD.left - 8} y={sy(t) + 4} textAnchor="end" className="fill-slate-400" fontSize={11}>
            {fmt(t, 2)}
          </text>
        </g>
      ))}
      {/* x labels */}
      {xTicks.map((t) => (
        <text key={`x${t}`} x={sx(t)} y={H - 12} textAnchor="middle" className="fill-slate-400" fontSize={11}>
          {fmt(t, 3)}
        </text>
      ))}
      {/* bars */}
      {bins.map((b, i) => {
        const x = sx(b.x0)
        const w = Math.max(0.5, sx(b.x1) - sx(b.x0) - 1)
        const y = sy(b.density)
        return <rect key={i} x={x} y={y} width={w} height={Math.max(0, PAD.top + plotH - y)} className="fill-sky-500/35" />
      })}
      {/* analytic density overlay */}
      {curve.length > 1 && <path d={linePath} fill="none" className="stroke-amber-400" strokeWidth={2} />}
      {curve.length > 1 && (
        <g>
          <line x1={W - PAD.right - 150} y1={PAD.top + 6} x2={W - PAD.right - 130} y2={PAD.top + 6} className="stroke-amber-400" strokeWidth={2} />
          <text x={W - PAD.right - 124} y={PAD.top + 10} className="fill-slate-300" fontSize={11}>
            {curveLabel}
          </text>
        </g>
      )}
    </svg>
  )
}

function ticks(min: number, max: number, count: number): number[] {
  const step = (max - min) / count
  return Array.from({ length: count + 1 }, (_, i) => min + i * step)
}
