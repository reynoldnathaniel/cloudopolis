import { useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { TRACKS, scenariosInTrack } from '../game/scenarios'
import { SERVICES } from '../game/services'
import { ICONS } from '../game/icons'
import { useGameStore } from '../store'

function MissionLine({ icon, children }: { icon: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2.5 text-[13px] leading-relaxed text-slate-200">
      <span className="mt-px w-5 shrink-0 text-center">{icon}</span>
      <span>{children}</span>
    </div>
  )
}

export function MissionBriefing() {
  const open = useGameStore((s) => s.briefingOpen)
  const closeBriefing = useGameStore((s) => s.closeBriefing)
  const scenario = useGameStore((s) => s.scenario())
  const [showHints, setShowHints] = useState(false)

  const track = TRACKS.find((t) => t.id === scenario.track)
  const trackSize = scenariosInTrack(scenario.track).length
  const requiredNames = (scenario.requiredServices ?? []).map((id) => SERVICES[id]?.name ?? id)
  const bannedNames = (scenario.banned ?? []).map((id) => SERVICES[id]?.name ?? id)

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="absolute inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm"
        >
          <motion.div
            initial={{ scale: 0.9, y: 24 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.94, y: 16, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 280, damping: 24 }}
            className="max-h-[88vh] w-[440px] max-w-[92vw] overflow-y-auto rounded-2xl border border-slate-700 bg-slate-900 p-6 shadow-2xl"
          >
            <div className="flex items-center gap-3">
              <motion.span
                initial={{ scale: 0, rotate: -20 }}
                animate={{ scale: 1, rotate: 0 }}
                transition={{ delay: 0.1, type: 'spring', stiffness: 300, damping: 15 }}
                className="text-4xl"
              >
                {scenario.emoji}
              </motion.span>
              <div className="min-w-0">
                <h2 className="text-xl font-bold text-slate-100">{scenario.title}</h2>
                <div className="flex items-center gap-2 text-[11px] text-slate-500">
                  <span>
                    {track?.emoji} {track?.name} track · mission {scenario.order} of {trackSize}
                  </span>
                  <span className="flex gap-0.5">
                    {[1, 2, 3].map((i) => (
                      <span
                        key={i}
                        className={`h-1.5 w-1.5 rounded-full ${
                          i <= scenario.difficulty ? 'bg-orange-400' : 'bg-slate-700'
                        }`}
                      />
                    ))}
                  </span>
                </div>
              </div>
            </div>

            <p className="mt-4 text-[13.5px] leading-relaxed text-slate-300">{scenario.brief}</p>

            <div className="mt-4 border-t border-slate-800 pt-3.5">
              <div className="mb-2 text-[10px] font-bold uppercase tracking-widest text-cyan-400">
                Your mission
              </div>
              <div className="space-y-2">
                <MissionLine icon="📊">
                  {scenario.async ? 'Ingest' : 'Serve'}{' '}
                  <b className="text-sky-300">{scenario.baselineRps.toLocaleString()} rps</b> at
                  baseline — survive bursts of{' '}
                  <b className="text-red-400">{scenario.spikeRps.toLocaleString()} rps</b>
                </MissionLine>
                {scenario.async && (
                  <MissionLine icon="⏳">
                    Events may be delayed, but <b className="text-indigo-300">none may be lost</b> —
                    and the backlog must drain by run end
                  </MissionLine>
                )}
                {scenario.hasOutage && (
                  <MissionLine icon="💥">
                    Survive a full <b className="text-fuchsia-300">Availability Zone failure</b> —
                    everything zonal dies with its AZ
                  </MissionLine>
                )}
                {scenario.hasProbe && (
                  <MissionLine icon="🕵️">
                    Pass the security probe — nothing exposed to the raw internet
                  </MissionLine>
                )}
                {requiredNames.length > 0 && (
                  <MissionLine icon="🧩">
                    Build with{' '}
                    <span className="inline-flex items-center gap-1 align-middle">
                      {(scenario.requiredServices ?? []).map((id) => (
                        <img
                          key={id}
                          src={ICONS[id]}
                          alt={SERVICES[id]?.name ?? id}
                          title={SERVICES[id]?.fullName}
                          className="inline h-5 w-5 rounded"
                          draggable={false}
                        />
                      ))}
                    </span>{' '}
                    <b className="text-teal-300">{requiredNames.join(' + ')}</b> — the scenario
                    requires them
                  </MissionLine>
                )}
                {bannedNames.length > 0 && (
                  <MissionLine icon="🔒">
                    <b className="text-slate-300">{bannedNames.join(', ')}</b>{' '}
                    {bannedNames.length > 1 ? 'are' : 'is'} off-limits:{' '}
                    <span className="text-slate-400">{scenario.bannedReason}</span>
                  </MissionLine>
                )}
                <MissionLine icon="💰">
                  Stay under <b className="text-emerald-400">${scenario.budget}/mo</b>
                </MissionLine>
              </div>
            </div>

            {showHints && (
              <div className="mt-3 rounded-lg border border-amber-500/20 bg-amber-500/5 p-3">
                <ul className="space-y-1.5">
                  {scenario.goalHints.map((h) => (
                    <li key={h} className="text-[12px] leading-snug text-amber-300/90">
                      💡 {h}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="mt-5 flex gap-2">
              <button
                onClick={closeBriefing}
                className="flex-1 rounded-xl bg-gradient-to-r from-cyan-500 to-indigo-500 px-4 py-2.5 text-sm font-bold text-white shadow-lg shadow-cyan-500/25 transition hover:brightness-110 active:scale-[0.98]"
              >
                ▶ Let&apos;s build
              </button>
              <button
                onClick={() => setShowHints(!showHints)}
                className="rounded-xl border border-slate-600 px-4 py-2.5 text-sm font-semibold text-slate-300 transition hover:border-amber-400/60 hover:text-amber-300"
              >
                💡 {showHints ? 'Hide hints' : 'Hints'}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
