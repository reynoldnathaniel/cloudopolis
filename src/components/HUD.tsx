import { AnimatePresence, motion } from 'framer-motion'
import { useGameStore } from '../store'

const PHASE_STYLE: Record<string, { label: string; cls: string }> = {
  baseline: { label: 'BASELINE', cls: 'bg-sky-500/20 text-sky-300 border-sky-500/40' },
  spike: { label: 'SPIKE', cls: 'bg-red-500/20 text-red-300 border-red-500/50 animate-pulse' },
  recovery: { label: 'RECOVERY', cls: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40' },
  outage: { label: 'AZ OUTAGE', cls: 'bg-fuchsia-500/20 text-fuchsia-300 border-fuchsia-500/60 animate-pulse' },
  probe: { label: 'SECURITY PROBE', cls: 'bg-amber-500/20 text-amber-300 border-amber-500/50 animate-pulse' },
}

export function HUD() {
  const phase = useGameStore((s) => s.phase)
  const runPhase = useGameStore((s) => s.runPhase)
  const rps = useGameStore((s) => s.currentRps)
  const success = useGameStore((s) => s.liveSuccess)
  const cost = useGameStore((s) => s.monthlyCost)
  const scenario = useGameStore((s) => s.scenario())
  const queued = useGameStore((s) =>
    Math.round(Object.values(s.nodeStats).reduce((sum, n) => sum + (n.backlog ?? 0), 0)),
  )

  const running = phase === 'run'
  const style = PHASE_STYLE[runPhase]
  const successPct = Math.round(success * 100)
  const successColor = successPct >= 98 ? 'text-emerald-400' : successPct >= 90 ? 'text-amber-400' : 'text-red-400'
  const overBudget = cost > scenario.budget

  return (
    <AnimatePresence>
      {running && (
        <motion.div
          initial={{ y: -70, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: -70, opacity: 0 }}
          className="pointer-events-none absolute left-1/2 top-4 z-40 -translate-x-1/2"
        >
          <div className="flex items-center gap-5 rounded-2xl border border-slate-700 bg-slate-900/90 px-5 py-2.5 shadow-2xl backdrop-blur">
            <span className={`rounded-md border px-2 py-0.5 text-[10px] font-bold tracking-widest ${style.cls}`}>
              {style.label}
            </span>
            {runPhase === 'spike' && (
              <span className="text-[11px] font-semibold text-red-300">{scenario.spikeLabel}</span>
            )}
            {runPhase === 'outage' && (
              <span className="text-[11px] font-semibold text-fuchsia-300">
                {scenario.outageLabel ?? 'An Availability Zone failed!'}
              </span>
            )}
            {runPhase === 'probe' && (
              <span className="text-[11px] font-semibold text-amber-300">
                🕵️ Attackers are scanning for exposed resources…
              </span>
            )}
            <div className="text-center">
              <div className="text-sm font-bold tabular-nums text-slate-100">{rps.toLocaleString()}</div>
              <div className="text-[8px] uppercase tracking-wider text-slate-500">req/s</div>
            </div>
            <div className="text-center">
              <div className={`text-sm font-bold tabular-nums ${successColor}`}>{successPct}%</div>
              <div className="text-[8px] uppercase tracking-wider text-slate-500">served</div>
            </div>
            <div className="text-center">
              <div className={`text-sm font-bold tabular-nums ${overBudget ? 'text-red-400' : 'text-emerald-400'}`}>
                ${cost}
              </div>
              <div className="text-[8px] uppercase tracking-wider text-slate-500">/mo (cap ${scenario.budget})</div>
            </div>
            {queued > 0 && (
              <div className="text-center">
                <div className="text-sm font-bold tabular-nums text-indigo-300">📥 {queued.toLocaleString()}</div>
                <div className="text-[8px] uppercase tracking-wider text-slate-500">queued</div>
              </div>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
