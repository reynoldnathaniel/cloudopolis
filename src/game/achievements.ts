// Achievements.
//
// The rule every one of these has to pass: it must be possible to MISS while
// still earning three stars, or else be a collection milestone. An achievement
// that fires on every three-star run is not an achievement, it is a second
// star rating printed in a different font — which is why there is no badge here
// for "passed the security probe" or "did not pay the ransom", tempting as they
// were. Both are already required to three-star the levels they belong to.
//
// Everything below is pure data and one pure function, so the whole rule set is
// testable without a store, a canvas, or a simulated run.

import { SCENARIOS, TRACKS, type Scenario } from './scenarios'
import { SOLUTIONS } from './solutions'

export interface Achievement {
  id: string
  emoji: string
  name: string
  /** Shown in the gallery whether or not it is unlocked — these are goals, not riddles. */
  description: string
}

/** Fraction of the budget you must leave unspent to earn Penny Pincher.
 *  Measured against every reference design: they run from 50% to 96% of budget,
 *  so this is reachable on a handful of levels and out of reach on the tight
 *  ones. A looser bar would fire on almost every three-star run. */
export const THRIFT_MARGIN = 0.4

/** Failed runs that turn a later three-star into a comeback. Same gate as the
 *  reference-answer reveal, so the level has demonstrably been beating you. */
export const REDEMPTION_FAILURES = 2

/** One badge per track, generated rather than hand-listed — a new track cannot
 *  quietly ship without one, and there is a test that says so. */
const trackAchievements = (): Achievement[] =>
  TRACKS.filter((t) => t.id !== 'custom').map((t) => ({
    id: `track:${t.id}`,
    emoji: t.emoji,
    name: t.name,
    description: `Three-star every scenario in the ${t.name} track.`,
  }))

export const ACHIEVEMENTS: Achievement[] = [
  {
    id: 'first-blood',
    emoji: '🚀',
    name: 'First Blood',
    description: 'Three-star any scenario.',
  },
  ...trackAchievements(),
  {
    id: 'well-architected',
    emoji: '👑',
    name: 'Well-Architected',
    description: 'Three-star every scenario in the game.',
  },
  {
    id: 'nailed-it',
    emoji: '🎯',
    name: 'Nailed It',
    description: 'Three-star a scenario on your first completed attempt at it.',
  },
  {
    id: 'redemption',
    emoji: '🔁',
    name: 'Redemption',
    description: 'Three-star a scenario that had already beaten you twice.',
  },
  {
    id: 'penny-pincher',
    emoji: '💰',
    name: 'Penny Pincher',
    description: `Three-star a scenario with at least ${Math.round(THRIFT_MARGIN * 100)}% of the budget left unspent.`,
  },
  {
    id: 'minimalist',
    emoji: '✂️',
    name: 'Minimalist',
    description: 'Three-star a scenario using no more services than the reference answer.',
  },
  {
    id: 'on-the-pager',
    emoji: '🚨',
    name: 'On The Pager',
    description: 'Clear a Day 2 scenario answering every incident yourself, before the clock ran out.',
  },
  {
    id: 'show-and-tell',
    emoji: '📸',
    name: 'Show & Tell',
    description: 'Export an architecture or a share card.',
  },
  {
    id: 'level-designer',
    emoji: '🛠️',
    name: 'Level Designer',
    description: 'Write and save a scenario of your own.',
  },
]

export const achievementById = (id: string): Achievement | undefined =>
  ACHIEVEMENTS.find((a) => a.id === id)

/** What a completed run looked like, as far as the badges care. */
export interface RunSummary {
  scenario: Scenario
  stars: number
  /** Everything the run was billed for, against `scenario.budget` */
  cost: number
  /** Services the player placed, excluding the Users node */
  nodeCount: number
  /** Failed runs on this scenario BEFORE this one — capture it before scoring updates it */
  priorFailures: number
  /** Best stars on this scenario BEFORE this one; 0 if never completed */
  priorBest: number
  /** true when the player had never completed this scenario before */
  firstAttempt: boolean
  /** Incidents this run raised, and how many expired into the runbook default */
  decisions: number
  decisionsAutoAnswered: number
}

/**
 * Every achievement the player has now earned, given their star record and
 * (optionally) the run that just finished.
 *
 * Milestones are recomputed from `bestStars` every time rather than latched, so
 * a player who already had a track finished before badges existed gets it on
 * their next load instead of having to replay anything.
 */
export function achievementsAfter(
  bestStars: Record<string, number>,
  run?: RunSummary,
): string[] {
  const earned: string[] = []
  const threeStarred = (id: string) => (bestStars[id] ?? 0) >= 3

  if (SCENARIOS.some((s) => threeStarred(s.id))) earned.push('first-blood')

  for (const track of TRACKS) {
    if (track.id === 'custom') continue
    const inTrack = SCENARIOS.filter((s) => s.track === track.id)
    if (inTrack.length > 0 && inTrack.every((s) => threeStarred(s.id))) {
      earned.push(`track:${track.id}`)
    }
  }

  if (SCENARIOS.every((s) => threeStarred(s.id))) earned.push('well-architected')

  // Per-run feats. All of these are optional: a three-star run can miss every
  // one of them, which is the whole point.
  if (run && run.stars === 3) {
    const { scenario } = run
    if (run.firstAttempt && run.priorFailures === 0) earned.push('nailed-it')
    if (run.priorFailures >= REDEMPTION_FAILURES) earned.push('redemption')
    if (run.cost <= scenario.budget * (1 - THRIFT_MARGIN)) earned.push('penny-pincher')

    const reference = SOLUTIONS[scenario.id]
    if (reference && run.nodeCount > 0 && run.nodeCount <= reference.nodes.length) {
      earned.push('minimalist')
    }
    // Answering an incident is a choice; letting the countdown answer it for you
    // is also a choice, and this badge is for the players who make the first one.
    if (run.decisions > 0 && run.decisionsAutoAnswered === 0) earned.push('on-the-pager')
  }

  return earned
}
