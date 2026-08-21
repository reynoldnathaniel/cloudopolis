// Balance tests: every level's intended solution must earn its stars, and the
// classic wrong designs must fail the way the level intends. If a tuning change
// breaks one of these, a level has silently become impossible or trivial.

import { describe, it, expect } from 'vitest'
import {
  simulateTick,
  estimateMonthlyCost,
  securityAudit,
  blueprintMissing,
  nextFleetCount,
  fleetMin,
  tipsForIssues,
  type LiteNode,
  type LiteEdge,
  type TickStats,
} from './engine'
import { getScenario } from './scenarios'
import { SERVICES } from './services'

const N = (id: string, serviceId: string, az?: 'a' | 'b'): LiteNode => ({ id, serviceId, az: az ?? null })
const E = (source: string, target: string): LiteEdge => ({ id: `${source}->${target}`, source, target })

const withDead = (nodes: LiteNode[], dead: string[]): LiteNode[] =>
  nodes.map((n) => (dead.includes(n.id) ? { ...n, dead: true } : n))

/** Run ticks until ASG instance counts settle, then return the steady-state tick. */
function steady(
  nodes: LiteNode[],
  edges: LiteEdge[],
  rps: number,
  scenarioId: string,
  dead: string[] = [],
): { stats: TickStats; asg: Record<string, number> } {
  const scenario = getScenario(scenarioId)
  const effective = withDead(nodes, dead)
  const asg: Record<string, number> = {}
  const svcOf: Record<string, string> = {}
  for (const n of nodes) {
    const min = fleetMin(n.serviceId)
    if (min > 0) {
      asg[n.id] = min
      svcOf[n.id] = n.serviceId
    }
  }
  let backlogs: Record<string, number> = {}
  // Warm capacity settles alongside fleet counts: "steady" means a workload
  // that has been running at this rate long enough to be warm, which is exactly
  // the case a cold start does NOT describe.
  let warm: Record<string, number> = {}
  let stats = simulateTick(effective, edges, rps, scenario, asg, backlogs, warm)
  backlogs = stats.queueBacklogs
  warm = stats.warmCapacity
  for (let i = 0; i < 30; i++) {
    for (const id of Object.keys(asg)) {
      asg[id] = nextFleetCount(svcOf[id], asg[id], stats.nodeLoads[id]?.inRps ?? 0)
    }
    stats = simulateTick(effective, edges, rps, scenario, asg, backlogs, warm)
    backlogs = stats.queueBacklogs
    warm = stats.warmCapacity
  }
  return { stats, asg }
}

/** Run a full traffic profile tick by tick, accumulating run-wide async metrics. */
function runSequence(
  nodes: LiteNode[],
  edges: LiteEdge[],
  rpsPerTick: number[],
  scenarioId: string,
): { served: number; dropped: number; total: number; finalBacklog: number } {
  const scenario = getScenario(scenarioId)
  const asg: Record<string, number> = {}
  const svcOf: Record<string, string> = {}
  for (const n of nodes) {
    const min = fleetMin(n.serviceId)
    if (min > 0) {
      asg[n.id] = min
      svcOf[n.id] = n.serviceId
    }
  }
  let backlogs: Record<string, number> = {}
  let served = 0
  let dropped = 0
  let total = 0
  let prev: TickStats | null = null
  for (const rps of rpsPerTick) {
    if (prev) {
      for (const id of Object.keys(asg)) asg[id] = nextFleetCount(svcOf[id], asg[id], prev.nodeLoads[id]?.inRps ?? 0)
    }
    const stats = simulateTick(nodes, edges, rps, scenario, asg, backlogs)
    backlogs = stats.queueBacklogs
    served += stats.served
    dropped += stats.dropped
    total += stats.total
    prev = stats
  }
  const finalBacklog = Object.values(backlogs).reduce((a, b) => a + b, 0)
  return { served, dropped, total, finalBacklog }
}

const ticks = (n: number, rps: number) => Array.from({ length: n }, () => rps)

const rate = (s: TickStats) => (s.total > 0 ? s.served / s.total : 1)

// ---------------------------------------------------------------- Level 1

describe('Level 1: Launch Day (static-site)', () => {
  const nodes = [N('users', 'users'), N('cf', 'cloudfront'), N('s3', 's3')]
  const edges = [E('users', 'cf'), E('cf', 's3')]
  const sc = getScenario('static-site')

  it('CloudFront + S3 serves baseline and spike fully', () => {
    expect(rate(steady(nodes, edges, sc.baselineRps, sc.id).stats)).toBeGreaterThan(0.99)
    expect(rate(steady(nodes, edges, sc.spikeRps, sc.id).stats)).toBeGreaterThan(0.99)
  })

  it('costs $15/mo — under the $30 budget', () => {
    const { stats } = steady(nodes, edges, sc.baselineRps, sc.id)
    expect(estimateMonthlyCost(nodes, stats.nodeLoads)).toBe(15)
    expect(15).toBeLessThanOrEqual(sc.budget)
  })

  it('is clean under the security probe', () => {
    expect(securityAudit(nodes, edges)).toHaveLength(0)
  })

  it('bare public S3 fails the spike AND the probe', () => {
    const bad = [N('users', 'users'), N('s3', 's3')]
    const badEdges = [E('users', 's3')]
    expect(rate(steady(bad, badEdges, sc.spikeRps, sc.id).stats)).toBeLessThan(0.95)
    expect(securityAudit(bad, badEdges)).toHaveLength(1)
  })
})

// ---------------------------------------------------------------- Level 2

describe('Level 2: PhotoShare (photo-app)', () => {
  const nodes = [N('users', 'users'), N('gw', 'apigw'), N('fn', 'lambda'), N('db', 'dynamodb')]
  const edges = [E('users', 'gw'), E('gw', 'fn'), E('fn', 'db')]
  const sc = getScenario('photo-app')

  it('serverless chain survives baseline and spike, $73/mo under $120', () => {
    const base = steady(nodes, edges, sc.baselineRps, sc.id).stats
    expect(rate(base)).toBeGreaterThan(0.99)
    expect(rate(steady(nodes, edges, sc.spikeRps, sc.id).stats)).toBeGreaterThan(0.99)
    expect(estimateMonthlyCost(nodes, base.nodeLoads)).toBe(73)
  })

  it('ALB + ASG + DynamoDB also 3-stars at $108/mo', () => {
    const alt = [N('users', 'users'), N('lb', 'alb'), N('fleet', 'asg'), N('db', 'dynamodb')]
    const altEdges = [E('users', 'lb'), E('lb', 'fleet'), E('fleet', 'db')]
    const base = steady(alt, altEdges, sc.baselineRps, sc.id).stats
    expect(rate(base)).toBeGreaterThan(0.99)
    expect(rate(steady(alt, altEdges, sc.spikeRps, sc.id).stats)).toBeGreaterThan(0.99)
    expect(estimateMonthlyCost(alt, base.nodeLoads)).toBe(108)
  })

  it('compute with no database drops everything', () => {
    const bad = [N('users', 'users'), N('gw', 'apigw'), N('fn', 'lambda')]
    const badEdges = [E('users', 'gw'), E('gw', 'fn')]
    const s = steady(bad, badEdges, sc.baselineRps, sc.id).stats
    expect(rate(s)).toBeLessThan(0.05)
    expect(s.issues).toContain('compute-no-db')
  })
})

// ---------------------------------------------------------------- Level 3

describe('Level 3: The Migration (migration)', () => {
  const sc = getScenario('migration')
  const fleet = (n: number): { nodes: LiteNode[]; edges: LiteEdge[] } => {
    const nodes = [N('users', 'users'), N('lb', 'alb'), N('db', 'dynamodb')]
    const edges = [E('users', 'lb')]
    for (let i = 1; i <= n; i++) {
      nodes.push(N(`ec2-${i}`, 'ec2'))
      edges.push(E('lb', `ec2-${i}`), E(`ec2-${i}`, 'db'))
    }
    return { nodes, edges }
  }

  it('4× EC2 behind an ALB survives the 550 RPS spike at $178/mo', () => {
    const { nodes, edges } = fleet(4)
    const base = steady(nodes, edges, sc.baselineRps, sc.id).stats
    expect(rate(base)).toBeGreaterThan(0.99)
    expect(rate(steady(nodes, edges, sc.spikeRps, sc.id).stats)).toBeGreaterThan(0.99)
    const cost = estimateMonthlyCost(nodes, base.nodeLoads)
    expect(cost).toBe(178)
    expect(cost).toBeLessThanOrEqual(sc.budget)
  })

  it('a 5th instance blows the budget — right-sizing is the lesson', () => {
    const { nodes, edges } = fleet(5)
    const base = steady(nodes, edges, sc.baselineRps, sc.id).stats
    expect(estimateMonthlyCost(nodes, base.nodeLoads)).toBeGreaterThan(sc.budget)
  })

  it('3× EC2 melts during the spike', () => {
    const { nodes, edges } = fleet(3)
    const s = steady(nodes, edges, sc.spikeRps, sc.id).stats
    expect(rate(s)).toBeLessThan(0.95)
    expect(s.issues).toContain('overloaded:EC2')
  })
})

// ---------------------------------------------------------------- Level 4

describe('Level 4: FlashSale (flash-sale)', () => {
  const sc = getScenario('flash-sale')
  const nodes = [
    N('users', 'users'),
    N('gw', 'apigw'),
    N('fn', 'lambda'),
    N('cache-a', 'elasticache', 'a'),
    N('cache-b', 'elasticache', 'b'),
    N('rds-a', 'rds', 'a'),
    N('rds-b', 'rds', 'b'),
  ]
  const edges = [
    E('users', 'gw'),
    E('gw', 'fn'),
    E('fn', 'cache-a'),
    E('fn', 'cache-b'),
    E('cache-a', 'rds-a'),
    E('cache-b', 'rds-b'),
  ]

  it('dual-AZ cache + RDS survives the spike at $250/mo', () => {
    const base = steady(nodes, edges, sc.baselineRps, sc.id).stats
    expect(rate(base)).toBeGreaterThan(0.99)
    expect(rate(steady(nodes, edges, sc.spikeRps, sc.id).stats)).toBeGreaterThan(0.99)
    const cost = estimateMonthlyCost(nodes, base.nodeLoads)
    expect(cost).toBe(250)
    expect(cost).toBeLessThanOrEqual(sc.budget)
  })

  it('survives the AZ-A outage by failing over to AZ-B', () => {
    const s = steady(nodes, edges, sc.baselineRps, sc.id, ['cache-a', 'rds-a']).stats
    expect(rate(s)).toBeGreaterThan(0.99)
  })

  it('single-AZ design dies completely in the outage', () => {
    const singleAz = [
      N('users', 'users'),
      N('gw', 'apigw'),
      N('fn', 'lambda'),
      N('cache-a', 'elasticache', 'a'),
      N('rds-a', 'rds', 'a'),
    ]
    const singleEdges = [E('users', 'gw'), E('gw', 'fn'), E('fn', 'cache-a'), E('cache-a', 'rds-a')]
    const s = steady(singleAz, singleEdges, sc.baselineRps, sc.id, ['cache-a', 'rds-a']).stats
    expect(rate(s)).toBeLessThan(0.05)
    expect(s.issues).toContain('db-unavailable')
  })
})

// ---------------------------------------------------------------- Level 5

describe('Level 5: IPO Day (ipo-day)', () => {
  const sc = getScenario('ipo-day')
  const nodes = [
    N('users', 'users'),
    N('cdn', 'cloudfront'),
    N('lb', 'alb'),
    N('fleet', 'asg'),
    N('cache-a', 'elasticache', 'a'),
    N('cache-b', 'elasticache', 'b'),
    N('rds-a', 'rds', 'a'),
    N('rds-b', 'rds', 'b'),
  ]
  const edges = [
    E('users', 'cdn'),
    E('cdn', 'lb'),
    E('lb', 'fleet'),
    E('fleet', 'cache-a'),
    E('fleet', 'cache-b'),
    E('cache-a', 'rds-a'),
    E('cache-b', 'rds-b'),
  ]

  it('full stack idles at 3 ASG instances and $305/mo at baseline', () => {
    const { stats, asg } = steady(nodes, edges, sc.baselineRps, sc.id)
    expect(rate(stats)).toBeGreaterThan(0.99)
    expect(asg['fleet']).toBe(3)
    const cost = estimateMonthlyCost(nodes, stats.nodeLoads)
    expect(cost).toBe(305)
    expect(cost).toBeLessThanOrEqual(sc.budget)
  })

  it('scales to 10 instances and survives the 2,000 RPS spike', () => {
    const { stats, asg } = steady(nodes, edges, sc.spikeRps, sc.id)
    expect(asg['fleet']).toBe(10)
    expect(rate(stats)).toBeGreaterThan(0.99)
  })

  it('survives the AZ-A outage', () => {
    const s = steady(nodes, edges, sc.baselineRps, sc.id, ['cache-a', 'rds-a']).stats
    expect(rate(s)).toBeGreaterThan(0.99)
  })

  it('without CloudFront the spike exceeds a maxed ASG — the CDN is mandatory', () => {
    const noCdn = nodes.filter((n) => n.id !== 'cdn')
    const noCdnEdges = [E('users', 'lb'), ...edges.filter((e) => e.source !== 'users' && e.source !== 'cdn')]
    const s = steady(noCdn, noCdnEdges, sc.spikeRps, sc.id).stats
    expect(rate(s)).toBeLessThan(0.95)
  })
})

// ---------------------------------------------------------------- Units

describe('Auto Scaling group behavior', () => {
  it('scales up at most 2 instances per tick toward demand', () => {
    expect(nextFleetCount('asg', 2, 1400)).toBe(4)
    expect(nextFleetCount('asg', 4, 1400)).toBe(6)
    expect(nextFleetCount('asg', 8, 1400)).toBe(10)
  })
  it('caps at 10 and floors at the minimum', () => {
    expect(nextFleetCount('asg', 10, 99999)).toBe(10)
    expect(nextFleetCount('asg', 2, 0)).toBe(fleetMin('asg'))
  })
  it('scales down one instance at a time', () => {
    expect(nextFleetCount('asg', 10, 100)).toBe(9)
  })
})

describe('security audit', () => {
  it('flags databases wired straight to Users', () => {
    const nodes = [N('users', 'users'), N('db', 'rds')]
    const findings = securityAudit(nodes, [E('users', 'db')])
    expect(findings).toHaveLength(1)
    expect(findings[0].label).toContain('RDS')
  })
  it('allows CloudFront, ALB, and API Gateway at the edge', () => {
    const nodes = [N('users', 'users'), N('cdn', 'cloudfront'), N('lb', 'alb'), N('gw', 'apigw')]
    const edges = [E('users', 'cdn'), E('users', 'lb'), E('users', 'gw')]
    expect(securityAudit(nodes, edges)).toHaveLength(0)
  })
})

// ---------------------------------------------------------------- Queues & fan-out

describe('queue mechanics', () => {
  it('buffers a burst as backlog and drains it with zero loss', () => {
    // 12,000 in, Lambda drains 10,000 — backlog grows, then empties.
    const nodes = [N('users', 'users'), N('gw', 'apigw'), N('q', 'sqs'), N('fn', 'lambda'), N('db', 'dynamodb')]
    const edges = [E('users', 'gw'), E('gw', 'q'), E('q', 'fn'), E('fn', 'db')]
    const r = runSequence(nodes, edges, [...ticks(10, 12000), ...ticks(10, 200)], 'order-storm')
    expect(r.dropped).toBeLessThan(1)
    expect(r.finalBacklog).toBeLessThan(1)
    expect(r.served / r.total).toBeGreaterThan(0.99)
  })

  it('Kinesis throttles writes above its stream capacity', () => {
    const nodes = [N('users', 'users'), N('k', 'kinesis'), N('fn', 'lambda'), N('db', 'dynamodb')]
    const edges = [E('users', 'k'), E('k', 'fn'), E('fn', 'db')]
    const s = steady(nodes, edges, 8000, 'click-stream').stats
    expect(s.issues).toContain('overloaded:Kinesis')
    expect(s.dropped).toBeGreaterThan(2500)
  })

  it('overflows a bounded buffer when consumers are far too small', () => {
    const nodes = [N('users', 'users'), N('gw', 'apigw'), N('k', 'kinesis'), N('c', 'ec2'), N('db', 'dynamodb')]
    const edges = [E('users', 'gw'), E('gw', 'k'), E('k', 'c'), E('c', 'db')]
    const r = runSequence(nodes, edges, ticks(30, 5000), 'click-stream')
    expect(r.dropped).toBeGreaterThan(1000)
  })

  it('flags a queue with no consumers', () => {
    const nodes = [N('users', 'users'), N('gw', 'apigw'), N('q', 'sqs')]
    const edges = [E('users', 'gw'), E('gw', 'q')]
    const s = steady(nodes, edges, 100, 'order-storm').stats
    expect(s.issues).toContain('queue-no-consumers')
  })
})

describe('fan-out (SNS)', () => {
  it('delivers a full copy to every subscriber', () => {
    const nodes = [
      N('users', 'users'),
      N('gw', 'apigw'),
      N('sns', 'sns'),
      N('q1', 'sqs'),
      N('q2', 'sqs'),
      N('f1', 'lambda'),
      N('f2', 'lambda'),
      N('d1', 'dynamodb'),
      N('d2', 'dynamodb'),
    ]
    const edges = [
      E('users', 'gw'),
      E('gw', 'sns'),
      E('sns', 'q1'),
      E('sns', 'q2'),
      E('q1', 'f1'),
      E('q2', 'f2'),
      E('f1', 'd1'),
      E('f2', 'd2'),
    ]
    const s = steady(nodes, edges, 100, 'order-storm').stats
    expect(s.total).toBe(200) // 100 in, 2 copies out
    expect(rate(s)).toBeGreaterThan(0.99)
  })

  it('drops events published into the void', () => {
    const nodes = [N('users', 'users'), N('gw', 'apigw'), N('sns', 'sns')]
    const edges = [E('users', 'gw'), E('gw', 'sns')]
    const s = steady(nodes, edges, 100, 'order-storm').stats
    expect(s.issues).toContain('fanout-no-subscribers')
  })
})

// ---------------------------------------------------------------- GenAI: Prompt Rush

describe('GenAI: Prompt Rush (prompt-rush)', () => {
  const sc = getScenario('prompt-rush')

  it('naive Lambda → Bedrock throttles at the 150 RPS quota during the spike', () => {
    const nodes = [N('users', 'users'), N('gw', 'apigw'), N('fn', 'lambda'), N('llm', 'bedrock')]
    const edges = [E('users', 'gw'), E('gw', 'fn'), E('fn', 'llm')]
    const s = steady(nodes, edges, sc.spikeRps, sc.id).stats
    expect(rate(s)).toBeLessThan(0.5)
    expect(s.issues).toContain('overloaded:Bedrock')
  })

  it('a semantic cache beats the quota and lands at $83/mo', () => {
    const nodes = [
      N('users', 'users'),
      N('gw', 'apigw'),
      N('fn', 'lambda'),
      N('cache', 'elasticache'),
      N('llm', 'bedrock'),
    ]
    const edges = [E('users', 'gw'), E('gw', 'fn'), E('fn', 'cache'), E('cache', 'llm')]
    const base = steady(nodes, edges, sc.baselineRps, sc.id).stats
    expect(rate(base)).toBeGreaterThan(0.99)
    expect(rate(steady(nodes, edges, sc.spikeRps, sc.id).stats)).toBeGreaterThan(0.99)
    const cost = estimateMonthlyCost(nodes, base.nodeLoads)
    expect(cost).toBe(83)
    expect(cost).toBeLessThanOrEqual(sc.budget)
    expect(blueprintMissing(sc.requiredServices, nodes, base.nodeLoads)).toHaveLength(0)
  })

  it('blueprint flags a design without Bedrock', () => {
    const nodes = [N('users', 'users'), N('gw', 'apigw'), N('fn', 'lambda'), N('db', 'dynamodb')]
    const edges = [E('users', 'gw'), E('gw', 'fn'), E('fn', 'db')]
    const base = steady(nodes, edges, sc.baselineRps, sc.id).stats
    expect(blueprintMissing(sc.requiredServices, nodes, base.nodeLoads)).toEqual(['bedrock'])
  })
})

// ---------------------------------------------------------------- Event-Driven: Order Storm

describe('Containers: The Replatform (replatform)', () => {
  const sc = getScenario('replatform')
  const design = (compute: string, edge: string) => ({
    nodes: [N('users', 'users'), N('edge', edge), N('app', compute), N('db', 'dynamodb')],
    edges: [E('users', 'edge'), E('edge', 'app'), E('app', 'db')],
  })

  it('ALB → Fargate → DynamoDB serves the rush and lands at $132/mo', () => {
    const { nodes, edges } = design('fargate', 'alb')
    const base = steady(nodes, edges, sc.baselineRps, sc.id)
    expect(rate(base.stats)).toBeGreaterThan(0.99)
    expect(base.asg['app']).toBe(8) // 800 rps / 100 per task

    const spike = steady(nodes, edges, sc.spikeRps, sc.id)
    expect(rate(spike.stats)).toBeGreaterThan(0.99)
    expect(spike.asg['app']).toBe(16)

    const cost = estimateMonthlyCost(nodes, base.stats.nodeLoads)
    expect(cost).toBe(132)
    expect(cost).toBeLessThanOrEqual(sc.budget)
    expect(blueprintMissing(sc.requiredServices, nodes, base.stats.nodeLoads)).toHaveLength(0)
    expect(securityAudit(nodes, edges)).toHaveLength(0)
  })

  it('Lambda serves it fine but the bill fails — sustained load is where per-request loses', () => {
    const { nodes, edges } = design('lambda', 'alb')
    const base = steady(nodes, edges, sc.baselineRps, sc.id).stats
    expect(rate(base)).toBeGreaterThan(0.99)
    const cost = estimateMonthlyCost(nodes, base.nodeLoads)
    expect(cost).toBe(188)
    expect(cost).toBeGreaterThan(sc.budget)
  })

  it('API Gateway in front of Fargate costs more than the ALB doing the same job', () => {
    const viaAlb = design('fargate', 'alb')
    const viaGw = design('fargate', 'apigw')
    const albCost = estimateMonthlyCost(
      viaAlb.nodes,
      steady(viaAlb.nodes, viaAlb.edges, sc.baselineRps, sc.id).stats.nodeLoads,
    )
    const gwCost = estimateMonthlyCost(
      viaGw.nodes,
      steady(viaGw.nodes, viaGw.edges, sc.baselineRps, sc.id).stats.nodeLoads,
    )
    expect(gwCost).toBe(197)
    expect(gwCost).toBeGreaterThan(albCost)
    expect(gwCost).toBeGreaterThan(sc.budget)
  })

  it('an ASG cannot reach the spike at all — 10 instances cap out at 1,500 rps', () => {
    const { nodes, edges } = design('asg', 'alb')
    const spike = steady(nodes, edges, sc.spikeRps, sc.id)
    expect(spike.asg['app']).toBe(10) // maxed
    expect(rate(spike.stats)).toBeLessThan(0.99)
    const base = steady(nodes, edges, sc.baselineRps, sc.id).stats
    expect(estimateMonthlyCost(nodes, base.nodeLoads)).toBeGreaterThan(sc.budget)
  })

  it('containers add capacity twice as fast as VMs — the whole personality', () => {
    const perTick = (serviceId: string) => {
      const s = SERVICES[serviceId].scaling!
      return s.rate * s.perUnit
    }
    expect(perTick('fargate')).toBe(2 * perTick('asg'))

    // Against a target both fleets can actually reach, containers get there first.
    const ticksToServe = (serviceId: string, target: number) => {
      let count = fleetMin(serviceId)
      const s = SERVICES[serviceId].scaling!
      for (let t = 1; t <= 20; t++) {
        count = nextFleetCount(serviceId, count, target)
        if (count * s.perUnit >= target) return t
      }
      return 99
    }
    expect(ticksToServe('fargate', 1200)).toBe(2) // 2 → 8 → 12 tasks
    expect(ticksToServe('asg', 1200)).toBe(3) //     2 → 4 → 6 → 8 instances
  })
})

describe('GenAI: Grounded (rag-grounded)', () => {
  const sc = getScenario('rag-grounded')

  const CHAIN = {
    nodes: [
      N('users', 'users'),
      N('gw', 'apigw'),
      N('fn', 'lambda'),
      N('cache', 'elasticache'),
      N('vec', 'opensearch'),
      N('llm', 'bedrock'),
    ],
    edges: [E('users', 'gw'), E('gw', 'fn'), E('fn', 'cache'), E('cache', 'vec'), E('vec', 'llm')],
  }

  it('retrieval alone answers nothing — the chain must reach a model', () => {
    const nodes = [N('users', 'users'), N('gw', 'apigw'), N('fn', 'lambda'), N('vec', 'opensearch')]
    const edges = [E('users', 'gw'), E('gw', 'fn'), E('fn', 'vec')]
    const s = steady(nodes, edges, sc.baselineRps, sc.id).stats
    expect(rate(s)).toBe(0)
    expect(s.issues).toContain('retriever-no-model')
  })

  it('a retriever forwards everything it handles — no hit ratio of its own', () => {
    const nodes = [N('users', 'users'), N('gw', 'apigw'), N('fn', 'lambda'), N('vec', 'opensearch'), N('llm', 'bedrock')]
    const edges = [E('users', 'gw'), E('gw', 'fn'), E('vec', 'llm'), E('fn', 'vec')]
    const s = steady(nodes, edges, 100, sc.id).stats
    // Every one of the 100 requests is retrieved, then generated.
    expect(s.nodeLoads['vec'].processed).toBeCloseTo(100, 5)
    expect(s.nodeLoads['llm'].processed).toBeCloseTo(100, 5)
    expect(rate(s)).toBeGreaterThan(0.99)
  })

  it('ungrounded Lambda → Bedrock fails the blueprint', () => {
    const nodes = [N('users', 'users'), N('gw', 'apigw'), N('fn', 'lambda'), N('llm', 'bedrock')]
    const edges = [E('users', 'gw'), E('gw', 'fn'), E('fn', 'llm')]
    const s = steady(nodes, edges, sc.baselineRps, sc.id).stats
    expect(blueprintMissing(sc.requiredServices, nodes, s.nodeLoads)).toContain('opensearch')
  })

  it('retrieve-then-generate without a cache blows both the quota and the budget', () => {
    const nodes = [N('users', 'users'), N('gw', 'apigw'), N('fn', 'lambda'), N('vec', 'opensearch'), N('llm', 'bedrock')]
    const edges = [E('users', 'gw'), E('gw', 'fn'), E('fn', 'vec'), E('vec', 'llm')]
    const base = steady(nodes, edges, sc.baselineRps, sc.id).stats
    // Baseline squeaks through — 150 rps is exactly Bedrock's quota…
    expect(rate(base)).toBeGreaterThan(0.99)
    // …but every request pays tokens, so the bill alone loses the third star.
    const cost = estimateMonthlyCost(nodes, base.nodeLoads)
    expect(cost).toBe(203)
    expect(cost).toBeGreaterThan(sc.budget)
    // And the spike sends all 450 at a 150 RPS quota.
    const spike = steady(nodes, edges, sc.spikeRps, sc.id).stats
    expect(rate(spike)).toBeLessThan(0.5)
    expect(spike.issues).toContain('overloaded:Bedrock')
  })

  it('semantic cache + retrieve-then-generate earns three stars at $165/mo', () => {
    const { nodes, edges } = CHAIN
    const base = steady(nodes, edges, sc.baselineRps, sc.id).stats
    expect(rate(base)).toBeGreaterThan(0.99)

    const spike = steady(nodes, edges, sc.spikeRps, sc.id).stats
    expect(rate(spike)).toBeGreaterThan(0.99)
    // Only the cache misses are retrieved and generated: 450 × 30% = 135 ≤ 150 quota.
    expect(spike.nodeLoads['vec'].processed).toBeCloseTo(135, 5)
    expect(spike.nodeLoads['llm'].processed).toBeCloseTo(135, 5)

    const cost = estimateMonthlyCost(nodes, base.nodeLoads)
    expect(cost).toBe(165)
    expect(cost).toBeLessThanOrEqual(sc.budget)
    expect(blueprintMissing(sc.requiredServices, nodes, base.nodeLoads)).toHaveLength(0)
    expect(securityAudit(nodes, edges)).toHaveLength(0)
  })

  it('a vector store on the public internet fails the probe', () => {
    const nodes = [N('users', 'users'), N('vec', 'opensearch'), N('llm', 'bedrock')]
    const edges = [E('users', 'vec'), E('vec', 'llm')]
    expect(securityAudit(nodes, edges)).toHaveLength(1)
  })
})

describe('Event-Driven: Order Storm (order-storm)', () => {
  const sc = getScenario('order-storm')
  const asyncNodes = [
    N('users', 'users'),
    N('gw', 'apigw'),
    N('sns', 'sns'),
    N('q', 'sqs'),
    N('fn', 'lambda'),
    N('db', 'dynamodb'),
  ]
  const asyncEdges = [
    E('users', 'gw'),
    E('gw', 'sns'),
    E('sns', 'q'),
    E('q', 'fn'),
    E('fn', 'db'),
  ]
  // Mimic the real run: baseline, burst, then drain time.
  const profile = [...ticks(22, sc.baselineRps), ...ticks(26, sc.spikeRps), ...ticks(24, sc.baselineRps)]

  it('the async design loses nothing and drains its backlog, at $77/mo', () => {
    const r = runSequence(asyncNodes, asyncEdges, profile, sc.id)
    expect(r.dropped / r.total).toBeLessThan(0.01)
    expect(r.finalBacklog).toBeLessThan(1)
    expect(r.served / r.total).toBeGreaterThan(0.98)
    const base = steady(asyncNodes, asyncEdges, sc.baselineRps, sc.id).stats
    expect(estimateMonthlyCost(asyncNodes, base.nodeLoads)).toBe(77)
  })

  it('the synchronous design MUST lose orders during the burst', () => {
    const nodes = [N('users', 'users'), N('gw', 'apigw'), N('fn', 'lambda'), N('db', 'dynamodb')]
    const edges = [E('users', 'gw'), E('gw', 'fn'), E('fn', 'db')]
    const r = runSequence(nodes, edges, profile, sc.id)
    expect(r.dropped / r.total).toBeGreaterThan(0.01)
  })
})

// ---------------------------------------------------------------- Streaming: Click Stream

describe('Streaming: Click Stream (click-stream)', () => {
  const sc = getScenario('click-stream')

  it('Kinesis → Lambda → SageMaker handles the flood at $190/mo', () => {
    const nodes = [N('users', 'users'), N('k', 'kinesis'), N('fn', 'lambda'), N('sm', 'sagemaker')]
    const edges = [E('users', 'k'), E('k', 'fn'), E('fn', 'sm')]
    const base = steady(nodes, edges, sc.baselineRps, sc.id).stats
    expect(rate(base)).toBeGreaterThan(0.99)
    expect(rate(steady(nodes, edges, sc.spikeRps, sc.id).stats)).toBeGreaterThan(0.99)
    const cost = estimateMonthlyCost(nodes, base.nodeLoads)
    expect(cost).toBe(190)
    expect(cost).toBeLessThanOrEqual(sc.budget)
    expect(securityAudit(nodes, edges)).toHaveLength(0)
    expect(blueprintMissing(sc.requiredServices, nodes, base.nodeLoads)).toHaveLength(0)
  })

  it('fronting with API Gateway blows the budget — the economics lesson', () => {
    const nodes = [N('users', 'users'), N('gw', 'apigw'), N('fn', 'lambda'), N('sm', 'sagemaker')]
    const edges = [E('users', 'gw'), E('gw', 'fn'), E('fn', 'sm')]
    const base = steady(nodes, edges, sc.baselineRps, sc.id).stats
    expect(estimateMonthlyCost(nodes, base.nodeLoads)).toBeGreaterThan(sc.budget)
  })

  it('the probe allows Kinesis at the edge but not SQS', () => {
    const kNodes = [N('users', 'users'), N('k', 'kinesis')]
    expect(securityAudit(kNodes, [E('users', 'k')])).toHaveLength(0)
    const qNodes = [N('users', 'users'), N('q', 'sqs')]
    expect(securityAudit(qNodes, [E('users', 'q')])).toHaveLength(1)
  })
})

// ------------------------------------------------- Going Global: The Blackout
//
// The engine has no concept of a Region — the store decides which nodes a Region
// failure kills and hands them over as `dead`. So these tests kill a whole
// region's worth of nodes at once, which is exactly what the store does.

describe('Going Global: The Blackout (blackout)', () => {
  const sc = getScenario('blackout')
  const USE1 = ['alb1', 'fg1', 'db1']

  // Active-active: Route 53 out front, a complete stack in each Region.
  const nodes = [
    N('users', 'users'),
    N('r53', 'route53'),
    N('alb1', 'alb'),
    N('fg1', 'fargate'),
    N('db1', 'dynamodb'),
    N('alb2', 'alb'),
    N('fg2', 'fargate'),
    N('db2', 'dynamodb'),
  ]
  const edges = [
    E('users', 'r53'),
    E('r53', 'alb1'),
    E('alb1', 'fg1'),
    E('fg1', 'db1'),
    E('r53', 'alb2'),
    E('alb2', 'fg2'),
    E('fg2', 'db2'),
  ]

  it('active-active behind Route 53 survives losing a whole Region, at $113/mo', () => {
    const base = steady(nodes, edges, sc.baselineRps, sc.id).stats
    expect(rate(base)).toBeGreaterThan(0.99)
    expect(rate(steady(nodes, edges, sc.spikeRps, sc.id).stats)).toBeGreaterThan(0.99)
    // us-east-1 goes dark: the survivor absorbs 100% of the load.
    expect(rate(steady(nodes, edges, sc.baselineRps, sc.id, USE1).stats)).toBeGreaterThan(0.99)

    const cost = estimateMonthlyCost(nodes, base.nodeLoads)
    expect(cost).toBe(113)
    expect(cost).toBeLessThanOrEqual(sc.budget)
    expect(securityAudit(nodes, edges)).toHaveLength(0)
    expect(blueprintMissing(sc.requiredServices, nodes, base.nodeLoads)).toHaveLength(0)
  })

  it('the all-serverless stack also fits the budget — two valid answers', () => {
    const svl = [
      N('users', 'users'),
      N('r53', 'route53'),
      N('gw1', 'apigw'),
      N('fn1', 'lambda'),
      N('db1', 'dynamodb'),
      N('gw2', 'apigw'),
      N('fn2', 'lambda'),
      N('db2', 'dynamodb'),
    ]
    const svlEdges = [
      E('users', 'r53'),
      E('r53', 'gw1'),
      E('gw1', 'fn1'),
      E('fn1', 'db1'),
      E('r53', 'gw2'),
      E('gw2', 'fn2'),
      E('fn2', 'db2'),
    ]
    const base = steady(svl, svlEdges, sc.baselineRps, sc.id).stats
    expect(rate(base)).toBeGreaterThan(0.99)
    expect(rate(steady(svl, svlEdges, sc.baselineRps, sc.id, ['gw1', 'fn1', 'db1']).stats)).toBeGreaterThan(0.99)
    expect(estimateMonthlyCost(svl, base.nodeLoads)).toBeLessThanOrEqual(sc.budget)
  })

  // The whole point of the level: DNS clients believe what they are told.
  it('pointing Users at both Regions loses half the traffic — Route 53 does not', () => {
    const direct = nodes.filter((n) => n.id !== 'r53')
    const directEdges = [
      E('users', 'alb1'),
      E('alb1', 'fg1'),
      E('fg1', 'db1'),
      E('users', 'alb2'),
      E('alb2', 'fg2'),
      E('fg2', 'db2'),
    ]
    // Healthy, it looks identical to the Route 53 design.
    expect(rate(steady(direct, directEdges, sc.baselineRps, sc.id).stats)).toBeGreaterThan(0.99)
    // Under a Region failure it walks half of every request into the dead one.
    const out = steady(direct, directEdges, sc.baselineRps, sc.id, USE1).stats
    expect(rate(out)).toBeGreaterThan(0.45)
    expect(rate(out)).toBeLessThan(0.55)
    expect(out.issues).toContain('hit-dead-node')
    // ...and it never earns the second star, which needs ≥95%.
    expect(rate(out)).toBeLessThan(0.95)
  })

  it('a single-Region design serves nothing once that Region is gone', () => {
    const one = [N('users', 'users'), N('r53', 'route53'), N('alb1', 'alb'), N('fg1', 'fargate'), N('db1', 'dynamodb')]
    const oneEdges = [E('users', 'r53'), E('r53', 'alb1'), E('alb1', 'fg1'), E('fg1', 'db1')]
    expect(rate(steady(one, oneEdges, sc.baselineRps, sc.id).stats)).toBeGreaterThan(0.99)
    const out = steady(one, oneEdges, sc.baselineRps, sc.id, USE1).stats
    expect(rate(out)).toBe(0)
    expect(out.issues).toContain('all-targets-dead')
  })

  it('two fixed-size EC2 + RDS stacks survive but blow the budget — why elasticity exists', () => {
    const vms = [
      N('users', 'users'),
      N('r53', 'route53'),
      N('alb1', 'alb'),
      N('ec2a', 'ec2'),
      N('ec2b', 'ec2'),
      N('db1', 'rds'),
      N('alb2', 'alb'),
      N('ec2c', 'ec2'),
      N('ec2d', 'ec2'),
      N('db2', 'rds'),
    ]
    const vmEdges = [
      E('users', 'r53'),
      E('r53', 'alb1'),
      E('alb1', 'ec2a'),
      E('alb1', 'ec2b'),
      E('ec2a', 'db1'),
      E('ec2b', 'db1'),
      E('r53', 'alb2'),
      E('alb2', 'ec2c'),
      E('alb2', 'ec2d'),
      E('ec2c', 'db2'),
      E('ec2d', 'db2'),
    ]
    const base = steady(vms, vmEdges, sc.baselineRps, sc.id).stats
    expect(rate(base)).toBeGreaterThan(0.99)
    expect(estimateMonthlyCost(vms, base.nodeLoads)).toBeGreaterThan(sc.budget)
  })

  it('regional services left outside a Region box report needs-region, not needs-az', () => {
    const stray = [N('users', 'users'), N('r53', 'route53'), N('alb1', 'alb')]
    stray[2] = { ...stray[2], unplaced: true }
    const stats = simulateTick(stray, [E('users', 'r53'), E('r53', 'alb1')], sc.baselineRps, sc)
    expect(stats.issues).toContain('needs-region')
    expect(stats.issues).not.toContain('needs-az')
  })

  it('Route 53 is edge-safe and global', () => {
    expect(securityAudit([N('users', 'users'), N('r53', 'route53')], [E('users', 'r53')])).toHaveLength(0)
    expect(SERVICES.route53.global).toBe(true)
    expect(SERVICES.cloudfront.global).toBe(true)
    expect(SERVICES.alb.global).toBeUndefined()
  })
})

// ---------------------------------------------------------------- Data: The Feed

describe('Data: The Feed (the-feed)', () => {
  const sc = getScenario('the-feed')

  /** ALB → Fargate → one primary + N read replicas. */
  const design = (replicas: number, compute = 'fargate') => {
    const nodes = [N('users', 'users'), N('lb', 'alb'), N('app', compute), N('rds', 'rds')]
    const edges = [E('users', 'lb'), E('lb', 'app'), E('app', 'rds')]
    for (let i = 1; i <= replicas; i++) {
      nodes.push(N(`rr-${i}`, 'rds-replica'))
      edges.push(E('app', `rr-${i}`))
    }
    return { nodes, edges }
  }

  it('splits traffic 10/90: the primary takes only the writes', () => {
    const { nodes, edges } = design(4)
    const s = steady(nodes, edges, 1000, sc.id).stats
    expect(s.nodeLoads['rds'].processed).toBeCloseTo(100, 5)
    // 900 reads spread evenly over four replicas.
    for (let i = 1; i <= 4; i++) expect(s.nodeLoads[`rr-${i}`].processed).toBeCloseTo(225, 5)
    expect(rate(s)).toBeGreaterThan(0.99)
  })

  it('four replicas carry the spike at $280/mo', () => {
    const { nodes, edges } = design(4)
    const base = steady(nodes, edges, sc.baselineRps, sc.id).stats
    expect(rate(base)).toBeGreaterThan(0.99)
    expect(rate(steady(nodes, edges, sc.spikeRps, sc.id).stats)).toBeGreaterThan(0.99)
    const cost = estimateMonthlyCost(nodes, base.nodeLoads)
    expect(cost).toBe(280)
    expect(cost).toBeLessThanOrEqual(sc.budget)
    expect(securityAudit(nodes, edges)).toHaveLength(0)
    expect(blueprintMissing(sc.requiredServices, nodes, base.nodeLoads)).toHaveLength(0)
  })

  it('three replicas look fine at baseline and miss the bar at the spike', () => {
    const { nodes, edges } = design(3)
    expect(rate(steady(nodes, edges, sc.baselineRps, sc.id).stats)).toBeGreaterThan(0.99)
    const spike = steady(nodes, edges, sc.spikeRps, sc.id).stats
    expect(rate(spike)).toBeCloseTo(0.85, 2)
    expect(rate(spike)).toBeLessThan(0.95)
    expect(spike.issues).toContain('overloaded:RDS Replica')
  })

  it('a lone primary is crushed by reads — the problem the level poses', () => {
    const { nodes, edges } = design(0)
    const spike = steady(nodes, edges, sc.spikeRps, sc.id).stats
    expect(rate(spike)).toBeCloseTo(0.25, 2)
    expect(spike.issues).toContain('overloaded:RDS')
  })

  it('replicas without a primary serve nothing, and lose every write', () => {
    const nodes = [N('users', 'users'), N('lb', 'alb'), N('app', 'fargate'), N('rr-1', 'rds-replica')]
    const edges = [E('users', 'lb'), E('lb', 'app'), E('app', 'rr-1')]
    const s = steady(nodes, edges, sc.baselineRps, sc.id).stats
    expect(rate(s)).toBe(0)
    expect(s.issues).toContain('replica-no-primary')
    expect(s.issues).toContain('writes-need-primary')
  })

  it('serving the reads off extra primaries works but fails the blueprint', () => {
    const nodes = [N('users', 'users'), N('lb', 'alb'), N('app', 'fargate')]
    const edges = [E('users', 'lb'), E('lb', 'app')]
    for (let i = 1; i <= 4; i++) {
      nodes.push(N(`db-${i}`, 'rds'))
      edges.push(E('app', `db-${i}`))
    }
    const base = steady(nodes, edges, sc.baselineRps, sc.id).stats
    // It does carry the traffic — the engine models neither the write conflicts
    // nor the sharding you would actually need, so the level rules it out by
    // requiring a replica rather than by melting it.
    expect(rate(steady(nodes, edges, sc.spikeRps, sc.id).stats)).toBeGreaterThan(0.99)
    expect(estimateMonthlyCost(nodes, base.nodeLoads)).toBeGreaterThan(280)
    expect(blueprintMissing(sc.requiredServices, nodes, base.nodeLoads)).toEqual(['rds-replica'])
  })

  it('the read/write split stays off in every other scenario', () => {
    // photo-app has no writeFraction, so a replica there is just another store.
    const nodes = [N('users', 'users'), N('gw', 'apigw'), N('fn', 'lambda'), N('rds', 'rds'), N('rr', 'rds-replica')]
    const edges = [E('users', 'gw'), E('gw', 'fn'), E('fn', 'rds'), E('fn', 'rr')]
    const s = steady(nodes, edges, 200, 'photo-app').stats
    expect(s.nodeLoads['rds'].processed).toBeCloseTo(100, 5)
    expect(s.nodeLoads['rr'].processed).toBeCloseTo(100, 5)
  })

  it('saturation advice avoids the cache the level bans', () => {
    const tips = tipsForIssues(['db-overloaded', 'overloaded:RDS'], { writeSplit: true })
    expect(tips.join(' ')).not.toContain('ElastiCache')
    expect(tips.join(' ')).toContain('replica')
    // ...and the stock advice is untouched everywhere else.
    expect(tipsForIssues(['db-overloaded']).join(' ')).toContain('ElastiCache')
  })
})

// -------------------------------------------------- Event-Driven: Trivia Night

describe('Event-Driven: Trivia Night (trivia-night)', () => {
  const sc = getScenario('trivia-night')
  const design = (compute: string) => ({
    nodes: [N('users', 'users'), N('gw', 'apigw'), N('fn', compute), N('db', 'dynamodb')],
    edges: [E('users', 'gw'), E('gw', 'fn'), E('fn', 'db')],
  })

  /** Replay the burst square wave the store generates for the spike phase. */
  function burstRun(compute: string, cycles = 4) {
    const { nodes, edges } = design(compute)
    const { onTicks, offTicks } = sc.bursts!
    let warm: Record<string, number> = {}
    let served = 0
    let total = 0
    const perTick: number[] = []
    for (let c = 0; c < cycles; c++) {
      for (let t = 0; t < onTicks + offTicks; t++) {
        const rps = t < onTicks ? sc.spikeRps : sc.baselineRps
        const s = simulateTick(nodes, edges, rps, sc, {}, {}, warm)
        warm = s.warmCapacity
        // Skip the first cycle: the store's scoring window opens after it too.
        if (c > 0) {
          served += s.served
          total += s.total
          perTick.push(s.total > 0 ? s.served / s.total : 1)
        }
      }
    }
    return { rate: total > 0 ? served / total : 1, perTick, warm }
  }

  it('provisioned concurrency takes the whole burst, at $103/mo', () => {
    const { nodes, edges } = design('lambda-pc')
    const base = steady(nodes, edges, sc.baselineRps, sc.id).stats
    expect(rate(base)).toBeGreaterThan(0.99)
    const cost = estimateMonthlyCost(nodes, base.nodeLoads)
    expect(cost).toBe(103)
    expect(cost).toBeLessThanOrEqual(sc.budget)
    expect(burstRun('lambda-pc').rate).toBeGreaterThan(0.99)
    expect(securityAudit(nodes, edges)).toHaveLength(0)
    expect(blueprintMissing(sc.requiredServices, nodes, base.nodeLoads)).toHaveLength(0)
  })

  it('plain Lambda is cheaper, handles the baseline, and still misses the bar', () => {
    const { nodes, edges } = design('lambda')
    const base = steady(nodes, edges, sc.baselineRps, sc.id).stats
    expect(rate(base)).toBeGreaterThan(0.99)
    expect(estimateMonthlyCost(nodes, base.nodeLoads)).toBeLessThan(103)
    const r = burstRun('lambda')
    expect(r.rate).toBeLessThan(0.95)
    expect(r.rate).toBeGreaterThan(0.8) // it mostly works — that is what makes it a trap
  })

  it('every burst reopens cold, because warmth drains while idle', () => {
    const r = burstRun('lambda')
    const { onTicks, offTicks } = sc.bursts!
    const cycle = onTicks + offTicks
    // The first tick of each scored burst is the worst one, every single time.
    for (let c = 0; c * cycle < r.perTick.length; c++) {
      const first = r.perTick[c * cycle]
      const last = r.perTick[c * cycle + onTicks - 1]
      expect(first).toBeLessThan(0.8)
      expect(last).toBeGreaterThan(0.99)
    }
  })

  it('a ramped spike would hide the whole problem — the square wave is the mechanic', () => {
    const { nodes, edges } = design('lambda')
    // steady() feeds a constant load, which is a function that never goes cold.
    expect(rate(steady(nodes, edges, sc.spikeRps, sc.id).stats)).toBeGreaterThan(0.99)
  })

  it('warm capacity decays toward the floor, and never below it', () => {
    const { nodes, edges } = design('lambda')
    let warm: Record<string, number> = {}
    for (let i = 0; i < 3; i++) {
      warm = simulateTick(nodes, edges, sc.spikeRps, sc, {}, {}, warm).warmCapacity
    }
    const hot = warm['fn']
    expect(hot).toBeGreaterThan(1000)
    for (let i = 0; i < 30; i++) {
      warm = simulateTick(nodes, edges, 0, sc, {}, {}, warm).warmCapacity
    }
    expect(warm['fn']).toBeLessThan(hot)
    expect(warm['fn']).toBe(200) // the ambient floor, not zero
  })

  it('neither fixed fleet can reach 2,500 rps at all', () => {
    for (const compute of ['asg', 'fargate']) {
      const { nodes, edges } = design(compute)
      const s = steady(nodes, edges, sc.spikeRps, sc.id)
      expect(rate(s.stats)).toBeLessThan(0.95)
      expect(s.stats.issues).toContain(`overloaded:${SERVICES[compute].name}`)
    }
  })

  it('cold starts stay off in every scenario that has not asked for them', () => {
    const { nodes, edges } = design('lambda')
    // order-storm shares the compute chain but declares no coldStarts.
    const s = simulateTick(nodes, edges, 5000, getScenario('order-storm'), {}, {}, {})
    expect(s.issues).not.toContain('cold-start')
    expect(s.nodeLoads['fn'].processed).toBeCloseTo(5000, 5)
  })
})

// ------------------------------------------------------------ Day 2: Game Day

describe('Day 2: Game Day (game-day)', () => {
  const sc = getScenario('game-day')

  it('the capacity modifier scales the compute tier and nothing else', () => {
    const nodes = [N('users', 'users'), N('lb', 'alb'), N('c', 'ec2'), N('db', 'rds')]
    const edges = [E('users', 'lb'), E('lb', 'c'), E('c', 'db')]
    const plain = simulateTick(nodes, edges, 600, sc, {}, {}, {})
    const boosted = simulateTick(nodes, edges, 600, sc, {}, {}, {}, { computeCapacityFactor: 4 })
    expect(plain.nodeLoads['c'].capacity).toBe(150)
    expect(boosted.nodeLoads['c'].capacity).toBe(600)
    // The database ceiling is not something you can buy your way past.
    expect(boosted.nodeLoads['db'].capacity).toBe(SERVICES.rds.capacity)
  })

  it('scales an elastic fleet on top of its own scaling', () => {
    const nodes = [N('users', 'users'), N('lb', 'alb'), N('c', 'fargate'), N('db', 'dynamodb')]
    const edges = [E('users', 'lb'), E('lb', 'c'), E('c', 'db')]
    const halved = simulateTick(nodes, edges, 500, sc, { c: 5 }, {}, {}, { computeCapacityFactor: 0.5 })
    expect(halved.nodeLoads['c'].capacity).toBe(250) // 5 tasks × 100 × 0.5
  })

  it('every incident is scheduled inside a phase the run actually reaches', () => {
    const lengths: Record<string, number> = { baseline: 24, spike: 26, recovery: 6, probe: 12 }
    for (const d of sc.decisions ?? []) {
      expect(lengths[d.phase], `${d.id} targets a phase this scenario never runs`).toBeDefined()
      expect(d.tick).toBeLessThan(lengths[d.phase])
      // The runbook default has to be the survivable one — an unattended run
      // must still reflect the design rather than the inattention.
      expect(d.options[d.defaultIndex].surcharge ?? 0).toBe(0)
    }
  })

  it('decision ids are unique, so each incident fires exactly once', () => {
    const ids = (sc.decisions ?? []).map((d) => d.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})
