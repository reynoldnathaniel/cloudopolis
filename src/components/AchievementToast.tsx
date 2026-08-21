// The badge toast. Sits bottom-right so it never covers the results modal or
// the HUD, and clears itself — earning something should feel like a nod, not an
// interruption you have to dismiss.

import { useEffect } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useGameStore } from '../store'
import { achievementById } from '../game/achievements'

const SHOW_MS = 4200

export function AchievementToast() {
  const newAchievements = useGameStore((s) => s.newAchievements)
  const clear = useGameStore((s) => s.clearNewAchievements)

  useEffect(() => {
    if (newAchievements.length === 0) return
    // One timer for the batch: finishing a track can earn three at once, and
    // three staggered timers would leave the last one hanging on its own.
    const timer = setTimeout(clear, SHOW_MS + newAchievements.length * 250)
    return () => clearTimeout(timer)
  }, [newAchievements, clear])

  return (
    <div className="pointer-events-none fixed bottom-5 right-5 z-[80] flex flex-col items-end gap-2">
      <AnimatePresence>
        {newAchievements.map((id, i) => {
          const badge = achievementById(id)
          if (!badge) return null
          return (
            <motion.div
              key={id}
              initial={{ opacity: 0, x: 40, scale: 0.9 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              exit={{ opacity: 0, x: 40 }}
              transition={{ delay: i * 0.25, type: 'spring', stiffness: 300, damping: 26 }}
              className="w-[300px] rounded-xl border border-amber-500/50 bg-slate-900/95 p-3 shadow-2xl backdrop-blur"
            >
              <div className="flex items-center gap-3">
                <span className="text-3xl">{badge.emoji}</span>
                <div className="min-w-0">
                  <div className="text-[9px] font-bold uppercase tracking-widest text-amber-400">
                    Achievement unlocked
                  </div>
                  <div className="text-[13px] font-bold text-slate-100">{badge.name}</div>
                  <div className="text-[10px] leading-snug text-slate-400">{badge.description}</div>
                </div>
              </div>
            </motion.div>
          )
        })}
      </AnimatePresence>
    </div>
  )
}
