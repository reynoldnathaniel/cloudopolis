import { useEffect } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { TUTORIAL_STEPS } from '../game/tutorial'
import { useGameStore } from '../store'

/** Highlight key for the current tutorial step, or null. Used by Palette/ScenarioPanel. */
export function useTutorialHighlight(): string | null {
  return useGameStore((s) =>
    s.tutorialStep === null ? null : (TUTORIAL_STEPS[s.tutorialStep]?.highlight ?? null),
  )
}

export function TutorialCoach() {
  const stepIdx = useGameStore((s) => s.tutorialStep)
  const nodes = useGameStore((s) => s.nodes)
  const edges = useGameStore((s) => s.edges)
  const phase = useGameStore((s) => s.phase)
  const results = useGameStore((s) => s.results)
  const tutorialNext = useGameStore((s) => s.tutorialNext)
  const tutorialSkip = useGameStore((s) => s.tutorialSkip)

  const step = stepIdx === null ? null : TUTORIAL_STEPS[stepIdx]

  // Auto-advance steps whose action the player has completed.
  useEffect(() => {
    if (step?.done && step.done({ nodes, edges, phase, results })) {
      tutorialNext()
    }
  }, [step, nodes, edges, phase, results, tutorialNext])

  const isLast = stepIdx !== null && stepIdx === TUTORIAL_STEPS.length - 1
  // The results modal owns the bottom-center of the screen — dodge to the top
  // so its buttons stay clickable while the coach explains them.
  const onResults = phase === 'results'

  return (
    <AnimatePresence>
      {step && stepIdx !== null && (
        <motion.div
          key={step.id}
          initial={{ y: onResults ? -60 : 60, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: onResults ? -40 : 40, opacity: 0 }}
          transition={{ type: 'spring', stiffness: 300, damping: 26 }}
          className={`absolute left-1/2 z-[60] w-[420px] max-w-[90vw] -translate-x-1/2 ${
            onResults ? 'top-4' : 'bottom-5'
          }`}
        >
          <div className="rounded-2xl border border-cyan-500/40 bg-slate-900/95 p-4 shadow-2xl shadow-cyan-500/10 backdrop-blur">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold uppercase tracking-widest text-cyan-400">
                Tutorial · {stepIdx + 1}/{TUTORIAL_STEPS.length}
              </span>
              {!isLast && (
                <button
                  onClick={tutorialSkip}
                  className="text-[10px] text-slate-500 transition hover:text-slate-300"
                >
                  skip tutorial ✕
                </button>
              )}
            </div>
            <h3 className="mt-1 text-sm font-bold text-slate-100">{step.title}</h3>
            <p className="mt-1 text-[12px] leading-relaxed text-slate-300">{step.body}</p>
            <div className="mt-3 flex items-center justify-between">
              <div className="flex gap-1">
                {TUTORIAL_STEPS.map((s, i) => (
                  <span
                    key={s.id}
                    className={`h-1 w-3 rounded-full ${i <= stepIdx ? 'bg-cyan-400' : 'bg-slate-700'}`}
                  />
                ))}
              </div>
              {step.done ? (
                <span className="flex items-center gap-1.5 text-[10px] text-slate-500">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-400" />
                  waiting for you…
                </span>
              ) : (
                <button
                  onClick={tutorialNext}
                  className="rounded-lg bg-gradient-to-r from-cyan-500 to-indigo-500 px-4 py-1.5 text-[12px] font-bold text-white transition hover:brightness-110"
                >
                  {isLast ? 'Finish 🎉' : 'Next →'}
                </button>
              )}
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
