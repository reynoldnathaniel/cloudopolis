import { AnimatePresence, motion } from 'framer-motion'
import { useGameStore } from '../store'
import { SANDBOX_ID } from '../game/scenarios'

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
  const attackRps = useGameStore((s) => s.attackRps)
  const blockedRps = useGameStore((s) => s.blockedRps)
  const success = useGameStore((s) => s.liveSuccess)
  const cost = useGameStore((s) => s.monthlyCost)
  const scenario = useGameStore((s) => s.scenario())
  const multiRegion = useGameStore((s) => s.scenario().multiRegion === true)
  const paused = useGameStore((s) => s.paused)
  const togglePause = useGameStore((s) => s.togglePause)
  const stepTick = useGameStore((s) => s.stepTick)
  const queued = useGameStore((s) =>
    Math.round(Object.values(s.nodeStats).reduce((sum, n) => sum + (n.backlog ?? 0), 0)),
  )

  const running = phase === 'run'
  const style = PHASE_STYLE[runPhase]
  // The outage chip is the one phase label that depends on which level of the
  // hierarchy just failed.
  // ...and an attack outranks the spike it arrives under: "SPIKE" is not what
  // the player needs to be reading while 6,000 junk requests a second land.
  const phaseLabel =
    runPhase === 'outage' && multiRegion
      ? 'REGION OUTAGE'
      : attackRps > 0 && scenario.attack
        ? scenario.attack.label
        : style.label
  const attackStyle = 'border-rose-500/60 bg-rose-500/20 text-rose-300 animate-pulse'
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
          // Above the incident overlay (z-60) on purpose. An incident asks you
          // a question about the run — "is this a capacity problem?" — and the
          // readouts are how you answer it. Blurring them out behind the card
          // makes the decision a guess. Nothing else overlays during a run, and
          // the expanded timeline (z-70) belongs to the results screen.
          className="pointer-events-none absolute left-1/2 top-4 z-[65] -translate-x-1/2"
        >
          <div className="flex items-center gap-5 rounded-2xl border border-slate-700 bg-slate-900/90 px-5 py-2.5 shadow-2xl backdrop-blur">
            <span
              className={`rounded-md border px-2 py-0.5 text-[10px] font-bold tracking-widest ${
                paused
                  ? 'border-slate-500 bg-slate-700/40 text-slate-300'
                  : attackRps > 0
                    ? attackStyle
                    : style.cls
              }`}
            >
              {paused ? '⏸ PAUSED' : phaseLabel}
            </span>
            {/* Under attack the chip already says so and the junk counter says
                how much — a second red sentence just crowds the readouts off
                the row, and the readouts are what the incident is asking about. */}
            {runPhase === 'spike' && attackRps === 0 && (
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
              <div className="text-[8px] uppercase tracking-wider text-slate-500">
                {attackRps > 0 ? 'real req/s' : 'req/s'}
              </div>
            </div>
            {/* The two numbers that decide this level: how much junk arrived,
                and how much of it died before it cost anything. */}
            {attackRps > 0 && (
              <div className="text-center">
                <div className="text-sm font-bold tabular-nums text-rose-400">
                  +{attackRps.toLocaleString()}
                </div>
                <div className="text-[8px] uppercase tracking-wider text-slate-500">junk/s</div>
              </div>
            )}
            {blockedRps > 0 && (
              <div className="text-center">
                <div className="text-sm font-bold tabular-nums text-emerald-400">
                  🛡 {Math.round(blockedRps).toLocaleString()}
                </div>
                <div className="text-[8px] uppercase tracking-wider text-slate-500">blocked</div>
              </div>
            )}
            <div className="text-center">
              <div className={`text-sm font-bold tabular-nums ${successColor}`}>{successPct}%</div>
              <div className="text-[8px] uppercase tracking-wider text-slate-500">served</div>
            </div>
            <div className="text-center">
              <div className={`text-sm font-bold tabular-nums ${overBudget ? 'text-red-400' : 'text-emerald-400'}`}>
                ${cost}
              </div>
              <div className="text-[8px] uppercase tracking-wider text-slate-500">
                {/* The sandbox has no budget — don't show it a cap. */}
                {scenario.id === SANDBOX_ID ? '/mo · no cap' : `/mo (cap $${scenario.budget})`}
              </div>
            </div>
            {queued > 0 && (
              <div className="text-center">
                <div className="text-sm font-bold tabular-nums text-indigo-300">📥 {queued.toLocaleString()}</div>
                <div className="text-[8px] uppercase tracking-wider text-slate-500">queued</div>
              </div>
            )}

            {/* Presenter controls: freeze the run mid-sentence, then walk it
                forward a tick at a time while narrating. */}
            <div className="pointer-events-auto flex items-center gap-1 border-l border-slate-700 pl-3">
              <button
                onClick={togglePause}
                title={paused ? 'Resume the simulation' : 'Pause the simulation'}
                aria-label={paused ? 'Resume' : 'Pause'}
                className={`rounded-lg border px-2 py-1 text-[12px] transition ${
                  paused
                    ? 'border-emerald-500/60 bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25'
                    : 'border-slate-600 text-slate-300 hover:border-slate-400 hover:text-white'
                }`}
              >
                {paused ? '▶' : '⏸'}
              </button>
              <button
                onClick={stepTick}
                disabled={!paused}
                title="Advance one tick"
                aria-label="Step one tick"
                className="rounded-lg border border-slate-600 px-2 py-1 text-[12px] text-slate-300 transition hover:border-slate-400 hover:text-white disabled:cursor-not-allowed disabled:opacity-30"
              >
                ⏭
              </button>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
