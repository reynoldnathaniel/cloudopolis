import { motion } from 'framer-motion'
import { ICONS } from '../game/icons'
import { SCENARIOS } from '../game/scenarios'
import { useGameStore } from '../store'

const STRIP = ['cloudfront', 's3', 'alb', 'ec2', 'asg', 'lambda', 'apigw', 'rds', 'dynamodb', 'elasticache']

export function MenuScreen() {
  const startGame = useGameStore((s) => s.startGame)
  const continueGame = useGameStore((s) => s.continueGame)
  const openSelect = useGameStore((s) => s.openSelect)
  const bestStars = useGameStore((s) => s.bestStars)
  const openSandbox = useGameStore((s) => s.openSandbox)
  const tutorialDone = useGameStore((s) => s.tutorialDone)
  const hasProgress = useGameStore(
    (s) => s.nodes.some((n) => n.type === 'service') || s.edges.length > 0,
  )
  const totalStars = SCENARIOS.reduce((sum, s) => sum + (bestStars[s.id] ?? 0), 0)

  return (
    <div className="flex h-screen w-screen flex-col items-center justify-center overflow-hidden bg-slate-950 text-slate-100">
      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="flex flex-col items-center px-6 text-center"
      >
        <div className="text-6xl">☁️</div>
        <h1 className="mt-3 bg-gradient-to-r from-cyan-400 via-sky-400 to-indigo-400 bg-clip-text text-6xl font-black tracking-tight text-transparent">
          SimCloud
        </h1>
        <p className="mt-2 text-sm text-slate-400">Build the architecture. Survive the traffic.</p>

        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.35, duration: 0.6 }}
          className="mt-8 flex items-center gap-3"
        >
          {STRIP.map((id, i) => (
            <motion.img
              key={id}
              src={ICONS[id]}
              alt=""
              draggable={false}
              className="h-9 w-9 rounded-md opacity-80"
              initial={{ opacity: 0, scale: 0.6 }}
              animate={{ opacity: 0.85, scale: 1 }}
              transition={{ delay: 0.35 + i * 0.05, type: 'spring', stiffness: 260, damping: 18 }}
            />
          ))}
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.6 }}
          className="mt-10 flex w-72 flex-col gap-3"
        >
          {hasProgress && (
            <button
              onClick={continueGame}
              className="rounded-xl border border-emerald-500/50 bg-emerald-500/10 px-6 py-3 text-sm font-bold text-emerald-300 transition hover:bg-emerald-500/20"
            >
              ▶ Continue building
            </button>
          )}
          <button
            onClick={() => startGame(true)}
            className="rounded-xl bg-gradient-to-r from-cyan-500 to-indigo-500 px-6 py-3 text-sm font-bold text-white shadow-lg shadow-cyan-500/25 transition hover:brightness-110 active:scale-[0.98]"
          >
            🎓 Learn to play{' '}
            <span className="font-normal opacity-75">{tutorialDone ? '· done ✓' : '· 2-min tutorial'}</span>
          </button>
          <button
            onClick={openSelect}
            className="rounded-xl border border-slate-600 px-6 py-3 text-sm font-semibold text-slate-300 transition hover:border-slate-400 hover:text-white"
          >
            🗺️ Choose a scenario
          </button>
          <button
            onClick={openSandbox}
            className="rounded-xl border border-slate-700 px-6 py-3 text-[13px] font-semibold text-slate-400 transition hover:border-cyan-500/60 hover:text-cyan-300"
          >
            🧪 Sandbox <span className="font-normal opacity-70">· free build, no scoring</span>
          </button>
        </motion.div>

        {totalStars > 0 && (
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.8 }}
            className="mt-6 text-xs font-semibold text-amber-400"
          >
            ★ {totalStars}/{SCENARIOS.length * 3} collected
          </motion.p>
        )}
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.9 }}
          className="mt-4 text-[10px] text-slate-600"
        >
          {SCENARIOS.length} levels · official AWS Architecture Icons · costs simplified for gameplay
        </motion.p>
      </motion.div>
    </div>
  )
}
