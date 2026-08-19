import { memo } from 'react'
import { BaseEdge, getBezierPath, type EdgeProps } from '@xyflow/react'
import { useGameStore } from '../store'

function TrafficEdgeInner({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  target,
  selected,
}: EdgeProps) {
  const flow = useGameStore((s) => s.edgeFlows[id] ?? 0)
  const targetUtil = useGameStore((s) => s.nodeStats[target]?.util ?? 0)
  const running = useGameStore((s) => s.phase === 'run')
  const probing = useGameStore((s) => s.phase === 'run' && s.runPhase === 'probe')
  const targetBreached = useGameStore((s) => s.breachedNodeIds.includes(target))

  const [path] = getBezierPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition })

  const active = running && flow > 0
  const overloaded = targetUtil > 1
  const breachEdge = probing && targetBreached
  const dotCount = active ? Math.max(1, Math.min(7, Math.round(flow / 120))) : 0
  const dotColor = breachEdge ? '#ef4444' : overloaded ? '#f87171' : '#34d399'
  const dur = overloaded ? 2.2 : 1.4

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        style={{
          stroke: breachEdge
            ? '#ef4444'
            : selected
              ? '#22d3ee'
              : active
                ? overloaded
                  ? '#b91c1c'
                  : '#10b98188'
                : '#475569',
          strokeWidth: active ? 2.5 : 1.5,
          strokeDasharray: breachEdge ? '6 4' : undefined,
        }}
      />
      {Array.from({ length: dotCount }).map((_, i) => (
        <circle key={`${id}-dot-${i}`} r={3.5} fill={dotColor} opacity={0.9}>
          <animateMotion
            dur={`${dur}s`}
            begin={`${(i * dur) / dotCount}s`}
            repeatCount="indefinite"
            path={path}
          />
        </circle>
      ))}
    </>
  )
}

export const TrafficEdge = memo(TrafficEdgeInner)
