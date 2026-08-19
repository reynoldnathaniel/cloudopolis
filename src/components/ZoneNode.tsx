import { memo } from 'react'
import type { NodeProps, Node } from '@xyflow/react'
import { useGameStore, type AzId } from '../store'

export type VpcNodeType = Node<{ w: number; h: number }, 'vpc'>
export type AzNodeType = Node<{ az: AzId; w: number; h: number }, 'az'>

function VpcNodeInner({ data }: NodeProps<VpcNodeType>) {
  return (
    <div
      style={{ width: data.w, height: data.h }}
      className="pointer-events-none rounded-2xl border-2 border-dashed border-violet-500/40 bg-violet-500/[0.03]"
    >
      <div className="absolute -top-3 left-4 rounded-md border border-violet-500/40 bg-slate-950 px-2 py-0.5 text-[10px] font-bold tracking-wide text-violet-300">
        ☁️ VPC · us-east-1
      </div>
    </div>
  )
}

export const VpcNode = memo(VpcNodeInner)

function AzNodeInner({ data }: NodeProps<AzNodeType>) {
  const struckAz = useGameStore((s) => s.struckAz)
  const runPhase = useGameStore((s) => s.runPhase)
  const phase = useGameStore((s) => s.phase)

  const isDown = phase === 'run' && runPhase === 'outage' && struckAz === data.az

  return (
    <div
      style={{ width: data.w, height: data.h }}
      className={`pointer-events-none rounded-xl border border-dashed transition-colors duration-300 ${
        isDown
          ? 'border-red-500/80 bg-red-500/10 animate-pulse'
          : 'border-sky-500/40 bg-sky-500/[0.03]'
      }`}
    >
      <div
        className={`absolute -top-2.5 left-3 rounded-md border bg-slate-950 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider ${
          isDown ? 'border-red-500/60 text-red-300' : 'border-sky-500/40 text-sky-300'
        }`}
      >
        {isDown ? '💥 ' : ''}Availability Zone {data.az.toUpperCase()}
      </div>
    </div>
  )
}

export const AzNode = memo(AzNodeInner)
