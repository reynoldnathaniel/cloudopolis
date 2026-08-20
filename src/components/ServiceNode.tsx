import { memo } from 'react'
import { Handle, Position, type NodeProps, type Node } from '@xyflow/react'
import { SERVICES, CATEGORY_COLORS } from '../game/services'
import { ICONS } from '../game/icons'
import { useGameStore, type AzId, type RegionId } from '../store'

export type ServiceNodeType = Node<{ serviceId: string; az?: AzId; region?: RegionId }, 'service'>

function ServiceNodeInner({ id, data, selected }: NodeProps<ServiceNodeType>) {
  const def = SERVICES[data.serviceId]
  const stats = useGameStore((s) => s.nodeStats[id])
  const running = useGameStore((s) => s.phase !== 'edit')
  const isDead = useGameStore((s) => s.deadNodeIds.includes(id))
  const isBreached = useGameStore((s) => s.breachedNodeIds.includes(id))
  const hasVpc = useGameStore((s) => s.scenario().hasVpc === true)
  const multiRegion = useGameStore((s) => s.scenario().multiRegion === true)
  const color = CATEGORY_COLORS[def.category]
  const icon = ICONS[def.id]

  // Elastic fleets (ASG instances, Fargate tasks) render as unit tiles.
  const fleet = def.scaling
  const isAsg = fleet !== undefined
  const instances = stats?.instances ?? fleet?.min ?? 2
  const unplaced = multiRegion ? def.global !== true && !data.region : hasVpc && def.zonal && !data.az
  const util = stats?.util ?? 0
  const overloaded = !isDead && util > 1
  const utilPct = Math.min(100, Math.round(util * 100))
  const barColor = overloaded ? '#f87171' : util > 0.7 ? '#fbbf24' : '#34d399'
  const hasSource = def.role !== 'db' && def.role !== 'origin-static'

  const border = selected
    ? 'border-cyan-400 shadow-cyan-500/20'
    : isDead
      ? 'border-red-600'
      : isBreached
        ? 'border-red-500'
        : unplaced
          ? 'border-amber-500 border-dashed'
          : 'border-slate-700'

  return (
    <div
      title={def.blurb}
      className={`w-[150px] rounded-xl border bg-slate-900/90 shadow-lg transition-all ${border} ${
        overloaded ? 'animate-pulse border-red-500 shadow-red-500/30' : ''
      } ${isDead ? 'opacity-40 grayscale' : ''}`}
    >
      <Handle
        type="target"
        position={Position.Left}
        className="!h-3 !w-3 !border-2 !border-slate-900 !bg-cyan-400"
      />
      {hasSource && (
        <Handle
          type="source"
          position={Position.Right}
          className="!h-3 !w-3 !border-2 !border-slate-900 !bg-cyan-400"
        />
      )}

      {isDead && (
        <div className="absolute -right-2 -top-2 z-10 rounded-full bg-red-600 px-1.5 py-0.5 text-[10px] font-bold text-white shadow">
          💀
        </div>
      )}
      {!isDead && isBreached && (
        <div className="absolute -right-2 -top-2 z-10 animate-pulse rounded-full bg-red-600 px-1.5 py-0.5 text-[8px] font-bold text-white shadow">
          🔓 EXPOSED
        </div>
      )}
      {!isDead && !isBreached && unplaced && (
        <div className="absolute -right-2 -top-2 z-10 rounded-full bg-amber-500 px-1.5 py-0.5 text-[8px] font-bold text-slate-950 shadow">
          ⚠ needs {multiRegion ? 'Region' : 'AZ'}
        </div>
      )}

      <div className="flex items-center gap-2.5 p-2.5">
        {icon ? (
          <img src={icon} alt={def.name} className="h-10 w-10 shrink-0 rounded-lg" draggable={false} />
        ) : (
          <div
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-sm font-bold text-white"
            style={{ background: `linear-gradient(135deg, ${color}, ${color}99)` }}
          >
            {def.abbr}
          </div>
        )}
        <div className="min-w-0">
          <div className="truncate text-[13px] font-semibold text-slate-100">
            {def.name}
            {isAsg && running && <span className="ml-1 text-[11px] text-amber-300">×{instances}</span>}
          </div>
          <div className="text-[10px] text-slate-400">
            {fleet
              ? `${fleet.min}–${fleet.max} ${fleet.unitLabel} · $${fleet.costPerUnit}/ea`
              : `${def.autoScales ? '∞ auto-scales' : `${def.capacity} RPS`} · ${
                  def.monthlyCost > 0 ? `$${def.monthlyCost}/mo` : def.costPerRps > 0 ? 'pay/use' : 'free'
                }`}
          </div>
        </div>
      </div>

      {isAsg && (
        <div className="flex flex-wrap gap-1 px-2.5 pb-1.5">
          {Array.from({ length: running ? instances : (fleet?.min ?? 2) }).map((_, i) => (
            <span
              key={i}
              className="h-2.5 w-2.5 rounded-[3px] transition-all duration-300"
              style={{ background: overloaded ? '#f87171' : '#ED7100' }}
            />
          ))}
        </div>
      )}

      {running && stats && !isDead && def.role === 'queue' && (
        <div className="px-2.5 pb-2">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
            <div
              className="h-full rounded-full transition-all duration-200"
              style={{
                width: `${Math.min(100, ((stats.backlog ?? 0) / 20000) * 100)}%`,
                background: (stats.backlog ?? 0) > 50000 ? '#f87171' : '#818cf8',
              }}
            />
          </div>
          <div className="mt-0.5 flex justify-between text-[9px] text-slate-500">
            <span>{Math.round(stats.inRps)} in / {Math.round(stats.processed)} out</span>
            <span className={(stats.backlog ?? 0) > 0 ? 'font-bold text-indigo-300' : ''}>
              {(stats.backlog ?? 0) > 0 ? `📥 ${Math.round(stats.backlog ?? 0).toLocaleString()}` : 'empty'}
            </span>
          </div>
        </div>
      )}
      {running && stats && !isDead && def.role !== 'queue' && (
        <div className="px-2.5 pb-2">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
            <div
              className="h-full rounded-full transition-all duration-200"
              style={{
                width: `${
                  isAsg ? utilPct : def.autoScales ? Math.min(utilPct, 12) || (util > 0 ? 8 : 0) : utilPct
                }%`,
                background: barColor,
              }}
            />
          </div>
          <div className="mt-0.5 flex justify-between text-[9px] text-slate-500">
            <span>{Math.round(stats.inRps)} rps in</span>
            <span className={overloaded ? 'font-bold text-red-400' : ''}>
              {overloaded ? (isAsg ? 'SCALING UP…' : 'OVERLOAD') : isAsg ? `${utilPct}%` : def.autoScales ? 'scaling' : `${utilPct}%`}
            </span>
          </div>
        </div>
      )}
      {running && isDead && (
        <div className="px-2.5 pb-2 text-center text-[9px] font-bold uppercase tracking-widest text-red-400">
          {multiRegion ? 'region down' : 'zone down'}
        </div>
      )}
    </div>
  )
}

export const ServiceNode = memo(ServiceNodeInner)

export type UsersNodeType = Node<Record<string, never>, 'users'>

function UsersNodeInner({ selected }: NodeProps<UsersNodeType>) {
  const rps = useGameStore((s) => s.currentRps)
  const running = useGameStore((s) => s.phase !== 'edit')
  const spike = useGameStore((s) => s.runPhase === 'spike' && s.phase === 'run')

  return (
    <div
      className={`rounded-2xl border-2 bg-slate-900/95 px-4 py-3 text-center shadow-lg ${
        selected ? 'border-cyan-400' : spike ? 'animate-pulse border-red-400' : 'border-slate-600'
      }`}
    >
      <img src={ICONS.users} alt="Users" className="mx-auto h-8 w-8" draggable={false} />
      <div className="mt-1 text-[13px] font-semibold text-slate-100">Users</div>
      <div className="text-[10px] text-slate-400">{running ? `${rps} req/s` : 'the internet'}</div>
      <Handle
        type="source"
        position={Position.Right}
        className="!h-3 !w-3 !border-2 !border-slate-900 !bg-cyan-400"
      />
    </div>
  )
}

export const UsersNode = memo(UsersNodeInner)
