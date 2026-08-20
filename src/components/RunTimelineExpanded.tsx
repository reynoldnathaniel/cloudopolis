// The expanded run timeline: a CloudWatch-style metrics chart over the ticks of
// the run just finished. Dual axis (served % left, traffic right), gridlines, a
// time axis in seconds, a scrubbing crosshair with a value tooltip, and a
// clickable legend to isolate series.
//
// Rendered through a portal to document.body: the results modal is animated
// with a transform, which would otherwise become the containing block for a
// fixed-position child.

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { useGameStore } from '../store'
import {
  PHASE_META,
  phaseLabel,
  areaPath,
  bandsOf,
  buildScales,
  compact,
  formatSeconds,
  linePath,
  makeGeom,
  secondsAt,
  seriesFor,
  servedPct,
  type SeriesKey,
} from './runChartMath'

const W = 780
const H = 430
const PAD = { left: 48, right: 62, top: 30, bottom: 40 }
const PLOT = {
  x: PAD.left,
  y: PAD.top,
  w: W - PAD.left - PAD.right,
  h: H - PAD.top - PAD.bottom,
}
const GRID = [0, 0.25, 0.5, 0.75, 1]

export function RunTimelineExpanded({ onClose }: { onClose: () => void }) {
  const history = useGameStore((s) => s.runHistory)
  const scenario = useGameStore((s) => s.scenario())
  const multiRegion = scenario.multiRegion === true
  const [hover, setHover] = useState<number | null>(null)
  const [hidden, setHidden] = useState<Set<SeriesKey>>(new Set())

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  if (history.length < 2) return null

  const n = history.length
  const defs = seriesFor(history)
  const scales = buildScales(history, defs, scenario.budget)
  const g = makeGeom(n, PLOT)
  const bands = bandsOf(history)
  const floor = PLOT.y + PLOT.h

  const toggle = (key: SeriesKey) =>
    setHidden((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })

  const onPointer = (e: React.PointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    setHover(g.indexAt(((e.clientX - rect.left) / rect.width) * W))
  }

  // Worst served % and peak cost, called out so the story reads without hovering.
  let worstIdx = 0
  history.forEach((p, i) => {
    if (servedPct(p) < servedPct(history[worstIdx])) worstIdx = i
  })
  const worst = servedPct(history[worstIdx])
  const showWorst = worst < 99 && !hidden.has('served')

  // Clamp against the current run — a hover index from a previous, longer run
  // must never index past this history.
  const at = hover === null ? null : Math.min(hover, n - 1)
  const point = at === null ? null : history[at]
  const tooltipLeft = at === null ? 0 : (g.x(at) / W) * 100
  const flip = tooltipLeft > 62

  return createPortal(
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/85 p-4 backdrop-blur-sm"
      >
        <motion.div
          initial={{ scale: 0.95, y: 12 }}
          animate={{ scale: 1, y: 0 }}
          exit={{ scale: 0.97, opacity: 0 }}
          transition={{ type: 'spring', stiffness: 300, damping: 26 }}
          onClick={(e) => e.stopPropagation()}
          className="w-full max-w-3xl rounded-2xl border border-slate-700 bg-slate-900 p-5 shadow-2xl"
        >
          <div className="mb-3 flex items-start justify-between">
            <div>
              <h3 className="text-[15px] font-bold text-slate-100">
                {scenario.emoji} Run timeline — {scenario.title}
              </h3>
              <p className="text-[11px] text-slate-500">
                Hover to scrub · click a series in the legend to isolate it · Esc to close
              </p>
            </div>
            <button
              onClick={onClose}
              className="rounded-lg border border-slate-700 px-2.5 py-1 text-[12px] text-slate-400 transition hover:border-slate-500 hover:text-slate-200"
            >
              ✕
            </button>
          </div>

          <div className="relative">
            <svg
              viewBox={`0 0 ${W} ${H}`}
              className="w-full touch-none select-none"
              onPointerMove={onPointer}
              onPointerDown={onPointer}
              onPointerLeave={() => setHover(null)}
            >
              {/* phase bands */}
              {bands.map((b, bi) => {
                const x0 = bi === 0 ? PLOT.x : g.x(b.from)
                const x1 = bi === bands.length - 1 ? PLOT.x + PLOT.w : g.x(b.to + 1)
                return (
                  <g key={bi}>
                    <rect x={x0} y={PLOT.y} width={Math.max(0, x1 - x0)} height={PLOT.h} fill={PHASE_META[b.phase].band} />
                    {bi > 0 && (
                      <line x1={x0} y1={PLOT.y} x2={x0} y2={floor} stroke="#475569" strokeDasharray="3 3" strokeWidth="1" />
                    )}
                    {x1 - x0 > 52 && (
                      <text x={(x0 + x1) / 2} y={PAD.top - 12} textAnchor="middle" fontSize="11" fill="#94a3b8">
                        {phaseLabel(b.phase, multiRegion)}
                      </text>
                    )}
                  </g>
                )
              })}

              {/* gridlines + dual axis labels */}
              {GRID.map((f) => (
                <g key={f}>
                  <line x1={PLOT.x} y1={g.y(f)} x2={PLOT.x + PLOT.w} y2={g.y(f)} stroke="#1e293b" strokeWidth="1" />
                  <text x={PLOT.x - 8} y={g.y(f) + 3.5} textAnchor="end" fontSize="10" fill="#64748b">
                    {Math.round(f * 100)}%
                  </text>
                  <text x={PLOT.x + PLOT.w + 8} y={g.y(f) + 3.5} fontSize="10" fill="#0ea5e9" opacity="0.75">
                    {compact(f * scales.maxRps)}
                  </text>
                </g>
              ))}
              <text x={PLOT.x - 8} y={PAD.top - 12} textAnchor="end" fontSize="9.5" fill="#34d399">
                served
              </text>
              <text x={PLOT.x + PLOT.w + 8} y={PAD.top - 12} fontSize="9.5" fill="#38bdf8">
                rps
              </text>

              {/* budget reference — the cost line crossing this is the story */}
              {!hidden.has('cost') && scales.budgetFrac <= 1 && (
                <g>
                  <line
                    x1={PLOT.x}
                    y1={g.y(scales.budgetFrac)}
                    x2={PLOT.x + PLOT.w}
                    y2={g.y(scales.budgetFrac)}
                    stroke="#94a3b8"
                    strokeWidth="1"
                    strokeDasharray="2 4"
                    opacity="0.45"
                  />
                  <text x={PLOT.x + 4} y={g.y(scales.budgetFrac) - 4} fontSize="9" fill="#94a3b8" opacity="0.75">
                    budget ${scenario.budget}
                  </text>
                </g>
              )}

              {/* time axis */}
              {Array.from({ length: 7 }, (_, k) => Math.round(((n - 1) * k) / 6)).map((i, k) => (
                <text key={k} x={g.x(i)} y={floor + 16} textAnchor="middle" fontSize="10" fill="#64748b">
                  {formatSeconds(secondsAt(i))}
                </text>
              ))}

              {/* series */}
              {defs
                .filter((d) => !hidden.has(d.key))
                .map((d) => (
                  <g key={d.key}>
                    {d.area && (
                      <path d={areaPath(history, d, scales, g, floor)} fill={d.color} opacity={d.key === 'rps' ? 0.1 : 0.16} />
                    )}
                    <path
                      d={linePath(history, d, scales, g)}
                      fill="none"
                      stroke={d.color}
                      strokeWidth={d.key === 'served' ? 2.2 : 1.5}
                      strokeDasharray={d.dashed ? '5 3' : undefined}
                      opacity={d.key === 'served' ? 1 : 0.85}
                    />
                  </g>
                ))}

              {/* worst-served callout */}
              {showWorst && (
                <g>
                  <circle cx={g.x(worstIdx)} cy={g.y(worst / 100)} r="3.5" fill="#f87171" />
                  <text
                    // Keep the label clear of the axis labels and the plot edges:
                    // flip above the dot when it sits low, and clamp horizontally.
                    x={Math.max(PLOT.x + 28, Math.min(PLOT.x + PLOT.w - 28, g.x(worstIdx)))}
                    y={worst < 20 ? g.y(worst / 100) - 9 : g.y(worst / 100) + 16}
                    textAnchor="middle"
                    fontSize="9.5"
                    fill="#f87171"
                  >
                    worst {Math.round(worst)}%
                  </text>
                </g>
              )}

              {/* crosshair */}
              {at !== null && point && (
                <g>
                  <line x1={g.x(at)} y1={PLOT.y} x2={g.x(at)} y2={floor} stroke="#e2e8f0" strokeWidth="1" opacity="0.45" />
                  {defs
                    .filter((d) => !hidden.has(d.key))
                    .map((d) => (
                      <circle
                        key={d.key}
                        cx={g.x(at)}
                        cy={g.y(scales.frac(d, d.value(point)))}
                        r="3"
                        fill={d.color}
                        stroke="#0f172a"
                        strokeWidth="1"
                      />
                    ))}
                </g>
              )}
            </svg>

            {/* value tooltip */}
            {point && at !== null && (
              <div
                className="pointer-events-none absolute top-2 z-10 w-[152px] rounded-lg border border-slate-700 bg-slate-950/95 p-2 shadow-xl"
                style={{ left: `${tooltipLeft}%`, transform: flip ? 'translateX(-108%)' : 'translateX(8%)' }}
              >
                <div className="mb-1 flex items-baseline justify-between border-b border-slate-800 pb-1">
                  <span className="text-[10px] font-semibold text-slate-300">{phaseLabel(point.phase, multiRegion)}</span>
                  <span className="text-[10px] tabular-nums text-slate-500">{formatSeconds(secondsAt(at))}</span>
                </div>
                {defs
                  .filter((d) => !hidden.has(d.key))
                  .map((d) => (
                    <div key={d.key} className="flex items-center justify-between gap-2 text-[10px]">
                      <span className="flex items-center gap-1 text-slate-400">
                        <span className={`h-1.5 w-2 rounded-sm ${d.swatch}`} />
                        {d.label}
                      </span>
                      <span className="tabular-nums font-semibold text-slate-200">{d.format(d.value(point))}</span>
                    </div>
                  ))}
              </div>
            )}
          </div>

          {/* legend / series toggles */}
          <div className="mt-3 flex flex-wrap items-center justify-center gap-1.5">
            {defs.map((d) => {
              const off = hidden.has(d.key)
              return (
                <button
                  key={d.key}
                  onClick={() => toggle(d.key)}
                  className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[10px] transition ${
                    off
                      ? 'border-slate-800 bg-slate-900/60 text-slate-600'
                      : 'border-slate-700 bg-slate-800/60 text-slate-300 hover:border-slate-500'
                  }`}
                >
                  <span className={`h-1.5 w-3 rounded-sm ${d.swatch} ${off ? 'opacity-30' : ''}`} />
                  {d.label}
                  <span className="text-slate-500">
                    peak {d.format(scales.peaks[d.key])}
                  </span>
                </button>
              )
            })}
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>,
    document.body,
  )
}
