import { useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { TRACKS, scenariosInTrack, type Scenario } from '../game/scenarios'
import { encodeShareCode, parseScenarioFile } from '../game/customScenarios'
import { useGameStore } from '../store'
import { ACHIEVEMENTS } from '../game/achievements'
import { AchievementGallery } from './AchievementGallery'

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

function Stars({ earned }: { earned: number }) {
  return (
    <span className="text-[11px] tracking-tight">
      {[1, 2, 3].map((i) => (
        <span key={i} className={i <= earned ? 'text-amber-400' : 'text-slate-700'}>
          ★
        </span>
      ))}
    </span>
  )
}

const cardCls = (isCurrent: boolean) =>
  `group rounded-xl border p-3 text-left transition hover:-translate-y-0.5 hover:border-cyan-500/60 hover:bg-cyan-500/5 ${
    isCurrent ? 'border-cyan-500/50 bg-cyan-500/10' : 'border-slate-700/70 bg-slate-900/60'
  }`

function CardBody({ sc, earned, isCurrent }: { sc: Scenario; earned: number; isCurrent: boolean }) {
  return (
    <>
      <div className="flex items-start justify-between">
        <span className="text-2xl">{sc.emoji}</span>
        <Stars earned={earned} />
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
    </>
  )
}

/** A custom-track card: playable like the others, plus share/edit/delete actions. */
function CustomCard({ sc, earned, isCurrent }: { sc: Scenario; earned: number; isCurrent: boolean }) {
  const playScenario = useGameStore((s) => s.playScenario)
  const openEditor = useGameStore((s) => s.openEditor)
  const deleteCustomScenario = useGameStore((s) => s.deleteCustomScenario)
  const [copied, setCopied] = useState(false)

  const act = (e: React.MouseEvent, fn: () => void) => {
    e.stopPropagation()
    fn()
  }

  return (
    <div role="button" tabIndex={0} onClick={() => playScenario(sc.id)}
      onKeyDown={(e) => e.key === 'Enter' && playScenario(sc.id)}
      className={`cursor-pointer ${cardCls(isCurrent)}`}
    >
      <CardBody sc={sc} earned={earned} isCurrent={isCurrent} />
      <div className="mt-2 flex gap-1 border-t border-slate-800 pt-2">
        <button
          onClick={(e) =>
            act(e, () => {
              void navigator.clipboard?.writeText(encodeShareCode(sc))
              setCopied(true)
              setTimeout(() => setCopied(false), 1500)
            })
          }
          title="Copy share code"
          className="flex-1 rounded-md bg-slate-800/70 px-1.5 py-1 text-[10px] text-slate-300 transition hover:bg-slate-700"
        >
          {copied ? '✓ copied' : '📋 share'}
        </button>
        <button
          onClick={(e) => act(e, () => openEditor(sc.id))}
          title="Edit scenario"
          className="flex-1 rounded-md bg-slate-800/70 px-1.5 py-1 text-[10px] text-slate-300 transition hover:bg-slate-700"
        >
          ✏️ edit
        </button>
        <button
          onClick={(e) =>
            act(e, () => {
              if (window.confirm(`Delete "${sc.title}"? This can't be undone.`)) {
                deleteCustomScenario(sc.id)
              }
            })
          }
          title="Delete scenario"
          className="rounded-md bg-slate-800/70 px-2 py-1 text-[10px] text-red-300/80 transition hover:bg-red-500/20 hover:text-red-300"
        >
          ✕
        </button>
      </div>
    </div>
  )
}

/** Backup/restore for the custom track: download all scenarios as one JSON
 *  file, or merge a file back in (existing ids are skipped). */
function ExportImport() {
  const customScenarios = useGameStore((s) => s.customScenarios)
  const importCustomScenarios = useGameStore((s) => s.importCustomScenarios)
  const fileRef = useRef<HTMLInputElement>(null)
  const [msg, setMsg] = useState('')

  const flash = (text: string) => {
    setMsg(text)
    setTimeout(() => setMsg(''), 4000)
  }

  const exportAll = () => {
    const blob = new Blob([JSON.stringify(customScenarios, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'simcloud-scenarios.json'
    a.click()
    URL.revokeObjectURL(url)
  }

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    const list = parseScenarioFile(await file.text())
    if (!list || list.length === 0) {
      flash('✗ not a valid scenario file')
      return
    }
    const { added, skipped } = importCustomScenarios(list)
    flash(`✓ imported ${added}${skipped > 0 ? `, skipped ${skipped} already here` : ''}`)
  }

  const btnCls =
    'rounded-md border border-slate-700 px-2 py-0.5 text-[10px] text-slate-400 transition hover:border-slate-500 hover:text-slate-200'

  return (
    <span className="ml-auto flex items-center gap-1.5">
      {msg && <span className="text-[10px] text-cyan-300">{msg}</span>}
      {customScenarios.length > 0 && (
        <button onClick={exportAll} title="Download all custom scenarios as a JSON file" className={btnCls}>
          ⬇ export
        </button>
      )}
      <button onClick={() => fileRef.current?.click()} title="Merge scenarios from an exported JSON file" className={btnCls}>
        ⬆ import
      </button>
      <input ref={fileRef} type="file" accept=".json,application/json" onChange={onFile} className="hidden" />
    </span>
  )
}

export function ScenarioSelect() {
  const playScenario = useGameStore((s) => s.playScenario)
  const returnToMenu = useGameStore((s) => s.returnToMenu)
  const openEditor = useGameStore((s) => s.openEditor)
  const openSandbox = useGameStore((s) => s.openSandbox)
  const bestStars = useGameStore((s) => s.bestStars)
  const currentId = useGameStore((s) => s.scenarioId)
  // Re-render the custom section when authored scenarios change.
  const customCount = useGameStore((s) => s.customScenarios.length)
  const earned = useGameStore((s) => s.achievements.length)
  const [galleryOpen, setGalleryOpen] = useState(false)

  return (
    <div className="h-screen w-screen overflow-y-auto bg-slate-950 text-slate-100">
      <AchievementGallery open={galleryOpen} onClose={() => setGalleryOpen(false)} />
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
          <div className="flex gap-2">
            <button
              onClick={() => setGalleryOpen(true)}
              className="rounded-lg border border-slate-700 px-3 py-1.5 text-[12px] text-slate-400 transition hover:border-amber-500/60 hover:text-amber-300"
            >
              🏆 {earned} / {ACHIEVEMENTS.length}
            </button>
            <button
              onClick={openSandbox}
              className="rounded-lg border border-slate-700 px-3 py-1.5 text-[12px] text-slate-400 transition hover:border-cyan-500/60 hover:text-cyan-300"
            >
              🧪 Sandbox
            </button>
            <button
              onClick={returnToMenu}
              className="rounded-lg border border-slate-700 px-3 py-1.5 text-[12px] text-slate-400 transition hover:border-slate-500 hover:text-slate-200"
            >
              ⌂ Menu
            </button>
          </div>
        </div>

        <div className="space-y-8 pb-10">
          {TRACKS.map((track, ti) => (
            <motion.section
              key={`${track.id}-${track.id === 'custom' ? customCount : 0}`}
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: ti * 0.08 }}
            >
              <div className="mb-2 flex items-baseline gap-2">
                {/* The name is the anchor for the whole section — it must never
                    wrap mid-word. Only the description gives ground. */}
                <h2 className="shrink-0 whitespace-nowrap text-sm font-bold text-slate-200">
                  {track.emoji} {track.name}
                </h2>
                <span className="text-[11px] text-slate-500">{track.description}</span>
                {track.id === 'custom' && <ExportImport />}
              </div>
              <div className="grid grid-cols-2 gap-2.5 md:grid-cols-3">
                {scenariosInTrack(track.id).map((sc) => {
                  const earned = bestStars[sc.id] ?? 0
                  const isCurrent = sc.id === currentId
                  return track.id === 'custom' ? (
                    <CustomCard key={sc.id} sc={sc} earned={earned} isCurrent={isCurrent} />
                  ) : (
                    <button key={sc.id} onClick={() => playScenario(sc.id)} className={cardCls(isCurrent)}>
                      <CardBody sc={sc} earned={earned} isCurrent={isCurrent} />
                    </button>
                  )
                })}
                {track.id === 'custom' && (
                  <button
                    onClick={() => openEditor(null)}
                    className="flex min-h-[120px] flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-slate-700 bg-slate-900/30 p-3 text-slate-500 transition hover:-translate-y-0.5 hover:border-cyan-500/60 hover:text-cyan-300"
                  >
                    <span className="text-2xl">＋</span>
                    <span className="text-[12px] font-semibold">New scenario</span>
                    <span className="text-[9px]">build one, or paste a share code</span>
                  </button>
                )}
              </div>
            </motion.section>
          ))}
        </div>
      </div>
    </div>
  )
}
