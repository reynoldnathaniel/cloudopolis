// The badge case. Locked badges are shown, not hidden: they read as a list of
// things worth trying, which is the only reason to have achievements at all.

import { AnimatePresence, motion } from 'framer-motion'
import { useGameStore } from '../store'
import { ACHIEVEMENTS } from '../game/achievements'

export function AchievementGallery({ open, onClose }: { open: boolean; onClose: () => void }) {
  const unlocked = useGameStore((s) => s.achievements)
  const has = (id: string) => unlocked.includes(id)
  const earned = ACHIEVEMENTS.filter((a) => has(a.id)).length

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm"
        >
          <motion.div
            initial={{ scale: 0.96, y: 12 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.96, opacity: 0 }}
            onClick={(e) => e.stopPropagation()}
            className="max-h-[85vh] w-[620px] max-w-full overflow-y-auto rounded-2xl border border-slate-700 bg-slate-900 p-6 shadow-2xl"
          >
            <div className="mb-4 flex items-baseline justify-between">
              <h2 className="text-lg font-bold text-slate-100">🏆 Achievements</h2>
              <span className="text-[12px] tabular-nums text-slate-400">
                {earned} of {ACHIEVEMENTS.length}
              </span>
            </div>

            <div className="grid gap-2 sm:grid-cols-2">
              {ACHIEVEMENTS.map((a) => (
                <div
                  key={a.id}
                  className={`rounded-xl border p-3 transition ${
                    has(a.id)
                      ? 'border-amber-500/40 bg-amber-500/5'
                      : 'border-slate-800 bg-slate-800/20'
                  }`}
                >
                  <div className="flex items-start gap-2.5">
                    <span className={`text-2xl ${has(a.id) ? '' : 'opacity-25 grayscale'}`}>
                      {a.emoji}
                    </span>
                    <div className="min-w-0">
                      <div
                        className={`text-[12px] font-bold ${
                          has(a.id) ? 'text-amber-200' : 'text-slate-500'
                        }`}
                      >
                        {a.name}
                      </div>
                      <div className="text-[10px] leading-snug text-slate-500">{a.description}</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <button
              onClick={onClose}
              className="mt-5 w-full rounded-xl border border-slate-700 py-2 text-[12px] font-semibold text-slate-300 transition hover:border-slate-500 hover:text-white"
            >
              Close
            </button>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
