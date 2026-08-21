// The incident that interrupts a run. The simulation is already frozen by the
// time this appears; the countdown is the only thing still moving, and when it
// hits zero the scenario's runbook default is applied for you.

import { useEffect, useState } from 'react'
import { useGameStore } from '../store'

export function DecisionModal() {
  const decision = useGameStore((s) => s.pendingDecision)
  const chooseDecision = useGameStore((s) => s.chooseDecision)
  const [left, setLeft] = useState(0)

  // Restart the clock whenever a new incident arrives, and let it run down.
  useEffect(() => {
    if (!decision) return
    setLeft(decision.seconds)
    const started = performance.now()
    const timer = setInterval(() => {
      const remaining = decision.seconds - (performance.now() - started) / 1000
      if (remaining <= 0) {
        clearInterval(timer)
        setLeft(0)
        chooseDecision(decision.defaultIndex, true)
      } else {
        setLeft(remaining)
      }
    }, 100)
    return () => clearInterval(timer)
  }, [decision, chooseDecision])

  const pct = decision ? Math.max(0, Math.min(1, left / decision.seconds)) : 0
  const urgent = left <= 5

  return (
    // This overlay covers the entire canvas, and AnimatePresence leaves exited
    // children in the DOM here (a known quirk in this app). Left alone that is a
    // full-screen invisible click-trap, so the pointer gate lives on this
    // always-rendered wrapper — which does re-render — and the card inherits it.
    // No entrance animation, deliberately. AnimatePresence misbehaves for this
    // overlay — it stalls the fade partway and leaves the exited element in the
    // DOM, which on a full-screen backdrop means a permanent grey veil and an
    // invisible click-trap over the whole canvas. Plain conditional rendering
    // has neither problem, and an alarm that appears instantly reads better
    // than one that eases in.
    <div
      className={`absolute inset-0 z-[60] flex items-center justify-center ${
        decision
          ? 'pointer-events-auto bg-slate-950/80 backdrop-blur-sm'
          : 'pointer-events-none'
      }`}
    >
      {decision && (
        <div className="w-[460px] max-w-[92vw] overflow-hidden rounded-2xl border border-amber-500/50 bg-slate-900 shadow-2xl">
          {/* Countdown reads as a draining bar rather than a number to squint at. */}
            <div className="h-1 w-full bg-slate-800">
              <div
                className={`h-full transition-[width] duration-100 ease-linear ${
                  urgent ? 'bg-red-500' : 'bg-amber-400'
                }`}
                style={{ width: `${pct * 100}%` }}
              />
            </div>

            <div className="p-6">
              <div className="flex items-start gap-3">
                <span className="text-4xl">{decision.emoji}</span>
                <div className="min-w-0 flex-1">
                  <div className="text-[10px] font-bold uppercase tracking-widest text-amber-400">
                    Incident · decide now
                  </div>
                  <h2 className="text-lg font-bold text-slate-100">{decision.title}</h2>
                </div>
                <span
                  className={`shrink-0 rounded-lg border px-2 py-1 text-sm font-bold tabular-nums ${
                    urgent
                      ? 'animate-pulse border-red-500/60 bg-red-500/10 text-red-300'
                      : 'border-slate-700 text-slate-300'
                  }`}
                >
                  {Math.ceil(left)}s
                </span>
              </div>

              <p className="mt-3 text-[13.5px] leading-relaxed text-slate-300">{decision.prompt}</p>

              <div className="mt-5 space-y-2">
                {decision.options.map((option, i) => (
                  <button
                    key={option.label}
                    onClick={() => chooseDecision(i)}
                    className={`w-full rounded-xl border px-4 py-3 text-left transition ${
                      option.surcharge
                        ? 'border-amber-500/40 bg-amber-500/5 hover:border-amber-400 hover:bg-amber-500/10'
                        : 'border-slate-600 hover:border-cyan-400/70 hover:bg-cyan-500/5'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-[13px] font-bold text-slate-100">{option.label}</span>
                      {option.surcharge ? (
                        <span className="shrink-0 text-[11px] font-bold text-amber-300">
                          +${option.surcharge}/mo
                        </span>
                      ) : (
                        <span className="shrink-0 text-[11px] text-slate-500">no charge</span>
                      )}
                    </div>
                    {i === decision.defaultIndex && (
                      <div className="mt-0.5 text-[10px] text-slate-500">
                        your runbook does this if the clock runs out
                      </div>
                    )}
                  </button>
                ))}
              </div>
            </div>
        </div>
      )}
    </div>
  )
}
