// The guided tutorial: a linear list of steps. Steps with a `done` predicate
// auto-advance when the player actually performs the action; steps without
// one show a Next button. The coach card renders these above everything.

import type { Node, Edge } from '@xyflow/react'
import type { GamePhase, RunResults } from '../store'

export interface TutorialSnapshot {
  nodes: Node[]
  edges: Edge[]
  phase: GamePhase
  results: RunResults | null
}

export type TutorialHighlight = 'brief' | 'simulate' | `palette-${string}`

export interface TutorialStep {
  id: string
  title: string
  body: string
  highlight?: TutorialHighlight
  done?: (s: TutorialSnapshot) => boolean
}

const serviceIdOf = (nodes: Node[], id: string): string | null => {
  const n = nodes.find((n) => n.id === id)
  if (!n) return null
  if (n.type === 'users') return 'users'
  return (n.data as { serviceId?: string }).serviceId ?? null
}

const hasService = (s: TutorialSnapshot, serviceId: string) =>
  s.nodes.some((n) => n.type === 'service' && (n.data as { serviceId?: string }).serviceId === serviceId)

const hasEdge = (s: TutorialSnapshot, from: string, to: string) =>
  s.edges.some(
    (e) => serviceIdOf(s.nodes, e.source) === from && serviceIdOf(s.nodes, e.target) === to,
  )

export const TUTORIAL_STEPS: TutorialStep[] = [
  {
    id: 'welcome',
    title: 'Welcome, architect! ☁️',
    body: 'In Cloudopolis you design AWS architectures that survive real traffic. Each level is a scenario with a budget — build it, stress-test it, earn three stars.',
  },
  {
    id: 'brief',
    title: 'Read the brief',
    highlight: 'brief',
    body: 'The mission card (left) sums up the contract: chips for traffic (100 → 2,000 rps) and budget ($30/mo), plus any special events. Tap \u201cRead the full briefing\u201d anytime for the story and win conditions.',
  },
  {
    id: 'add-s3',
    title: 'Add storage',
    highlight: 'palette-s3',
    body: 'A static site is just files, and files live in S3. Click S3 in the Services palette to add it to the canvas.',
    done: (s) => hasService(s, 's3'),
  },
  {
    id: 'connect',
    title: 'Wire it up',
    body: "Traffic starts at Users. Drag from the cyan dot on Users' right edge to the dot on S3's left edge to connect them.",
    done: (s) => hasEdge(s, 'users', 's3'),
  },
  {
    id: 'simulate',
    title: 'Ship it',
    highlight: 'simulate',
    body: 'Press ▶ Simulate. Every moving dot is a request from a real user.',
    done: (s) => s.phase !== 'edit',
  },
  {
    id: 'watch',
    title: 'Brace for the spike',
    body: 'Baseline looks fine… now watch what 2,000 rps does to that lonely bucket. (The security probe is watching you, too.)',
    done: (s) => s.phase === 'results',
  },
  {
    id: 'diagnose',
    title: 'Read the damage',
    body: "S3 choked at twice its capacity, and the probe flagged your public bucket. One fix solves both: a CDN. Click 'Refine design' to get back to the canvas.",
    done: (s) => s.phase === 'edit',
  },
  {
    id: 'add-cloudfront',
    title: 'Add CloudFront',
    highlight: 'palette-cloudfront',
    body: 'CloudFront caches your site at the edge — it serves ~80% of traffic before it ever touches S3, and it keeps your bucket off the public internet.',
    done: (s) => hasService(s, 'cloudfront'),
  },
  {
    id: 'rewire',
    title: 'Re-route',
    body: 'Wire Users → CloudFront → S3. Then remove the old shortcut: click the Users → S3 edge and press ⌫ (Backspace).',
    done: (s) => hasEdge(s, 'users', 'cloudfront') && hasEdge(s, 'cloudfront', 's3') && !hasEdge(s, 'users', 's3'),
  },
  {
    id: 'rerun',
    title: 'Moment of truth',
    highlight: 'simulate',
    body: 'Run it again.',
    done: (s) => s.phase === 'results',
  },
  {
    id: 'done',
    title: "That's the game 🏆",
    body: 'Build → simulate → read the Architect’s Notes → refine. Now explore the tracks: finish Foundations, then take on Scaling Up, Event-Driven, and GenAI — and when you are ready to be on call, Day 2. Good luck, architect!',
  },
]
