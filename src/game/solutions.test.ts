// The guarantee behind the "reveal a 3-star answer" button: every shipped
// reference design is replayed here through the real engine, over the real
// phase script, and scored with the real star rules. If a tuning change ever
// leaves one of them short of three stars, this fails before it can ship.
//
// `simulateRun` below deliberately mirrors the run loop in store.ts. It is a
// duplicate, and that is the point — the store's copy drives pixels, this one
// is an assertion about the data in solutions.ts.

import { describe, it, expect } from 'vitest'
import {
  simulateTick,
  estimateMonthlyCost,
  securityAudit,
  blueprintMissing,
  nextFleetCount,
  fleetMin,
  type LiteNode,
  type LiteEdge,
} from './engine'
import { SCENARIOS, getScenario, type Scenario } from './scenarios'
import { SERVICES } from './services'
import { SOLUTIONS, hasSolution, type Solution } from './solutions'

const RAMP_TICKS = 5
const SCORE_AFTER = RAMP_TICKS + 2

type PhaseName = 'baseline' | 'spike' | 'recovery' | 'outage' | 'probe'

/** The phase script from store.ts, verbatim. */
function phasesFor(scenario: Scenario): { name: PhaseName; rps: number; ticks: number }[] {
  const probe: { name: PhaseName; rps: number; ticks: number }[] = scenario.hasProbe
    ? [{ name: 'probe', rps: scenario.baselineRps, ticks: 12 }]
    : []
  return scenario.hasOutage
    ? [
        { name: 'baseline', rps: scenario.baselineRps, ticks: 22 },
        { name: 'spike', rps: scenario.spikeRps, ticks: 24 },
        { name: 'recovery', rps: scenario.baselineRps, ticks: 6 },
        ...probe,
        { name: 'outage', rps: scenario.baselineRps, ticks: 22 },
        { name: 'recovery', rps: scenario.baselineRps, ticks: 6 },
      ]
    : [
        { name: 'baseline', rps: scenario.baselineRps, ticks: 24 },
        { name: 'spike', rps: scenario.spikeRps, ticks: 26 },
        { name: 'recovery', rps: scenario.baselineRps, ticks: 6 },
        ...probe,
        { name: 'recovery', rps: scenario.baselineRps, ticks: 6 },
      ]
}

interface Built {
  nodes: { id: string; serviceId: string; az: 'a' | 'b' | null; region: 'use1' | 'apne2' | null }[]
  edges: LiteEdge[]
}

/** The store's canvas → engine conversion, minus React Flow. */
function build(solution: Solution): Built {
  const nodes = [
    { id: 'users', serviceId: 'users', az: null, region: null },
    ...solution.nodes.map((n) => ({
      id: n.key,
      serviceId: n.serviceId,
      az: n.az ?? null,
      region: n.region ?? null,
    })),
  ]
  const edges = solution.edges.map(([source, target]) => ({ id: `${source}->${target}`, source, target }))
  return { nodes, edges }
}

interface RunResult {
  baselineSuccess: number
  spikeSuccess: number
  outageSuccess: number | null
  delivery: number | null
  lostFraction: number | null
  finalBacklog: number | null
  findings: number | null
  missing: string[]
  cost: number
  stars: number
}

function simulateRun(scenario: Scenario, solution: Solution): RunResult {
  const { nodes, edges } = build(solution)
  const phases = phasesFor(scenario)

  // The outage strikes the fuller box — same worst-case rule as the store.
  let struckAz: 'a' | 'b' | null = null
  let struckRegion: 'use1' | 'apne2' | null = null
  if (scenario.hasOutage && scenario.multiRegion) {
    const c = { use1: 0, apne2: 0 }
    for (const n of nodes) if (n.region && !SERVICES[n.serviceId].global) c[n.region] += 1
    struckRegion = c.use1 >= c.apne2 ? 'use1' : 'apne2'
  } else if (scenario.hasOutage) {
    const c = { a: 0, b: 0 }
    for (const n of nodes) if (n.az && SERVICES[n.serviceId].zonal) c[n.az] += 1
    struckAz = c.a >= c.b ? 'a' : 'b'
  }

  const fleets: Record<string, number> = {}
  for (const n of nodes) {
    const min = fleetMin(n.serviceId)
    if (min > 0) fleets[n.id] = min
  }

  const agg: Record<PhaseName, { served: number; total: number }> = {
    baseline: { served: 0, total: 0 },
    spike: { served: 0, total: 0 },
    recovery: { served: 0, total: 0 },
    outage: { served: 0, total: 0 },
    probe: { served: 0, total: 0 },
  }

  let backlogs: Record<string, number> = {}
  let warm: Record<string, number> = {}
  let prevLoads: Record<string, { inRps: number }> = {}
  let prevRps = 0
  let cost = 0
  let missing: string[] = scenario.requiredServices ? scenario.requiredServices.slice() : []
  let findings: number | null = null
  let runServed = 0
  let runDropped = 0
  let runTotal = 0

  for (const ph of phases) {
    for (let tick = 0; tick < ph.ticks; tick++) {
      const burst = scenario.bursts
      let rps: number
      if (burst && ph.name === 'spike') {
        const cycle = burst.onTicks + burst.offTicks
        rps = tick % cycle < burst.onTicks ? ph.rps : scenario.baselineRps
      } else {
        const ramp = Math.min(1, (tick + 1) / RAMP_TICKS)
        rps = Math.round(prevRps + (ph.rps - prevRps) * ramp)
      }
      const outageNow = ph.name === 'outage'

      const lite: LiteNode[] = nodes.map((n) => {
        const def = SERVICES[n.serviceId]
        const unplaced = scenario.multiRegion
          ? def.global !== true && n.region === null && n.serviceId !== 'users'
          : scenario.hasVpc === true && def.zonal && n.az === null
        const dead =
          outageNow &&
          (scenario.multiRegion
            ? struckRegion !== null && def.global !== true && n.region === struckRegion
            : struckAz !== null && def.zonal && n.az === struckAz)
        return { id: n.id, serviceId: n.serviceId, az: n.az, dead, unplaced }
      })

      for (const id of Object.keys(fleets)) {
        const svc = nodes.find((n) => n.id === id)!.serviceId
        fleets[id] = nextFleetCount(svc, fleets[id], prevLoads[id]?.inRps ?? 0)
      }

      if (ph.name === 'probe' && findings === null) {
        findings = securityAudit(lite, edges).length
      }

      const stats = simulateTick(lite, edges, rps, scenario, fleets, backlogs, warm)
      backlogs = stats.queueBacklogs
      warm = stats.warmCapacity
      prevLoads = stats.nodeLoads

      runServed += stats.served
      runDropped += stats.dropped
      runTotal += stats.total
      if (tick >= SCORE_AFTER) {
        agg[ph.name].served += stats.served
        agg[ph.name].total += stats.total
      }
      if (ph.name === 'baseline' && tick === ph.ticks - 1) {
        cost = estimateMonthlyCost(lite, stats.nodeLoads)
        if (scenario.requiredServices) {
          missing = blueprintMissing(scenario.requiredServices, lite, stats.nodeLoads)
        }
      }
    }
    prevRps = ph.rps
  }

  const baselineSuccess = agg.baseline.total > 0 ? agg.baseline.served / agg.baseline.total : 0
  const spikeSuccess = agg.spike.total > 0 ? agg.spike.served / agg.spike.total : 0
  const outageSuccess = scenario.hasOutage ? (agg.outage.total > 0 ? agg.outage.served / agg.outage.total : 0) : null
  const isAsync = scenario.async === true
  const delivery = isAsync ? (runTotal > 0 ? runServed / runTotal : 0) : null
  const lostFraction = isAsync ? (runTotal > 0 ? runDropped / runTotal : 0) : null
  const finalBacklog = isAsync ? Math.round(Object.values(backlogs).reduce((a, b) => a + b, 0)) : null

  const secure = !scenario.hasProbe || (findings ?? 0) === 0
  const blueprintOk = missing.length === 0

  let star1: boolean
  let star2: boolean
  if (isAsync) {
    star1 = (delivery ?? 0) >= 0.98
    star2 = star1 && (lostFraction ?? 1) <= 0.01 && (finalBacklog ?? 1) <= 1 && secure && blueprintOk
  } else {
    star1 = baselineSuccess >= 0.98
    star2 =
      star1 &&
      spikeSuccess >= 0.95 &&
      (outageSuccess === null || outageSuccess >= 0.95) &&
      secure &&
      blueprintOk
  }
  const star3 = star2 && cost <= scenario.budget
  const stars = (star1 ? 1 : 0) + (star2 ? 1 : 0) + (star3 ? 1 : 0)

  return {
    baselineSuccess,
    spikeSuccess,
    outageSuccess,
    delivery,
    lostFraction,
    finalBacklog,
    findings: scenario.hasProbe ? (findings ?? 0) : null,
    missing,
    cost,
    stars,
  }
}

describe('reference solutions', () => {
  it('covers every built-in scenario', () => {
    for (const sc of SCENARIOS) {
      expect(hasSolution(sc.id), `no solution authored for "${sc.id}"`).toBe(true)
    }
    // ...and nothing else, so a deleted scenario cannot leave dead data behind.
    for (const id of Object.keys(SOLUTIONS)) {
      expect(SCENARIOS.some((s) => s.id === id), `solution "${id}" has no scenario`).toBe(true)
    }
  })

  for (const scenario of SCENARIOS) {
    describe(`${scenario.title} (${scenario.id})`, () => {
      const solution = SOLUTIONS[scenario.id]

      it('earns all three stars through the real run', () => {
        const r = simulateRun(scenario, solution)
        // Report the whole picture on failure — a bare "expected 2 to be 3"
        // sends you hunting through five pillars.
        expect(
          r.stars,
          `${scenario.id}: ${JSON.stringify(
            {
              baseline: r.baselineSuccess.toFixed(3),
              spike: r.spikeSuccess.toFixed(3),
              outage: r.outageSuccess?.toFixed(3) ?? null,
              delivery: r.delivery?.toFixed(3) ?? null,
              lost: r.lostFraction?.toFixed(4) ?? null,
              backlog: r.finalBacklog,
              findings: r.findings,
              missing: r.missing,
              cost: `$${r.cost} of $${scenario.budget}`,
            },
            null,
            1,
          )}`,
        ).toBe(3)
      })

      it('uses only services the scenario allows', () => {
        for (const n of solution.nodes) {
          expect(SERVICES[n.serviceId], `unknown service "${n.serviceId}"`).toBeDefined()
          expect(scenario.banned ?? [], `${n.serviceId} is banned in ${scenario.id}`).not.toContain(n.serviceId)
        }
      })

      it('places every node its container rules require', () => {
        for (const n of solution.nodes) {
          const def = SERVICES[n.serviceId]
          if (scenario.multiRegion) {
            if (def.global === true) {
              expect(n.region, `${n.key} is global and must sit outside a Region`).toBeUndefined()
            } else {
              expect(n.region, `${n.key} must sit inside a Region box`).toBeDefined()
            }
            expect(n.az, `${n.key} must not carry an AZ in a multi-region level`).toBeUndefined()
          } else if (scenario.hasVpc && def.zonal) {
            expect(n.az, `${n.key} is zonal and must sit inside an AZ box`).toBeDefined()
          } else {
            expect(n.az, `${n.key} must not carry an AZ here`).toBeUndefined()
          }
        }
      })

      it('wires only nodes that exist, and never dangles', () => {
        const keys = new Set(['users', ...solution.nodes.map((n) => n.key)])
        for (const [from, to] of solution.edges) {
          expect(keys.has(from), `edge source "${from}" is not a node`).toBe(true)
          expect(keys.has(to), `edge target "${to}" is not a node`).toBe(true)
        }
        // Every node must be reachable from Users, or it is decoration.
        const reached = new Set(['users'])
        for (let i = 0; i < solution.edges.length; i++) {
          for (const [from, to] of solution.edges) if (reached.has(from)) reached.add(to)
        }
        for (const n of solution.nodes) {
          expect(reached.has(n.key), `${n.key} is not reachable from Users`).toBe(true)
        }
      })

      it('ships exactly three explanatory notes', () => {
        expect(solution.notes).toHaveLength(3)
        for (const note of solution.notes) expect(note.length).toBeGreaterThan(30)
      })
    })
  }
})

describe('solution reveal gating', () => {
  it('has no answer for the sandbox', () => {
    expect(hasSolution('sandbox')).toBe(false)
  })
  it('has no answer for a player-authored scenario', () => {
    expect(hasSolution('custom-whatever')).toBe(false)
  })
  it('agrees with the scenario registry on ids', () => {
    for (const id of Object.keys(SOLUTIONS)) expect(getScenario(id).id).toBe(id)
  })
})
