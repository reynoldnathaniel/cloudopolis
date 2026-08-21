import { AnimatePresence, motion } from 'framer-motion'
import { useReactFlow } from '@xyflow/react'
import { TRACKS, nextScenario } from '../game/scenarios'
import { SERVICES } from '../game/services'
import { useState } from 'react'
import { useGameStore } from '../store'
import { RunTimeline } from './RunTimeline'
import { exportShareCard } from '../game/exportImage'

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
  const nodes = useGameStore((s) => s.nodes)
  const [shot, setShot] = useState<'idle' | 'working' | 'done'>('idle')
  const [confirmReveal, setConfirmReveal] = useState(false)
  const canReveal = useGameStore((s) => s.canRevealSolution())
  const revealSolution = useGameStore((s) => s.revealSolution)
  const { getNodesBounds } = useReactFlow()
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
                      label={scenario.multiRegion ? '🌑 Fault tolerance' : '💥 Fault tolerance'}
                      target={
                        scenario.multiRegion
                          ? 'survive the Region failure (≥95%)'
                          : 'survive the AZ outage (≥95%)'
                      }
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
              {/* Whether the attack ever reached a meter is the pillar this
                  level actually turns on, so it gets stated outright rather
                  than left to be inferred from the cost line. */}
              {results.blockedPeak !== null && (
                <Pillar
                  label="🛡 Attack surface"
                  target="drop the flood before it costs you anything"
                  value={
                    results.attackBill > 0
                      ? `$${results.attackBill}/mo billed`
                      : results.blockedPeak > 0
                        ? `${results.blockedPeak.toLocaleString()} blocked`
                        : 'nothing filtered'
                  }
                  pass={results.attackBill === 0 && results.blockedPeak > 0}
                />
              )}
              <Pillar
                label="💰 Cost"
                target={[
                  `stay under $${results.budget}/mo`,
                  results.surcharge > 0 ? `incl. $${results.surcharge} bought mid-incident` : null,
                  results.attackBill > 0 ? `incl. $${results.attackBill} of attack traffic` : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
                value={`$${results.costAtBaseline}/mo`}
                pass={results.costAtBaseline <= results.budget}
              />
            </div>

            {results.decisions.length > 0 && (
              <div className="mt-4 rounded-lg border border-slate-700/70 bg-slate-800/40 p-3">
                <div className="mb-2 text-[10px] font-bold uppercase tracking-wider text-amber-400">
                  🚨 Calls you made
                </div>
                <ul className="space-y-2">
                  {results.decisions.map((d) => (
                    <li key={d.title} className="text-[11px] leading-snug">
                      <div className="flex items-baseline gap-1.5">
                        <span>{d.emoji}</span>
                        <span className="font-semibold text-slate-200">{d.choice}</span>
                        {d.surcharge > 0 && (
                          <span className="font-bold text-amber-300">+${d.surcharge}/mo</span>
                        )}
                        {d.auto && <span className="text-[9px] text-slate-500">· runbook default</span>}
                      </div>
                      <div className="text-slate-400">{d.outcome}</div>
                    </li>
                  ))}
                </ul>
              </div>
            )}

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

            {/* Offered only after this scenario has been failed twice. The
                design it drops in is pinned to three stars by solutions.test.ts. */}
            {canReveal && results.stars < 3 && (
              <div className="mt-4 rounded-lg border border-indigo-500/30 bg-indigo-500/5 p-3">
                {confirmReveal ? (
                  <>
                    <div className="text-[11px] leading-snug text-slate-300">
                      This replaces everything on your canvas with a reference design that scores
                      three stars. Your current layout will be gone.
                    </div>
                    <div className="mt-2.5 flex gap-2">
                      <button
                        onClick={revealSolution}
                        className="flex-1 rounded-lg bg-indigo-500 px-3 py-1.5 text-[12px] font-bold text-white transition hover:brightness-110"
                      >
                        Show me
                      </button>
                      <button
                        onClick={() => setConfirmReveal(false)}
                        className="rounded-lg border border-slate-600 px-3 py-1.5 text-[12px] font-semibold text-slate-300 transition hover:border-slate-400"
                      >
                        Keep mine
                      </button>
                    </div>
                  </>
                ) : (
                  <button
                    onClick={() => setConfirmReveal(true)}
                    className="w-full text-left text-[12px] font-semibold text-indigo-300 transition hover:text-indigo-200"
                  >
                    📖 Stuck? Reveal a 3-star answer
                  </button>
                )}
              </div>
            )}

            <button
              onClick={async () => {
                if (!results) return
                setShot('working')
                const ok = await exportShareCard(getNodesBounds(nodes), {
                  emoji: scenario.emoji,
                  title: scenario.title,
                  track: `${track?.emoji ?? ''} ${track?.name ?? ''}`.trim(),
                  stars: results.stars,
                  cost: results.costAtBaseline,
                  budget: results.budget,
                  origin: window.location.host,
                })
                setShot(ok ? 'done' : 'idle')
                setTimeout(() => setShot('idle'), 2500)
              }}
              disabled={shot === 'working'}
              className="mt-4 w-full rounded-xl border border-slate-700 py-2 text-[12px] font-semibold text-slate-300 transition hover:border-slate-500 hover:text-white disabled:opacity-50"
            >
              {shot === 'working' ? '📸 rendering…' : shot === 'done' ? '✓ saved' : '📸 Share card'}
            </button>

            <div className="mt-3 flex gap-2">
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
