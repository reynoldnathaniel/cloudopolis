import { AnimatePresence, motion } from 'framer-motion'
import { TRACKS, nextScenario } from '../game/scenarios'
import { SERVICES } from '../game/services'
import { useGameStore } from '../store'
import { RunTimeline } from './RunTimeline'

function Star({ earned, delay }: { earned: boolean; delay: number }) {
  return (
    <motion.span
      initial={{ scale: 0, rotate: -30 }}
      animate={{ scale: 1, rotate: 0 }}
      transition={{ delay, type: 'spring', stiffness: 300, damping: 14 }}
      className={`text-5xl ${earned ? 'text-amber-400 drop-shadow-[0_0_12px_rgba(251,191,36,0.5)]' : 'text-slate-700'}`}
    >
      ★
    </motion.span>
  )
}

function Pillar({ label, value, pass, target }: { label: string; value: string; pass: boolean; target: string }) {
  return (
    <div className="flex items-center justify-between rounded-lg bg-slate-800/60 px-3 py-2">
      <div>
        <div className="text-[11px] font-semibold text-slate-300">{label}</div>
        <div className="text-[9px] text-slate-500">{target}</div>
      </div>
      <div className={`text-sm font-bold tabular-nums ${pass ? 'text-emerald-400' : 'text-red-400'}`}>
        {pass ? '✓' : '✗'} {value}
      </div>
    </div>
  )
}

export function ResultsModal() {
  const results = useGameStore((s) => s.results)
  const phase = useGameStore((s) => s.phase)
  const backToEdit = useGameStore((s) => s.backToEdit)
  const startRun = useGameStore((s) => s.startRun)
  const scenario = useGameStore((s) => s.scenario())
  const selectScenario = useGameStore((s) => s.selectScenario)
  const openSelect = useGameStore((s) => s.openSelect)

  const show = phase === 'results' && results !== null
  const next = nextScenario(scenario.id)
  const track = TRACKS.find((t) => t.id === scenario.track)

  const verdict =
    !results ? '' :
    results.stars === 3 ? 'Well-Architected! 🏆' :
    results.stars === 2 ? 'It survived — but the bill hurts.' :
    results.stars === 1 ? 'It works… until traffic arrives.' :
    'The architecture fell over.'

  return (
    <AnimatePresence>
      {show && results && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="absolute inset-0 z-50 flex items-center justify-center bg-slate-950/70 backdrop-blur-sm"
        >
          <motion.div
            initial={{ scale: 0.85, y: 30 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.9, y: 20, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 260, damping: 22 }}
            className="max-h-[92vh] w-[420px] max-w-[92vw] overflow-y-auto rounded-2xl border border-slate-700 bg-slate-900 p-6 shadow-2xl"
          >
            <div className="text-center">
              <div className="flex justify-center gap-2">
                <Star earned={results.stars >= 1} delay={0.15} />
                <Star earned={results.stars >= 2} delay={0.35} />
                <Star earned={results.stars >= 3} delay={0.55} />
              </div>
              <h2 className="mt-2 text-lg font-bold text-slate-100">{verdict}</h2>
              <p className="text-[11px] text-slate-500">
                {track?.emoji} {track?.name} · {scenario.title}
              </p>
            </div>

            <RunTimeline />

            <div className="mt-4 space-y-2">
              {results.mode === 'async' ? (
                <>
                  <Pillar
                    label="📊 Delivery"
                    target="≥98% of events processed by run end"
                    value={`${Math.round((results.delivery ?? 0) * 100)}%`}
                    pass={(results.delivery ?? 0) >= 0.98}
                  />
                  <Pillar
                    label="⏳ Durability"
                    target="lose ≤1% of events"
                    value={`${((results.lostFraction ?? 0) * 100).toFixed(1)}% lost`}
                    pass={(results.lostFraction ?? 1) <= 0.01}
                  />
                  <Pillar
                    label="📥 Drain"
                    target="backlog empty at run end"
                    value={
                      (results.finalBacklog ?? 0) <= 1
                        ? 'drained'
                        : `${(results.finalBacklog ?? 0).toLocaleString()} stuck`
                    }
                    pass={(results.finalBacklog ?? 1) <= 1}
                  />
                </>
              ) : (
                <>
                  <Pillar
                    label="📊 Reliability"
                    target="serve ≥98% at baseline"
                    value={`${Math.round(results.baselineSuccess * 100)}%`}
                    pass={results.baselineSuccess >= 0.98}
                  />
                  <Pillar
                    label="⚡ Resilience"
                    target={`survive the spike (≥95%)`}
                    value={`${Math.round(results.spikeSuccess * 100)}%`}
                    pass={results.spikeSuccess >= 0.95}
                  />
                  {results.outageSuccess !== null && (
                    <Pillar
                      label="💥 Fault tolerance"
                      target="survive the AZ outage (≥95%)"
                      value={`${Math.round(results.outageSuccess * 100)}%`}
                      pass={results.outageSuccess >= 0.95}
                    />
                  )}
                </>
              )}
              {results.blueprintMissing !== null && (
                <Pillar
                  label="🧩 Blueprint"
                  target="uses the required services"
                  value={
                    results.blueprintMissing.length === 0
                      ? 'complete'
                      : `missing ${results.blueprintMissing.map((id) => SERVICES[id]?.name ?? id).join(', ')}`
                  }
                  pass={results.blueprintMissing.length === 0}
                />
              )}
              {results.securityFindings !== null && (
                <Pillar
                  label="🕵️ Security"
                  target="no internet-exposed resources"
                  value={results.securityFindings === 0 ? 'clean' : `${results.securityFindings} exposed`}
                  pass={results.securityFindings === 0}
                />
              )}
              <Pillar
                label="💰 Cost"
                target={`stay under $${results.budget}/mo`}
                value={`$${results.costAtBaseline}/mo`}
                pass={results.costAtBaseline <= results.budget}
              />
            </div>

            {results.tips.length > 0 && (
              <div className="mt-4 rounded-lg border border-amber-500/20 bg-amber-500/5 p-3">
                <div className="mb-1 text-[10px] font-bold uppercase tracking-wider text-amber-400">
                  Architect&apos;s notes
                </div>
                <ul className="space-y-1.5">
                  {results.tips.slice(0, 3).map((tip) => (
                    <li key={tip} className="text-[11px] leading-snug text-slate-300">
                      • {tip}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="mt-5 flex gap-2">
              <button
                onClick={backToEdit}
                className="flex-1 rounded-xl border border-slate-600 px-4 py-2.5 text-sm font-semibold text-slate-300 transition hover:border-slate-400 hover:text-white"
              >
                Refine design
              </button>
              {results.stars === 3 && next ? (
                <button
                  onClick={() => selectScenario(next.id)}
                  className="flex-1 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 px-4 py-2.5 text-sm font-bold text-white shadow-lg shadow-amber-500/25 transition hover:brightness-110"
                >
                  Next scenario →
                </button>
              ) : results.stars === 3 ? (
                <button
                  onClick={openSelect}
                  className="flex-1 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 px-4 py-2.5 text-sm font-bold text-white shadow-lg shadow-amber-500/25 transition hover:brightness-110"
                >
                  🗺️ All scenarios
                </button>
              ) : (
                <button
                  onClick={() => {
                    backToEdit()
                    setTimeout(startRun, 50)
                  }}
                  className="flex-1 rounded-xl bg-gradient-to-r from-cyan-500 to-indigo-500 px-4 py-2.5 text-sm font-bold text-white shadow-lg shadow-cyan-500/25 transition hover:brightness-110"
                >
                  ▶ Run again
                </button>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
