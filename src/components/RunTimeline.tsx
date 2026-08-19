// The post-run timeline: one SVG drawn from the tick-by-tick history of the
// run that just finished. Phase bands give the "when", the series give the
// "what" — served % cratering at the spike, the ASG stair-stepping cost as it
// scales, a queue backlog piling up and draining.

import { useGameStore, type RunPhaseName, type TickPoint } from '../store'

const PHASES: Record<RunPhaseName, { label: string; band: string }> = {
  baseline: { label: 'baseline', band: 'rgba(56, 189, 248, 0.05)' },
  spike: { label: '🔥 spike', band: 'rgba(249, 115, 22, 0.12)' },
  outage: { label: '💥 outage', band: 'rgba(217, 70, 239, 0.12)' },
  recovery: { label: 'recovery', band: 'rgba(16, 185, 129, 0.06)' },
  probe: { label: '🕵️', band: 'rgba(245, 158, 11, 0.10)' },
}

const W = 372
const H = 112
const TOP = 16 // room for phase labels
const BOTTOM = H - 6
const PLOT_H = BOTTOM - TOP

const x = (i: number, n: number) => (n > 1 ? (i / (n - 1)) * W : 0)
/** Map a 0..1 value into plot y (1 at the top of the plot). */
const y = (v: number) => BOTTOM - Math.max(0, Math.min(1, v)) * PLOT_H

const polyline = (history: TickPoint[], value: (p: TickPoint) => number) =>
  history.map((p, i) => `${x(i, history.length).toFixed(1)},${y(value(p)).toFixed(1)}`).join(' ')

/** A polyline closed down to the plot floor, for filled areas. */
const area = (history: TickPoint[], value: (p: TickPoint) => number) =>
  `M0,${BOTTOM} L` + polyline(history, value).replace(/ /g, ' L') + ` L${W},${BOTTOM} Z`

function Legend({ swatch, children }: { swatch: string; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 text-[9px] text-slate-400">
      <span className={`h-1.5 w-3 rounded-sm ${swatch}`} />
      {children}
    </span>
  )
}

export function RunTimeline() {
  const history = useGameStore((s) => s.runHistory)
  if (history.length < 2) return null

  const n = history.length
  const maxRps = Math.max(...history.map((p) => p.rps), 1)
  const maxBacklog = Math.max(...history.map((p) => p.backlog))
  const maxCost = Math.max(...history.map((p) => p.cost), 1)
  const served = (p: TickPoint) => (p.total > 0 ? p.served / p.total : 1)

  // Consecutive same-phase runs become background bands.
  const bands: { phase: RunPhaseName; from: number; to: number }[] = []
  for (let i = 0; i < n; i++) {
    const last = bands[bands.length - 1]
    if (last && last.phase === history[i].phase) last.to = i
    else bands.push({ phase: history[i].phase, from: i, to: i })
  }

  return (
    <div className="mt-4">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full rounded-lg border border-slate-800 bg-slate-950/60">
        {bands.map((b, bi) => {
          const x0 = x(b.from, n)
          const x1 = bi === bands.length - 1 ? W : x(b.to + 1, n)
          const wide = x1 - x0 > 34
          return (
            <g key={bi}>
              <rect x={x0} y={0} width={x1 - x0} height={H} fill={PHASES[b.phase].band} />
              {bi > 0 && <line x1={x0} y1={TOP - 4} x2={x0} y2={BOTTOM} stroke="#334155" strokeDasharray="2 3" strokeWidth="1" />}
              {wide && (
                <text x={(x0 + x1) / 2} y={10} textAnchor="middle" fontSize="7.5" fill="#94a3b8">
                  {PHASES[b.phase].label}
                </text>
              )}
            </g>
          )
        })}

        {/* incoming traffic (area, normalized to its own peak) */}
        <path d={area(history, (p) => p.rps / maxRps)} fill="rgba(56, 189, 248, 0.12)" />
        <polyline points={polyline(history, (p) => p.rps / maxRps)} fill="none" stroke="#38bdf8" strokeWidth="1" opacity="0.6" />

        {/* queue backlog (only when something ever queued) */}
        {maxBacklog > 0 && (
          <path d={area(history, (p) => p.backlog / maxBacklog)} fill="rgba(245, 158, 11, 0.18)" />
        )}

        {/* monthly cost (stair-steps as ASGs scale) */}
        <polyline
          points={polyline(history, (p) => p.cost / maxCost)}
          fill="none"
          stroke="#a78bfa"
          strokeWidth="1.2"
          strokeDasharray="4 2"
          opacity="0.8"
        />

        {/* served % — the headline series, drawn last so it sits on top */}
        <polyline points={polyline(history, served)} fill="none" stroke="#34d399" strokeWidth="1.8" />
      </svg>
      <div className="mt-1.5 flex flex-wrap items-center justify-center gap-x-3 gap-y-0.5">
        <Legend swatch="bg-emerald-400">served %</Legend>
        <Legend swatch="bg-sky-400/50">traffic ({maxRps.toLocaleString()} rps peak)</Legend>
        {maxBacklog > 0 && (
          <Legend swatch="bg-amber-400/60">backlog ({Math.round(maxBacklog).toLocaleString()} peak)</Legend>
        )}
        <Legend swatch="bg-violet-400">cost (${Math.round(maxCost)}/mo peak)</Legend>
      </div>
    </div>
  )
}
