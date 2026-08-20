// The guided sandbox tour. Same shape as the scenario tutorial (steps with a
// `done` predicate auto-advance when the player performs the action), but the
// snapshot carries the sandbox's own controls, because what this tour teaches
// is the panel — the traffic dial, the workload toggle, chaos on demand — not
// how to use the canvas, which the first-scenario tutorial already covers.

import type { Node, Edge } from '@xyflow/react'
import type { AzId, GamePhase } from '../store'

export interface SandboxSnapshot {
  nodes: Node[]
  edges: Edge[]
  phase: GamePhase
  rps: number
  need: 'static' | 'app'
  deadAzs: AzId[]
  /** How many times the player has fired the security probe this session */
  probeCount: number
}

export type SandboxHighlight =
  | 'traffic'
  | 'workload'
  | 'chaos'
  | 'probe'
  | 'run'
  | `palette-${string}`

export interface SandboxTutorialStep {
  id: string
  title: string
  body: string
  highlight?: SandboxHighlight
  done?: (s: SandboxSnapshot) => boolean
}

const serviceIdOf = (nodes: Node[], id: string): string | null => {
  const n = nodes.find((n) => n.id === id)
  if (!n) return null
  if (n.type === 'users') return 'users'
  return (n.data as { serviceId?: string }).serviceId ?? null
}

const countService = (s: SandboxSnapshot, serviceId: string): number =>
  s.nodes.filter(
    (n) => n.type === 'service' && (n.data as { serviceId?: string }).serviceId === serviceId,
  ).length

const edgesFromTo = (s: SandboxSnapshot, from: string, to: string): number =>
  s.edges.filter(
    (e) => serviceIdOf(s.nodes, e.source) === from && serviceIdOf(s.nodes, e.target) === to,
  ).length

export const SANDBOX_TUTORIAL_STEPS: SandboxTutorialStep[] = [
  {
    id: 'welcome',
    title: 'Welcome to the sandbox 🧪',
    body: "No budget, no stars, no script. The run never ends and you drive it — traffic, failures, and all. Let's build something and break it on purpose.",
  },
  {
    id: 'add-alb',
    title: 'Start with a front door',
    highlight: 'palette-alb',
    body: 'Click the Load Balancer in the palette. An ALB spreads traffic across whatever sits behind it — and it reroutes around anything that dies.',
    done: (s) => countService(s, 'alb') >= 1,
  },
  {
    id: 'add-ec2',
    title: 'Add two servers',
    highlight: 'palette-ec2',
    body: 'Click EC2 twice. Zonal services drop into an Availability Zone automatically — watch one land in each, which is what makes the next part interesting.',
    done: (s) => countService(s, 'ec2') >= 2,
  },
  {
    id: 'wire',
    title: 'Wire it up',
    body: 'Drag from Users to the ALB, then from the ALB to each EC2. Remember: traffic only goes where you draw an edge.',
    done: (s) => edgesFromTo(s, 'users', 'alb') >= 1 && edgesFromTo(s, 'alb', 'ec2') >= 2,
  },
  {
    id: 'workload',
    title: 'Pick a workload type',
    highlight: 'workload',
    body: "⚙️ App means every request must reach a database or model — and this design has none, so it would serve 0%. Switch to 📄 Static so plain files count as served.",
    done: (s) => s.need === 'static',
  },
  {
    id: 'run',
    title: 'Start the simulation',
    highlight: 'run',
    body: 'Press ▶ Run. Unlike a scenario, this has no phases and no ending — it just keeps going until you stop it, so you can talk over it.',
    done: (s) => s.phase === 'run',
  },
  {
    id: 'traffic-up',
    title: 'Turn up the traffic',
    highlight: 'traffic',
    body: 'This is the dial that makes the sandbox useful. Tap the 2k preset. Two EC2 instances handle ~150 rps each — watch what 2,000 does to them.',
    done: (s) => s.rps >= 2000,
  },
  {
    id: 'traffic-down',
    title: 'And back down',
    highlight: 'traffic',
    body: 'Overloaded, and the amber hint line tells you exactly why. Tap 500 — recovery is instant, no restart. Every control here applies to the very next tick.',
    done: (s) => s.rps <= 500,
  },
  {
    id: 'kill-az',
    title: 'Now break a zone 💥',
    highlight: 'chaos',
    body: 'Hit “kill AZ-A”. Its EC2 goes dark and the ALB sends everything to the survivor — real failover, on your command instead of a script’s.',
    done: (s) => s.deadAzs.length > 0,
  },
  {
    id: 'probe',
    title: 'Audit the design 🕵️',
    highlight: 'probe',
    body: 'Run the security probe. It flags anything wired straight to Users that has no business on the internet — your ALB is fine there, an S3 bucket or a database would not be.',
    done: (s) => s.probeCount > 0,
  },
  {
    id: 'done',
    title: "That's the sandbox 🎉",
    body: 'Revive the zone whenever you like, stop the run to edit the canvas, and build whatever you want — your sketch is saved automatically. Try it with a cache, a queue, or Bedrock behind the load balancer.',
  },
]
