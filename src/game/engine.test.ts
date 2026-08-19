// Balance tests: every level's intended solution must earn its stars, and the
// classic wrong designs must fail the way the level intends. If a tuning change
// breaks one of these, a level has silently become impossible or trivial.

import { describe, it, expect } from 'vitest'
import {
  simulateTick,
  estimateMonthlyCost,
  securityAudit,
  blueprintMissing,
  nextAsgCount,
  ASG_MIN,
  type LiteNode,
  type LiteEdge,
  type TickStats,
} from './engine'
import { getScenario } from './scenarios'

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
  for (const n of nodes) if (n.serviceId === 'asg') asg[n.id] = ASG_MIN
  let backlogs: Record<string, number> = {}
  let stats = simulateTick(effective, edges, rps, scenario, asg, backlogs)
  backlogs = stats.queueBacklogs
  for (let i = 0; i < 30; i++) {
    for (const id of Object.keys(asg)) asg[id] = nextAsgCount(asg[id], stats.nodeLoads[id]?.inRps ?? 0)
    stats = simulateTick(effective, edges, rps, scenario, asg, backlogs)
    backlogs = stats.queueBacklogs
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
  for (const n of nodes) if (n.serviceId === 'asg') asg[n.id] = ASG_MIN
  let backlogs: Record<string, number> = {}
  let served = 0
  let dropped = 0
  let total = 0
  let prev: TickStats | null = null
  for (const rps of rpsPerTick) {
    if (prev) {
      for (const id of Object.keys(asg)) asg[id] = nextAsgCount(asg[id], prev.nodeLoads[id]?.inRps ?? 0)
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
    expect(nextAsgCount(2, 1400)).toBe(4)
    expect(nextAsgCount(4, 1400)).toBe(6)
    expect(nextAsgCount(8, 1400)).toBe(10)
  })
  it('caps at 10 and floors at the minimum', () => {
    expect(nextAsgCount(10, 99999)).toBe(10)
    expect(nextAsgCount(2, 0)).toBe(ASG_MIN)
  })
  it('scales down one instance at a time', () => {
    expect(nextAsgCount(10, 100)).toBe(9)
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
