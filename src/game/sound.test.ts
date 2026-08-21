// The cue rules. No AudioContext involved — that is the point of keeping
// `cuesForTransition` pure.
//
// Most of these assert that something does NOT play. Sound is the one feature
// where being slightly too eager is worse than doing nothing, and every mistake
// available here is a repeat-fire mistake.

import { describe, it, expect } from 'vitest'
import { cuesForTransition, type SoundState } from './sound'

const base: SoundState = {
  phase: 'edit',
  runPhase: 'baseline',
  attackRps: 0,
  hasPendingDecision: false,
  stars: null,
  nodeCount: 1,
  edgeCount: 0,
  achievementCount: 0,
}

const s = (over: Partial<SoundState> = {}): SoundState => ({ ...base, ...over })

/** Play the same state twice — nothing should fire the second time. */
const settles = (state: SoundState) => cuesForTransition(state, state)

describe('building', () => {
  it('taps once when a service is placed and once when an edge is drawn', () => {
    expect(cuesForTransition(s(), s({ nodeCount: 2 }))).toEqual(['place'])
    expect(cuesForTransition(s(), s({ edgeCount: 1 }))).toEqual(['connect'])
  })

  it('says nothing when a node is deleted', () => {
    expect(cuesForTransition(s({ nodeCount: 4 }), s({ nodeCount: 3 }))).toEqual([])
  })

  it('stays quiet when a whole canvas is replaced', () => {
    // Revealing the answer or switching scenarios swaps many nodes at once.
    // Firing a click per node would be a machine gun.
    expect(cuesForTransition(s({ nodeCount: 1 }), s({ nodeCount: 8, edgeCount: 7 }))).toEqual([])
  })

  it('does not tap while a run is going', () => {
    const running = s({ phase: 'run' })
    expect(cuesForTransition(running, { ...running, nodeCount: 2 })).toEqual([])
  })
})

describe('run events', () => {
  it('sounds the start of a run once', () => {
    const running = s({ phase: 'run' })
    expect(cuesForTransition(s(), running)).toEqual(['run-start'])
    expect(settles(running)).toEqual([])
  })

  it('marks each phase change, and only the change', () => {
    const baseline = s({ phase: 'run' })
    const spike = s({ phase: 'run', runPhase: 'spike' })
    expect(cuesForTransition(baseline, spike)).toEqual(['spike'])
    expect(settles(spike)).toEqual([])

    const outage = s({ phase: 'run', runPhase: 'outage' })
    expect(cuesForTransition(spike, outage)).toEqual(['outage'])
    expect(cuesForTransition(spike, s({ phase: 'run', runPhase: 'probe' }))).toEqual(['probe'])
    // Recovery is a relief, not an event.
    expect(cuesForTransition(spike, s({ phase: 'run', runPhase: 'recovery' }))).toEqual([])
  })

  it('re-fires the spike cue on a burst level, but only per burst', () => {
    // Trivia Night square-waves between spike and baseline ten times a run.
    // Each entry into the spike should sound; the ticks inside it should not.
    const lull = s({ phase: 'run', runPhase: 'baseline' })
    const burst = s({ phase: 'run', runPhase: 'spike' })
    expect(cuesForTransition(lull, burst)).toEqual(['spike'])
    expect(settles(burst)).toEqual([])
    expect(cuesForTransition(burst, lull)).toEqual([])
    expect(cuesForTransition(lull, burst)).toEqual(['spike'])
  })

  it('sounds the attack once when it lands, not once per tick', () => {
    const clean = s({ phase: 'run', runPhase: 'spike' })
    const under = s({ phase: 'run', runPhase: 'spike', attackRps: 6000 })
    expect(cuesForTransition(clean, under)).toEqual(['attack'])
    expect(settles(under)).toEqual([])
    // The flood wavers tick to tick — that is not a new attack.
    expect(cuesForTransition(under, { ...under, attackRps: 5400 })).toEqual([])
    // ...and a decision that pauses it does not re-trigger on resumption alone.
    const paused = { ...under, attackRps: 0 }
    expect(cuesForTransition(under, paused)).toEqual([])
    expect(cuesForTransition(paused, under)).toEqual(['attack'])
  })

  it('pages once when an incident is raised', () => {
    const calm = s({ phase: 'run' })
    const pending = s({ phase: 'run', hasPendingDecision: true })
    expect(cuesForTransition(calm, pending)).toEqual(['incident'])
    expect(settles(pending)).toEqual([])
    expect(cuesForTransition(pending, calm)).toEqual([])
  })
})

describe('results', () => {
  const finish = (stars: number) => s({ phase: 'results', stars })

  it('plays a different chord for a win, a pass, and a failure', () => {
    const running = s({ phase: 'run' })
    expect(cuesForTransition(running, finish(3))).toEqual(['result-great'])
    expect(cuesForTransition(running, finish(2))).toEqual(['result-ok'])
    expect(cuesForTransition(running, finish(1))).toEqual(['result-ok'])
    expect(cuesForTransition(running, finish(0))).toEqual(['result-poor'])
  })

  it('plays once, not on every re-render of the results screen', () => {
    expect(settles(finish(3))).toEqual([])
  })
})

describe('achievements', () => {
  it('dings once per badge batch', () => {
    expect(cuesForTransition(s(), s({ achievementCount: 1 }))).toEqual(['achievement'])
    // Finishing a track can award several at once; one ding covers it.
    expect(cuesForTransition(s({ achievementCount: 1 }), s({ achievementCount: 5 }))).toEqual([
      'achievement',
    ])
    expect(settles(s({ achievementCount: 5 }))).toEqual([])
  })

  it('sounds alongside the result rather than swallowing it', () => {
    const running = s({ phase: 'run' })
    const done = s({ phase: 'results', stars: 3, achievementCount: 4 })
    expect(cuesForTransition(running, done)).toEqual(['result-great', 'achievement'])
  })
})

describe('the whole thing is quiet at rest', () => {
  it('says nothing when nothing changed, in any phase', () => {
    for (const phase of ['edit', 'run', 'results'] as const) {
      expect(settles(s({ phase })), phase).toEqual([])
    }
  })
})
