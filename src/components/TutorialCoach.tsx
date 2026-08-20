import { useEffect } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { TUTORIAL_STEPS } from '../game/tutorial'
import { SANDBOX_TUTORIAL_STEPS } from '../game/sandboxTutorial'
import { useGameStore } from '../store'

/**
 * Highlight key for whichever tutorial is running, or null. Read by the
 * Palette, the ScenarioPanel, and the SandboxPanel to ring the control the
 * current step is talking about.
 */
export function useTutorialHighlight(): string | null {
  return useGameStore((s) => {
    if (s.tutorialStep !== null) return TUTORIAL_STEPS[s.tutorialStep]?.highlight ?? null
    if (s.sandboxTutorialStep !== null)
      return SANDBOX_TUTORIAL_STEPS[s.sandboxTutorialStep]?.highlight ?? null
    return null
  })
}

const SPRING = { type: 'spring', stiffness: 300, damping: 26 } as const

/**
 * The card's contents — shared so both tutorials look identical. The animated
 * wrapper deliberately stays at each call site: AnimatePresence only removes a
 * child it owns directly, and wrapping this in a component left the exited card
 * in the DOM indefinitely.
 */
function CoachBody({
  label,
  title,
  body,
  index,
  total,
  waiting,
  onNext,
  onSkip,
}: {
  label: string
  title: string
  body: string
  index: number
  total: number
  waiting: boolean
  onNext: () => void
  onSkip: () => void
}) {
  const isLast = index === total - 1
  return (
    <div className="rounded-2xl border border-cyan-500/40 bg-slate-900/95 p-4 shadow-2xl shadow-cyan-500/10 backdrop-blur">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-bold uppercase tracking-widest text-cyan-400">
          {label} · {index + 1}/{total}
        </span>
        {!isLast && (
          <button onClick={onSkip} className="text-[10px] text-slate-500 transition hover:text-slate-300">
            skip tutorial ✕
          </button>
        )}
      </div>
      <h3 className="mt-1 text-sm font-bold text-slate-100">{title}</h3>
      <p className="mt-1 text-[12px] leading-relaxed text-slate-300">{body}</p>
      <div className="mt-3 flex items-center justify-between">
        <div className="flex gap-1">
          {Array.from({ length: total }, (_, i) => (
            <span key={i} className={`h-1 w-3 rounded-full ${i <= index ? 'bg-cyan-400' : 'bg-slate-700'}`} />
          ))}
        </div>
        {waiting ? (
          <span className="flex items-center gap-1.5 text-[10px] text-slate-500">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-400" />
            waiting for you…
          </span>
        ) : (
          <button
            onClick={onNext}
            className="rounded-lg bg-gradient-to-r from-cyan-500 to-indigo-500 px-4 py-1.5 text-[12px] font-bold text-white transition hover:brightness-110"
          >
            {isLast ? 'Finish 🎉' : 'Next →'}
          </button>
        )}
      </div>
    </div>
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

  // The results modal owns the bottom-center of the screen — dodge to the top
  // so its buttons stay clickable while the coach explains them.
  const dodgeTop = phase === 'results'

  return (
    <AnimatePresence>
      {step && stepIdx !== null && (
        <motion.div
          key={step.id}
          initial={{ y: dodgeTop ? -60 : 60, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: dodgeTop ? -40 : 40, opacity: 0 }}
          transition={SPRING}
          className={`absolute left-1/2 z-[60] w-[420px] max-w-[90vw] -translate-x-1/2 ${
            dodgeTop ? 'top-4' : 'bottom-5'
          }`}
        >
          <CoachBody
            label="Tutorial"
            title={step.title}
            body={step.body}
            index={stepIdx}
            total={TUTORIAL_STEPS.length}
            waiting={Boolean(step.done)}
            onNext={tutorialNext}
            onSkip={tutorialSkip}
          />
        </motion.div>
      )}
    </AnimatePresence>
  )
}

export function SandboxCoach() {
  const stepIdx = useGameStore((s) => s.sandboxTutorialStep)
  const nodes = useGameStore((s) => s.nodes)
  const edges = useGameStore((s) => s.edges)
  const phase = useGameStore((s) => s.phase)
  const rps = useGameStore((s) => s.sandboxRps)
  const need = useGameStore((s) => s.sandboxNeed)
  const deadAzs = useGameStore((s) => s.sandboxDeadAzs)
  const probeCount = useGameStore((s) => s.sandboxProbeCount)
  const next = useGameStore((s) => s.sandboxTutorialNext)
  const skip = useGameStore((s) => s.sandboxTutorialSkip)

  const step = stepIdx === null ? null : SANDBOX_TUTORIAL_STEPS[stepIdx]

  useEffect(() => {
    if (step?.done && step.done({ nodes, edges, phase, rps, need, deadAzs, probeCount })) {
      next()
    }
  }, [step, nodes, edges, phase, rps, need, deadAzs, probeCount, next])

  return (
    <AnimatePresence>
      {step && stepIdx !== null && (
        <motion.div
          key={step.id}
          initial={{ y: 60, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 40, opacity: 0 }}
          transition={SPRING}
          className="absolute bottom-5 left-1/2 z-[60] w-[420px] max-w-[90vw] -translate-x-1/2"
        >
          <CoachBody
            label="Sandbox tour"
            title={step.title}
            body={step.body}
            index={stepIdx}
            total={SANDBOX_TUTORIAL_STEPS.length}
            waiting={Boolean(step.done)}
            onNext={next}
            onSkip={skip}
          />
        </motion.div>
      )}
    </AnimatePresence>
  )
}
