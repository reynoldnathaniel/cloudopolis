// Shown over the canvas right after a reference answer is revealed: the design
// is now sitting there, and this says why it works. Non-modal on purpose — you
// should be able to read it while looking at the graph it describes.

import { AnimatePresence, motion } from 'framer-motion'
import { useGameStore } from '../store'

export function SolutionNotes() {
  const notes = useGameStore((s) => s.solutionNotes)
  const dismiss = useGameStore((s) => s.dismissSolutionNotes)
  const startRun = useGameStore((s) => s.startRun)
  const title = useGameStore((s) => s.scenario().title)

  return (
    // AnimatePresence leaves the faded-out card in the DOM here (a known quirk
    // in this app, same as the tutorial coach) and will not re-render it with
    // fresh props once it is exiting. The coach cards collapse to zero width so
    // nobody notices; this one is 520px of bottom-centre canvas, and left as-is
    // it keeps swallowing clicks — a dead zone you cannot drag a node through.
    // So the click gate lives on this always-rendered wrapper, which does see
    // the state change, and the card inherits it.
    <div
      className={`absolute bottom-4 left-1/2 z-40 w-[520px] max-w-[92vw] -translate-x-1/2 ${
        notes ? 'pointer-events-auto' : 'pointer-events-none'
      }`}
    >
      <AnimatePresence>
        {notes && (
          <motion.div
            key="solution-notes"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 16 }}
            transition={{ type: 'spring', stiffness: 280, damping: 26 }}
            className="rounded-2xl border border-indigo-500/40 bg-slate-900/95 p-4 shadow-2xl backdrop-blur"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-[10px] font-bold uppercase tracking-widest text-indigo-400">
                  Reference answer · {title}
                </div>
                <div className="text-[12px] text-slate-500">
                  On the canvas now. Run it and watch each pillar pass.
                </div>
              </div>
              <button
                onClick={dismiss}
                title="Dismiss"
                aria-label="Dismiss the reference answer notes"
                className="rounded-lg border border-slate-700 px-2 py-0.5 text-[12px] text-slate-400 transition hover:border-slate-500 hover:text-slate-200"
              >
                ✕
              </button>
            </div>

            <ul className="mt-3 space-y-2">
              {notes.map((note) => (
                <li key={note} className="flex gap-2 text-[12px] leading-snug text-slate-300">
                  <span className="text-indigo-400">•</span>
                  <span>{note}</span>
                </li>
              ))}
            </ul>

            <button
              onClick={() => {
                dismiss()
                startRun()
              }}
              className="mt-3.5 w-full rounded-xl bg-gradient-to-r from-cyan-500 to-indigo-500 px-4 py-2 text-[13px] font-bold text-white shadow-lg shadow-cyan-500/25 transition hover:brightness-110"
            >
              ▶ Run the reference design
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
