// Geometry and scaling shared by the inline run timeline and its expanded view,
// so the sparkline in the results modal and the full chart always agree.
//
// Dual axis: served % reads off the LEFT axis (0–100), traffic off the RIGHT
// axis (0–niceMax rps). Backlog and cost have units that fit neither, so they
// are drawn against their own reference — cost against max(peak, budget), which
// makes the budget line a meaningful gridline you can watch the cost cross.

import { TICK_MS, type RunPhaseName, type TickPoint } from '../store'

export const PHASE_META: Record<RunPhaseName, { label: string; band: string }> = {
  baseline: { label: 'baseline', band: 'rgba(56, 189, 248, 0.05)' },
  spike: { label: '🔥 spike', band: 'rgba(249, 115, 22, 0.12)' },
  outage: { label: '💥 outage', band: 'rgba(217, 70, 239, 0.12)' },
  recovery: { label: 'recovery', band: 'rgba(16, 185, 129, 0.06)' },
  probe: { label: '🕵️ probe', band: 'rgba(245, 158, 11, 0.10)' },
}

export type SeriesKey = 'served' | 'rps' | 'backlog' | 'cost'

export interface SeriesDef {
  key: SeriesKey
  label: string
  color: string
  /** Tailwind class for the legend swatch */
  swatch: string
  /** 'pct' → left axis, 'rps' → right axis, 'cost'/'backlog' → own reference */
  scale: 'pct' | 'rps' | 'cost' | 'backlog'
  value: (p: TickPoint) => number
  format: (v: number) => string
  /** Draw a filled area under the line */
  area?: boolean
  dashed?: boolean
}

export const servedPct = (p: TickPoint): number => (p.total > 0 ? (p.served / p.total) * 100 : 100)

export const compact = (v: number): string =>
  v >= 1000 ? `${(v / 1000).toFixed(v >= 10000 ? 0 : 1).replace(/\.0$/, '')}k` : String(Math.round(v))

/** Which series this run actually has (backlog only when something queued). */
export function seriesFor(history: TickPoint[]): SeriesDef[] {
  const defs: SeriesDef[] = [
    {
      key: 'served',
      label: 'served %',
      color: '#34d399',
      swatch: 'bg-emerald-400',
      scale: 'pct',
      value: servedPct,
      format: (v) => `${Math.round(v)}%`,
    },
    {
      key: 'rps',
      label: 'traffic',
      color: '#38bdf8',
      swatch: 'bg-sky-400',
      scale: 'rps',
      value: (p) => p.rps,
      format: (v) => `${Math.round(v).toLocaleString()} rps`,
      area: true,
    },
  ]
  if (history.some((p) => p.backlog > 0)) {
    defs.push({
      key: 'backlog',
      label: 'backlog',
      color: '#fbbf24',
      swatch: 'bg-amber-400',
      scale: 'backlog',
      value: (p) => p.backlog,
      format: (v) => `${Math.round(v).toLocaleString()} queued`,
      area: true,
    })
  }
  defs.push({
    key: 'cost',
    label: 'cost',
    color: '#a78bfa',
    swatch: 'bg-violet-400',
    scale: 'cost',
    value: (p) => p.cost,
    format: (v) => `$${Math.round(v)}/mo`,
    dashed: true,
  })
  return defs
}

/** Round up to a friendly axis maximum: 1, 2, 5 × 10ⁿ. */
export function niceMax(v: number): number {
  if (v <= 0) return 1
  const base = Math.pow(10, Math.floor(Math.log10(v)))
  const n = v / base
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * base
}

export interface Scales {
  /** Right-axis maximum, in rps */
  maxRps: number
  /** Cost reference maximum — at least the budget, so the budget line is on-chart */
  maxCost: number
  maxBacklog: number
  peaks: Record<SeriesKey, number>
  /** Where the budget sits as a 0..1 fraction of plot height */
  budgetFrac: number
  /** A series value as a 0..1 fraction of plot height */
  frac: (s: SeriesDef, v: number) => number
}

export function buildScales(history: TickPoint[], defs: SeriesDef[], budget: number): Scales {
  const peaks = { served: 0, rps: 0, backlog: 0, cost: 0 } as Record<SeriesKey, number>
  for (const d of defs) {
    peaks[d.key] = history.reduce((m, p) => Math.max(m, d.value(p)), 0)
  }
  const maxRps = niceMax(peaks.rps)
  const maxCost = niceMax(Math.max(peaks.cost, budget))
  const maxBacklog = Math.max(peaks.backlog, 1)

  const frac = (s: SeriesDef, v: number): number => {
    switch (s.scale) {
      case 'pct':
        return v / 100
      case 'rps':
        return maxRps > 0 ? v / maxRps : 0
      case 'cost':
        return maxCost > 0 ? v / maxCost : 0
      case 'backlog':
        return v / maxBacklog
    }
  }

  return { maxRps, maxCost, maxBacklog, peaks, budgetFrac: maxCost > 0 ? budget / maxCost : 0, frac }
}

export interface Band {
  phase: RunPhaseName
  from: number
  to: number
}

/** Collapse consecutive same-phase ticks into background bands. */
export function bandsOf(history: TickPoint[]): Band[] {
  const bands: Band[] = []
  for (let i = 0; i < history.length; i++) {
    const last = bands[bands.length - 1]
    if (last && last.phase === history[i].phase) last.to = i
    else bands.push({ phase: history[i].phase, from: i, to: i })
  }
  return bands
}

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export interface Geom {
  /** Tick index → svg x */
  x: (i: number) => number
  /** 0..1 fraction → svg y */
  y: (f: number) => number
  /** svg x → nearest tick index */
  indexAt: (px: number) => number
}

export function makeGeom(n: number, rect: Rect): Geom {
  return {
    x: (i) => rect.x + (n > 1 ? (i / (n - 1)) * rect.w : rect.w / 2),
    y: (f) => rect.y + rect.h - Math.max(0, Math.min(1, f)) * rect.h,
    indexAt: (px) => {
      if (n <= 1) return 0
      const i = Math.round(((px - rect.x) / rect.w) * (n - 1))
      return Math.max(0, Math.min(n - 1, i))
    },
  }
}

export function linePath(history: TickPoint[], def: SeriesDef, scales: Scales, g: Geom): string {
  return history
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${g.x(i).toFixed(1)},${g.y(scales.frac(def, def.value(p))).toFixed(1)}`)
    .join(' ')
}

export function areaPath(
  history: TickPoint[],
  def: SeriesDef,
  scales: Scales,
  g: Geom,
  floor: number,
): string {
  return `${linePath(history, def, scales, g)} L${g.x(history.length - 1).toFixed(1)},${floor} L${g.x(0).toFixed(1)},${floor} Z`
}

/** Elapsed run time at a tick, in seconds. */
export const secondsAt = (i: number): number => (i * TICK_MS) / 1000

export const formatSeconds = (s: number): string => `${s.toFixed(1)}s`
