import { PALETTE_GROUPS, CATEGORY_COLORS } from '../game/services'
import { ICONS } from '../game/icons'
import { useGameStore } from '../store'
import { useTutorialHighlight } from './TutorialCoach'

export function Palette() {
  const addServiceNode = useGameStore((s) => s.addServiceNode)
  const editing = useGameStore((s) => s.phase === 'edit')
  const scenario = useGameStore((s) => s.scenario())
  const highlight = useTutorialHighlight()

  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between">
        <h2 className="text-xs font-bold uppercase tracking-wider text-slate-400">Services</h2>
        <span className="text-[10px] text-slate-500">drag or click to add</span>
      </div>
      <div className="space-y-3">
        {PALETTE_GROUPS.map((group) => (
          <div key={group.label}>
            <div className="mb-1 text-[9px] font-bold uppercase tracking-widest text-slate-600">
              {group.label}
            </div>
            <div className="grid grid-cols-2 gap-2">
              {group.items.map((def) => {
                const color = CATEGORY_COLORS[def.category]
                const icon = ICONS[def.id]
                const banned = scenario.banned?.includes(def.id) === true
                const required = scenario.requiredServices?.includes(def.id) === true
                const disabled = !editing || banned
                const tooltip = banned
                  ? `🔒 ${scenario.bannedReason ?? 'Not allowed in this scenario.'}`
                  : `${def.fullName}\n${def.blurb}`
                return (
                  <button
                    key={def.id}
                    draggable={!disabled}
                    disabled={disabled}
                    title={tooltip}
                    onDragStart={(e) => {
                      e.dataTransfer.setData('application/simcloud', def.id)
                      e.dataTransfer.effectAllowed = 'move'
                    }}
                    onClick={() =>
                      addServiceNode(def.id, {
                        x: 320 + Math.random() * 260,
                        y: 120 + Math.random() * 320,
                      })
                    }
                    className={`group relative flex items-center gap-2 rounded-lg border p-2 text-left transition hover:border-slate-500 hover:bg-slate-800 ${
                      highlight === `palette-${def.id}`
                        ? 'animate-pulse border-cyan-400 bg-cyan-500/10 ring-2 ring-cyan-400/50'
                        : required
                          ? 'border-indigo-500/50 bg-indigo-500/5'
                          : 'border-slate-700/70 bg-slate-800/60'
                    } ${
                      banned
                        ? 'cursor-not-allowed opacity-30'
                        : 'cursor-grab active:cursor-grabbing disabled:cursor-not-allowed disabled:opacity-40'
                    }`}
                  >
                    {icon ? (
                      <span className="relative h-8 w-8 shrink-0">
                        <img src={icon} alt={def.name} className="h-8 w-8 rounded-md" draggable={false} />
                        {banned && <span className="absolute -right-1 -top-1 text-[10px]">🔒</span>}
                      </span>
                    ) : (
                      <div
                        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-[11px] font-bold text-white"
                        style={{ background: `linear-gradient(135deg, ${color}, ${color}99)` }}
                      >
                        {def.abbr}
                      </div>
                    )}
                    <div className="min-w-0">
                      <div className="truncate text-[12px] font-semibold text-slate-200">
                        {def.name}
                        {required && <span className="ml-1 text-[9px] text-indigo-400">req</span>}
                      </div>
                      <div className="text-[9px] text-slate-500">
                        {def.scaling
                          ? `${def.scaling.min}–${def.scaling.max} × $${def.scaling.costPerUnit} · scales`
                          : `${
                              def.monthlyCost > 0
                                ? `$${def.monthlyCost}/mo`
                                : def.costPerRps > 0
                                  ? 'pay per use'
                                  : '$0'
                            } · ${def.autoScales ? '∞' : `${def.capacity} rps`}${def.zonal ? ' · zonal' : ''}`}
                      </div>
                    </div>
                  </button>
                )
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
