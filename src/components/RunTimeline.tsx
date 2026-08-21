// The inline run timeline in the results modal: a compact sparkline of the run
// just finished, with a scrubbing crosshair. Click it for the full chart with
// axes, a legend, and callouts (RunTimelineExpanded).

import { useState } from 'react'
import { useGameStore } from '../store'
import { RunTimelineExpanded } from './RunTimelineExpanded'
import {
  PHASE_META,
  phaseLabel,
  areaPath,
  bandsOf,
  buildScales,
  formatSeconds,
  linePath,
  makeGeom,
  secondsAt,
  seriesFor,
} from './runChartMath'

const W = 372
const H = 112
const PLOT = { x: 0, y: 16, w: W, h: H - 22 }

export function RunTimeline() {
  const history = useGameStore((s) => s.runHistory)
  const multiRegion = useGameStore((s) => s.scenario().multiRegion === true)
  const scenario = useGameStore((s) => s.scenario())
  const [hover, setHover] = useState<number | null>(null)
  const [expanded, setExpanded] = useState(false)

  if (history.length < 2) return null

  const n = history.length
  const defs = seriesFor(history)
  const scales = buildScales(history, defs, scenario.budget)
  const g = makeGeom(n, PLOT)
  const bands = bandsOf(history)
  const floor = PLOT.y + PLOT.h

  const onPointer = (e: React.PointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    setHover(g.indexAt(((e.clientX - rect.left) / rect.width) * W))
  }

  // Clamp against the current run: scenarios have different tick counts, so a
  // hover index held from a previous run must never index past this history.
  const at = hover === null ? null : Math.min(hover, n - 1)
  const point = at === null ? null : history[at]
  const flip = at !== null && g.x(at) / W > 0.6

  return (
    <>
      <div className="group relative mt-4">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="w-full cursor-pointer touch-none select-none rounded-lg border border-slate-800 bg-slate-950/60 transition group-hover:border-slate-700"
          onPointerMove={onPointer}
          onPointerDown={onPointer}
          onPointerLeave={() => setHover(null)}
          onClick={() => setExpanded(true)}
        >
          {bands.map((b, bi) => {
            const x0 = g.x(b.from)
            const x1 = bi === bands.length - 1 ? W : g.x(b.to + 1)
            return (
              <g key={bi}>
                <rect x={x0} y={0} width={Math.max(0, x1 - x0)} height={H} fill={PHASE_META[b.phase].band} />
                {bi > 0 && (
                  <line x1={x0} y1={PLOT.y - 4} x2={x0} y2={floor} stroke="#334155" strokeDasharray="2 3" strokeWidth="1" />
                )}
                {x1 - x0 > 34 && (
                  <text x={(x0 + x1) / 2} y={10} textAnchor="middle" fontSize="7.5" fill="#94a3b8">
                    {phaseLabel(b.phase, multiRegion)}
                  </text>
                )}
              </g>
            )
          })}

          {/* Incidents answered mid-run */}
          {history.map((pt, i) =>
            pt.decision ? (
              <line
                key={`d${i}`}
                x1={g.x(i)}
                y1={PLOT.y - 4}
                x2={g.x(i)}
                y2={floor}
                stroke="#fbbf24"
                strokeWidth="1"
                strokeDasharray="1 2"
                opacity="0.8"
              />
            ) : null,
          )}

          {defs.map((d) => (
            <g key={d.key}>
              {d.area && (
                <path d={areaPath(history, d, scales, g, floor)} fill={d.color} opacity={d.key === 'rps' ? 0.12 : 0.18} />
              )}
              <path
                d={linePath(history, d, scales, g)}
                fill="none"
                stroke={d.color}
                strokeWidth={d.key === 'served' ? 1.8 : 1.1}
                strokeDasharray={d.dashed ? '4 2' : undefined}
                opacity={d.key === 'served' ? 1 : 0.7}
              />
            </g>
          ))}

          {at !== null && point && (
            <g>
              <line x1={g.x(at)} y1={PLOT.y - 4} x2={g.x(at)} y2={floor} stroke="#e2e8f0" strokeWidth="1" opacity="0.4" />
              {defs.map((d) => (
                <circle
                  key={d.key}
                  cx={g.x(at)}
                  cy={g.y(scales.frac(d, d.value(point)))}
                  r="2.2"
                  fill={d.color}
                  stroke="#020617"
                  strokeWidth="0.8"
                />
              ))}
            </g>
          )}
        </svg>

        <span className="pointer-events-none absolute right-1.5 top-1.5 rounded bg-slate-900/80 px-1.5 py-0.5 text-[8.5px] text-slate-400 opacity-0 transition group-hover:opacity-100">
          ⤢ expand
        </span>

        {point && at !== null && (
          <div
            className="pointer-events-none absolute top-1 z-10 w-[128px] rounded-md border border-slate-700 bg-slate-950/95 p-1.5 shadow-xl"
            style={{ left: `${(g.x(at) / W) * 100}%`, transform: flip ? 'translateX(-106%)' : 'translateX(6%)' }}
          >
            <div className="mb-0.5 flex items-baseline justify-between border-b border-slate-800 pb-0.5">
              <span className="text-[9px] font-semibold text-slate-300">{phaseLabel(point.phase, multiRegion)}</span>
              <span className="text-[9px] tabular-nums text-slate-500">{formatSeconds(secondsAt(at))}</span>
            </div>
            {defs.map((d) => (
              <div key={d.key} className="flex items-center justify-between gap-1.5 text-[9px]">
                <span className="flex items-center gap-1 text-slate-400">
                  <span className={`h-1 w-1.5 rounded-sm ${d.swatch}`} />
                  {d.label}
                </span>
                <span className="tabular-nums font-semibold text-slate-200">{d.format(d.value(point))}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="mt-1.5 flex flex-wrap items-center justify-center gap-x-3 gap-y-0.5">
        {defs.map((d) => (
          <span key={d.key} className="inline-flex items-center gap-1 text-[9px] text-slate-400">
            <span className={`h-1.5 w-3 rounded-sm ${d.swatch}`} />
            {d.label}
          </span>
        ))}
        <button
          onClick={() => setExpanded(true)}
          className="text-[9px] text-cyan-400 transition hover:text-cyan-300"
        >
          ⤢ bigger
        </button>
      </div>

      {expanded && <RunTimelineExpanded onClose={() => setExpanded(false)} />}
    </>
  )
}
