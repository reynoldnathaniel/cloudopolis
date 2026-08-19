import { motion } from 'framer-motion'
import { TRACKS, scenariosInTrack } from '../game/scenarios'
import { useGameStore } from '../store'

function Dots({ n }: { n: 1 | 2 | 3 }) {
  return (
    <span className="flex gap-0.5">
      {[1, 2, 3].map((i) => (
        <span
          key={i}
          className={`h-1.5 w-1.5 rounded-full ${i <= n ? 'bg-orange-400' : 'bg-slate-700'}`}
        />
      ))}
    </span>
  )
}

export function ScenarioSelect() {
  const playScenario = useGameStore((s) => s.playScenario)
  const returnToMenu = useGameStore((s) => s.returnToMenu)
  const bestStars = useGameStore((s) => s.bestStars)
  const currentId = useGameStore((s) => s.scenarioId)

  return (
    <div className="h-screen w-screen overflow-y-auto bg-slate-950 text-slate-100">
      <div className="mx-auto max-w-3xl px-6 py-8">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="bg-gradient-to-r from-cyan-400 to-indigo-400 bg-clip-text text-2xl font-black tracking-tight text-transparent">
              Choose your scenario
            </h1>
            <p className="text-[12px] text-slate-500">
              Tracks are independent — jump straight to the domain you care about.
            </p>
          </div>
          <button
            onClick={returnToMenu}
            className="rounded-lg border border-slate-700 px-3 py-1.5 text-[12px] text-slate-400 transition hover:border-slate-500 hover:text-slate-200"
          >
            ⌂ Menu
          </button>
        </div>

        <div className="space-y-8 pb-10">
          {TRACKS.map((track, ti) => (
            <motion.section
              key={track.id}
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: ti * 0.08 }}
            >
              <div className="mb-2 flex items-baseline gap-2">
                <h2 className="text-sm font-bold text-slate-200">
                  {track.emoji} {track.name}
                </h2>
                <span className="text-[11px] text-slate-500">{track.description}</span>
              </div>
              <div className="grid grid-cols-2 gap-2.5 md:grid-cols-3">
                {scenariosInTrack(track.id).map((sc) => {
                  const earned = bestStars[sc.id] ?? 0
                  const isCurrent = sc.id === currentId
                  return (
                    <button
                      key={sc.id}
                      onClick={() => playScenario(sc.id)}
                      className={`group rounded-xl border p-3 text-left transition hover:-translate-y-0.5 hover:border-cyan-500/60 hover:bg-cyan-500/5 ${
                        isCurrent
                          ? 'border-cyan-500/50 bg-cyan-500/10'
                          : 'border-slate-700/70 bg-slate-900/60'
                      }`}
                    >
                      <div className="flex items-start justify-between">
                        <span className="text-2xl">{sc.emoji}</span>
                        <span className="text-[11px] tracking-tight">
                          {[1, 2, 3].map((i) => (
                            <span key={i} className={i <= earned ? 'text-amber-400' : 'text-slate-700'}>
                              ★
                            </span>
                          ))}
                        </span>
                      </div>
                      <div className="mt-1.5 text-[13px] font-bold text-slate-100">
                        {sc.order}. {sc.title}
                      </div>
                      <div className="mt-0.5 line-clamp-2 min-h-[2em] text-[10px] leading-snug text-slate-400">
                        {sc.hook}
                      </div>
                      <div className="mt-2 flex items-center justify-between">
                        <Dots n={sc.difficulty} />
                        <span className="text-[9px] text-slate-500">
                          {isCurrent ? 'current' : `$${sc.budget}/mo budget`}
                        </span>
                      </div>
                    </button>
                  )
                })}
              </div>
            </motion.section>
          ))}
        </div>
      </div>
    </div>
  )
}
