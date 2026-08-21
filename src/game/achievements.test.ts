// The badge rules, tested without a store or a canvas.
//
// The assertions that matter most are the negative ones. A badge that fires on
// every three-star run is not an achievement, so nearly every case here checks
// that something is NOT earned as well as that it is.

import { describe, it, expect } from 'vitest'
import {
  ACHIEVEMENTS,
  achievementsAfter,
  achievementById,
  THRIFT_MARGIN,
  REDEMPTION_FAILURES,
  type RunSummary,
} from './achievements'
import { SCENARIOS, TRACKS, getScenario } from './scenarios'
import { SOLUTIONS } from './solutions'

const allThreeStars = (): Record<string, number> =>
  Object.fromEntries(SCENARIOS.map((s) => [s.id, 3]))

const trackStars = (track: string): Record<string, number> =>
  Object.fromEntries(SCENARIOS.filter((s) => s.track === track).map((s) => [s.id, 3]))

/** A plain three-star run that earns no feats at all — the baseline to vary. */
const run = (over: Partial<RunSummary> = {}): RunSummary => {
  const scenario = getScenario('flash-sale')
  return {
    scenario,
    stars: 3,
    cost: scenario.budget, // right on budget: no thrift
    nodeCount: SOLUTIONS['flash-sale'].nodes.length + 3, // over-built: no minimalism
    priorFailures: 1, // beaten once: neither a first attempt nor a redemption
    priorBest: 2,
    firstAttempt: false,
    decisions: 0,
    decisionsAutoAnswered: 0,
    ...over,
  }
}

describe('the badge list itself', () => {
  it('has unique ids and no empty copy', () => {
    const ids = ACHIEVEMENTS.map((a) => a.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const a of ACHIEVEMENTS) {
      expect(a.name.length, a.id).toBeGreaterThan(2)
      expect(a.description.length, a.id).toBeGreaterThan(20)
      expect(a.emoji.length, a.id).toBeGreaterThan(0)
    }
  })

  it('carries one badge per track, generated rather than hand-listed', () => {
    // A new track must not be able to ship without its badge.
    for (const track of TRACKS) {
      if (track.id === 'custom') continue
      expect(achievementById(`track:${track.id}`), `no badge for the ${track.name} track`).toBeDefined()
    }
    const trackBadges = ACHIEVEMENTS.filter((a) => a.id.startsWith('track:'))
    expect(trackBadges).toHaveLength(TRACKS.length - 1)
  })

  it('is fully reachable — every badge is awarded by some path', () => {
    const byScoring = new Set([
      ...achievementsAfter(allThreeStars()),
      ...achievementsAfter(
        allThreeStars(),
        run({ firstAttempt: true, priorFailures: 0, priorBest: 0 }),
      ),
      ...achievementsAfter(allThreeStars(), run({ priorFailures: REDEMPTION_FAILURES })),
      ...achievementsAfter(allThreeStars(), run({ cost: 0 })),
      ...achievementsAfter(allThreeStars(), run({ nodeCount: 1 })),
      ...achievementsAfter(allThreeStars(), run({ decisions: 2, decisionsAutoAnswered: 0 })),
    ])
    // These two are awarded by doing something the scorer never sees.
    const byAction = new Set(['show-and-tell', 'level-designer'])
    for (const a of ACHIEVEMENTS) {
      expect(byScoring.has(a.id) || byAction.has(a.id), `${a.id} is unreachable`).toBe(true)
    }
  })
})

describe('milestones', () => {
  it('awards nothing at all to a fresh profile', () => {
    expect(achievementsAfter({})).toEqual([])
  })

  it('needs three stars, not merely a completed run', () => {
    expect(achievementsAfter({ 'static-site': 2 })).toEqual([])
    expect(achievementsAfter({ 'static-site': 3 })).toContain('first-blood')
  })

  it('awards a track badge only once every scenario in it is three-starred', () => {
    const foundations = SCENARIOS.filter((s) => s.track === 'foundations')
    const allButOne = Object.fromEntries(foundations.slice(1).map((s) => [s.id, 3]))
    expect(achievementsAfter(allButOne)).not.toContain('track:foundations')
    expect(achievementsAfter(trackStars('foundations'))).toContain('track:foundations')
  })

  it('awards the crown only for a complete sweep', () => {
    const all = allThreeStars()
    const oneShort = { ...all }
    delete oneShort[SCENARIOS[SCENARIOS.length - 1].id]
    expect(achievementsAfter(oneShort)).not.toContain('well-architected')
    expect(achievementsAfter(all)).toContain('well-architected')
  })

  it('is retroactive: milestones recompute from the star record, never latch', () => {
    // Someone who three-starred everything before badges existed gets the lot
    // on their next load, without replaying a single scenario.
    const earned = achievementsAfter(allThreeStars())
    expect(earned).toContain('first-blood')
    expect(earned).toContain('well-architected')
    for (const t of TRACKS) {
      if (t.id !== 'custom') expect(earned).toContain(`track:${t.id}`)
    }
  })
})

describe('per-run feats', () => {
  it('awards none of them for a run that earned fewer than three stars', () => {
    const great = run({ cost: 0, nodeCount: 1, firstAttempt: true, priorFailures: 0, stars: 2 })
    const earned = achievementsAfter({}, great)
    expect(earned).toEqual([])
  })

  it('leaves a plain three-star run with no feats — they must be missable', () => {
    expect(achievementsAfter({ 'flash-sale': 3 }, run())).toEqual(['first-blood'])
  })

  it('Nailed It wants a clean first completed attempt', () => {
    expect(achievementsAfter({}, run({ firstAttempt: true, priorFailures: 0 }))).toContain('nailed-it')
    // Replaying something you already beat is not a first attempt.
    expect(achievementsAfter({}, run({ firstAttempt: false, priorFailures: 0, priorBest: 3 }))).not.toContain('nailed-it')
  })

  it('Redemption and Nailed It are mutually exclusive by construction', () => {
    const comeback = achievementsAfter({}, run({ priorFailures: REDEMPTION_FAILURES }))
    expect(comeback).toContain('redemption')
    expect(comeback).not.toContain('nailed-it')
    expect(achievementsAfter({}, run({ priorFailures: REDEMPTION_FAILURES - 1 }))).not.toContain('redemption')
  })

  it('Penny Pincher wants real headroom, not a squeak under budget', () => {
    const budget = getScenario('flash-sale').budget
    expect(achievementsAfter({}, run({ cost: budget - 1 }))).not.toContain('penny-pincher')
    expect(achievementsAfter({}, run({ cost: Math.floor(budget * (1 - THRIFT_MARGIN)) }))).toContain('penny-pincher')
  })

  it('Penny Pincher is out of reach for most reference designs', () => {
    // Measured: reference answers run from 50% to 96% of budget. If this bar
    // were loose enough to catch most of them it would fire on nearly every
    // three-star run and stop meaning anything.
    const reachable = SCENARIOS.filter((s) => s.budget * (1 - THRIFT_MARGIN) >= s.budget * 0.5)
    expect(reachable.length).toBeGreaterThan(0)
    expect(THRIFT_MARGIN).toBeGreaterThanOrEqual(0.35)
  })

  it('Minimalist wants the reference node count or better, and ignores empty runs', () => {
    const reference = SOLUTIONS['flash-sale'].nodes.length
    expect(achievementsAfter({}, run({ nodeCount: reference }))).toContain('minimalist')
    expect(achievementsAfter({}, run({ nodeCount: reference + 1 }))).not.toContain('minimalist')
    expect(achievementsAfter({}, run({ nodeCount: 0 }))).not.toContain('minimalist')
  })

  it('On The Pager wants incidents that were actually answered', () => {
    expect(achievementsAfter({}, run({ decisions: 2, decisionsAutoAnswered: 0 }))).toContain('on-the-pager')
    // One runbook default is enough to lose it.
    expect(achievementsAfter({}, run({ decisions: 2, decisionsAutoAnswered: 1 }))).not.toContain('on-the-pager')
    // ...and a level with no incidents cannot award it at all.
    expect(achievementsAfter({}, run({ decisions: 0 }))).not.toContain('on-the-pager')
  })

  it('only awards On The Pager on levels that raise incidents', () => {
    const withDecisions = SCENARIOS.filter((s) => (s.decisions?.length ?? 0) > 0)
    expect(withDecisions.length).toBeGreaterThan(0)
    for (const s of withDecisions) expect(s.track).toBe('day2')
  })
})
