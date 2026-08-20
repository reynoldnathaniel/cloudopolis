// The simulation engine. Pure functions, no React, no rendering.
// Each tick pushes `rps` requests from the Users node through the drawn
// graph. Every request is served, dropped, or (new) absorbed into a queue
// backlog to be drained on a later tick.
//
// Health model: routers, compute, caches, and queues health-check their
// targets and route around dead or unplaced nodes. Users do not (DNS is
// dumb) — traffic sent directly to a dead node is lost, which is why load
// balancers exist.

import { SERVICES } from './services'
import type { Scenario } from './scenarios'

export interface LiteNode {
  id: string
  serviceId: string
  /** Which Availability Zone this node lives in (zonal services only) */
  az?: 'a' | 'b' | null
  /** Killed by the AZ outage this tick */
  dead?: boolean
  /** Zonal service not placed in any AZ (invalid in VPC levels) */
  unplaced?: boolean
}

export interface LiteEdge {
  id: string
  source: string
  target: string
}

export interface NodeLoad {
  inRps: number
  processed: number
  capacity: number
  util: number
  /** Elastic fleets only (ASG / Fargate): units currently running */
  instances?: number
  /** Queues only: events waiting in the backlog after this tick */
  backlog?: number
}

export interface TickStats {
  nodeLoads: Record<string, NodeLoad>
  edgeFlows: Record<string, number>
  served: number
  dropped: number
  /** rps plus any fan-out copies emitted this tick */
  total: number
  /** Updated queue backlogs — feed these into the next tick */
  queueBacklogs: Record<string, number>
  issues: string[]
}

const CACHE_RATIO_STATIC = 0.8
const CACHE_RATIO_APP = 0.3
const CACHE_HIT_RATIO = 0.7

// Elastic fleets (ASG instances, Fargate tasks). Each service declares its own
// numbers in `services.ts`; the difference in `rate` is what makes containers
// feel different from VMs.

/** Fleet size a service starts at, or 0 for services that aren't fleets. */
export const fleetMin = (serviceId: string): number => SERVICES[serviceId]?.scaling?.min ?? 0

/** Move a fleet one tick toward what its observed load demands. */
export function nextFleetCount(serviceId: string, current: number, observedLoad: number): number {
  const s = SERVICES[serviceId]?.scaling
  if (!s) return current
  const desired = Math.max(s.min, Math.min(s.max, Math.ceil(observedLoad / s.perUnit)))
  // Scaling up is capped by how fast units start; scaling down is unhurried.
  if (desired > current) return Math.min(desired, current + s.rate)
  if (desired < current) return Math.max(desired, current - 1)
  return current
}

export function simulateTick(
  nodes: LiteNode[],
  edges: LiteEdge[],
  rps: number,
  scenario: Scenario,
  fleetCounts: Record<string, number> = {},
  queueBacklogs: Record<string, number> = {},
): TickStats {
  const nodeById = new Map(nodes.map((n) => [n.id, n]))
  const out = new Map<string, LiteEdge[]>()
  const indeg = new Map<string, number>()
  for (const n of nodes) {
    out.set(n.id, [])
    indeg.set(n.id, 0)
  }

  for (const e of edges) {
    const s = nodeById.get(e.source)
    const t = nodeById.get(e.target)
    if (!s || !t) continue
    // Databases, models, and S3 are terminal in this model: outgoing edges are inert.
    const role = SERVICES[s.serviceId].role
    if (role === 'db' || role === 'origin-static') continue
    out.get(e.source)!.push(e)
    indeg.set(e.target, (indeg.get(e.target) ?? 0) + 1)
  }

  const inLoad: Record<string, number> = {}
  // Traffic that arrived from the app tier (compute or cache) — the only
  // traffic a database, model, or cache will accept.
  const appIn: Record<string, number> = {}
  for (const n of nodes) {
    inLoad[n.id] = 0
    appIn[n.id] = 0
  }

  const nodeLoads: Record<string, NodeLoad> = {}
  const edgeFlows: Record<string, number> = {}
  const newBacklogs: Record<string, number> = {}
  const issues = new Set<string>()
  let served = 0
  let dropped = 0
  let extraTotal = 0

  const users = nodes.find((n) => n.serviceId === 'users')
  if (!users) {
    return {
      nodeLoads,
      edgeFlows,
      served: 0,
      dropped: rps,
      total: rps,
      queueBacklogs: { ...queueBacklogs },
      issues: ['users-disconnected'],
    }
  }
  inLoad[users.id] = rps

  const isOffline = (id: string): boolean => {
    const n = nodeById.get(id)
    return n !== undefined && (n.dead === true || n.unplaced === true)
  }

  const effectiveCapacity = (n: LiteNode): number => {
    const scaling = SERVICES[n.serviceId].scaling
    if (scaling) return (fleetCounts[n.id] ?? scaling.min) * scaling.perUnit
    return SERVICES[n.serviceId].capacity
  }

  for (const n of nodes) {
    if (n.unplaced) issues.add('needs-az')
  }

  const queue: string[] = nodes.filter((n) => (indeg.get(n.id) ?? 0) === 0).map((n) => n.id)
  const done = new Set<string>()

  const forward = (amount: number, targets: LiteEdge[], fromApp: boolean) => {
    if (targets.length === 0 || amount <= 0) return false
    const share = amount / targets.length
    for (const e of targets) {
      edgeFlows[e.id] = (edgeFlows[e.id] ?? 0) + share
      inLoad[e.target] += share
      if (fromApp) appIn[e.target] += share
    }
    return true
  }

  while (queue.length > 0) {
    const id = queue.shift()!
    if (done.has(id)) continue
    done.add(id)

    const node = nodeById.get(id)!
    const def = SERVICES[node.serviceId]
    const L = inLoad[id]
    const outs = out.get(id) ?? []
    const healthyOuts = outs.filter((e) => !isOffline(e.target))

    // A dead or unplaced node serves nothing: everything sent to it is lost.
    if (isOffline(id)) {
      if (L > 1) {
        dropped += L
        issues.add(node.dead ? 'hit-dead-node' : 'needs-az')
      }
      nodeLoads[id] = { inRps: L, processed: 0, capacity: def.capacity, util: 0 }
      for (const e of outs) {
        const next = (indeg.get(e.target) ?? 1) - 1
        indeg.set(e.target, next)
        if (next <= 0 && !done.has(e.target)) queue.push(e.target)
      }
      continue
    }

    switch (def.role) {
      case 'client': {
        // Users spray traffic across every connection — no health checks at DNS level.
        if (L > 0 && !forward(L, outs, false)) {
          dropped += L
          issues.add('users-disconnected')
        }
        nodeLoads[id] = { inRps: L, processed: L, capacity: Infinity, util: 0 }
        break
      }
      case 'cdn': {
        const p = Math.min(L, def.capacity)
        const over = L - p
        dropped += over
        if (over > 1) issues.add(`overloaded:${def.name}`)
        if (outs.length === 0) {
          if (p > 0) {
            dropped += p
            issues.add('cdn-no-origin')
          }
        } else if (healthyOuts.length === 0) {
          if (p > 0) {
            dropped += p
            issues.add('all-targets-dead')
          }
        } else {
          const cache = scenario.need === 'static' ? CACHE_RATIO_STATIC : CACHE_RATIO_APP
          served += p * cache
          forward(p * (1 - cache), healthyOuts, false)
        }
        nodeLoads[id] = { inRps: L, processed: p, capacity: def.capacity, util: L / def.capacity }
        break
      }
      case 'router': {
        const p = Math.min(L, def.capacity)
        const over = L - p
        dropped += over
        if (over > 1) issues.add(`overloaded:${def.name}`)
        if (p > 0) {
          if (outs.length === 0) {
            dropped += p
            issues.add('router-no-targets')
          } else if (!forward(p, healthyOuts, false)) {
            dropped += p
            issues.add('all-targets-dead')
          }
        }
        nodeLoads[id] = { inRps: L, processed: p, capacity: def.capacity, util: L / def.capacity }
        break
      }
      case 'fanout': {
        // Pub/sub: every healthy subscriber gets its own full copy of each event.
        const p = Math.min(L, def.capacity)
        const over = L - p
        dropped += over
        if (over > 1) issues.add(`overloaded:${def.name}`)
        const subs = healthyOuts.filter((e) => {
          const t = nodeById.get(e.target)
          if (!t) return false
          const r = SERVICES[t.serviceId].role
          return r === 'queue' || r === 'compute'
        })
        if (p > 0) {
          if (subs.length === 0) {
            dropped += p
            issues.add('fanout-no-subscribers')
          } else {
            extraTotal += p * (subs.length - 1)
            for (const e of subs) {
              edgeFlows[e.id] = (edgeFlows[e.id] ?? 0) + p
              inLoad[e.target] += p
            }
          }
        }
        nodeLoads[id] = { inRps: L, processed: p, capacity: def.capacity, util: L / def.capacity }
        break
      }
      case 'queue': {
        // Bursts become backlog, not loss. Consumers drain at their capacity.
        const accepted = Math.min(L, def.capacity)
        const throttled = L - accepted
        dropped += throttled
        if (throttled > 1) issues.add(`overloaded:${def.name}`)

        const backlog = queueBacklogs[id] ?? 0
        const available = backlog + accepted

        const consumers = healthyOuts.filter((e) => {
          const t = nodeById.get(e.target)
          return t !== undefined && SERVICES[t.serviceId].role === 'compute'
        })
        let drained = 0
        if (consumers.length === 0) {
          if (accepted > 0) issues.add('queue-no-consumers')
        } else {
          const caps = consumers.map((e) => effectiveCapacity(nodeById.get(e.target)!))
          const capSum = caps.reduce((a, b) => a + b, 0)
          drained = Math.min(available, capSum)
          if (drained > 0 && capSum > 0) {
            consumers.forEach((e, i) => {
              const share = (drained * caps[i]) / capSum
              edgeFlows[e.id] = (edgeFlows[e.id] ?? 0) + share
              inLoad[e.target] += share
            })
          }
        }

        let remaining = available - drained
        const buffer = def.bufferSize ?? 0
        if (remaining > buffer) {
          dropped += remaining - buffer
          issues.add('queue-overflow')
          remaining = buffer
        }
        newBacklogs[id] = remaining

        nodeLoads[id] = {
          inRps: L,
          processed: drained,
          capacity: def.capacity,
          util: L / def.capacity,
          backlog: remaining,
        }
        break
      }
      case 'origin-static': {
        const p = Math.min(L, def.capacity)
        const over = L - p
        dropped += over
        if (over > 1) issues.add(`overloaded:${def.name}`)
        if (scenario.need === 'static') {
          served += p
        } else if (p > 0) {
          dropped += p
          issues.add('static-cant-dynamic')
        }
        nodeLoads[id] = { inRps: L, processed: p, capacity: def.capacity, util: L / def.capacity }
        break
      }
      case 'compute': {
        const cap = effectiveCapacity(node)
        const instances = def.scaling ? (fleetCounts[id] ?? def.scaling.min) : undefined
        const p = Math.min(L, cap)
        const over = L - p
        dropped += over
        if (over > 1) issues.add(`overloaded:${def.name}`)
        if (scenario.need === 'app') {
          const appTargets = outs.filter((e) => {
            const t = nodeById.get(e.target)
            if (!t) return false
            const r = SERVICES[t.serviceId].role
            return r === 'db' || r === 'cache' || r === 'retriever'
          })
          const healthyApp = appTargets.filter((e) => !isOffline(e.target))
          if (p > 0) {
            if (appTargets.length === 0) {
              dropped += p
              issues.add('compute-no-db')
            } else if (healthyApp.length === 0) {
              dropped += p
              issues.add('db-unavailable')
            } else {
              forward(p, healthyApp, true)
            }
          }
        } else {
          // In a static scenario a web server can serve files directly.
          served += p
        }
        nodeLoads[id] = { inRps: L, processed: p, capacity: cap, util: L / cap, instances }
        break
      }
      case 'cache': {
        const legit = Math.min(appIn[id], L)
        const direct = L - legit
        if (direct > 1) {
          dropped += direct
          issues.add('cache-direct')
        }
        const p = Math.min(legit, def.capacity)
        const over = legit - p
        dropped += over
        if (over > 1) issues.add(`overloaded:${def.name}`)
        if (p > 0) {
          served += p * CACHE_HIT_RATIO
          const misses = p * (1 - CACHE_HIT_RATIO)
          const dbTargets = outs.filter((e) => {
            const t = nodeById.get(e.target)
            if (t === undefined) return false
            const r = SERVICES[t.serviceId].role
            return r === 'db' || r === 'retriever'
          })
          const healthyDb = dbTargets.filter((e) => !isOffline(e.target))
          if (dbTargets.length === 0) {
            dropped += misses
            issues.add('cache-no-db')
          } else if (healthyDb.length === 0) {
            dropped += misses
            issues.add('db-unavailable')
          } else {
            forward(misses, healthyDb, true)
          }
        }
        nodeLoads[id] = { inRps: L, processed: p, capacity: def.capacity, util: legit / def.capacity, }
        break
      }
      case 'retriever': {
        // A pure mid-chain stage: it answers nothing itself, it *grounds* the
        // request and hands the whole thing on. Retrieve-then-generate — the
        // request only counts as served once the model behind it responds.
        const legit = Math.min(appIn[id], L)
        const direct = L - legit
        if (direct > 1) {
          dropped += direct
          issues.add('db-direct-access')
        }
        const p = Math.min(legit, def.capacity)
        const over = legit - p
        dropped += over
        if (over > 1) issues.add(`overloaded:${def.name}`)
        if (p > 0) {
          const modelTargets = outs.filter((e) => {
            const t = nodeById.get(e.target)
            return t !== undefined && SERVICES[t.serviceId].role === 'db'
          })
          const healthyModels = modelTargets.filter((e) => !isOffline(e.target))
          if (modelTargets.length === 0) {
            dropped += p
            issues.add('retriever-no-model')
          } else if (healthyModels.length === 0) {
            dropped += p
            issues.add('db-unavailable')
          } else {
            // Everything retrieved goes on to be generated — no hit ratio here.
            forward(p, healthyModels, true)
          }
        }
        nodeLoads[id] = {
          inRps: L,
          processed: p,
          capacity: def.capacity,
          util: legit / def.capacity,
        }
        break
      }
      case 'db': {
        const legit = Math.min(appIn[id], L)
        const direct = L - legit
        if (direct > 1) {
          dropped += direct
          issues.add('db-direct-access')
        }
        const p = Math.min(legit, def.capacity)
        const over = legit - p
        if (over > 1) {
          dropped += over
          issues.add(`overloaded:${def.name}`)
          if (node.serviceId !== 'bedrock' && node.serviceId !== 'sagemaker') issues.add('db-overloaded')
        } else {
          dropped += over
        }
        served += p
        nodeLoads[id] = { inRps: L, processed: p, capacity: def.capacity, util: legit / def.capacity }
        break
      }
    }

    for (const e of outs) {
      const next = (indeg.get(e.target) ?? 1) - 1
      indeg.set(e.target, next)
      if (next <= 0 && !done.has(e.target)) queue.push(e.target)
    }
  }

  // Nodes stranded by a cycle: report them idle rather than crash.
  for (const n of nodes) {
    if (!nodeLoads[n.id]) {
      const def = SERVICES[n.serviceId]
      nodeLoads[n.id] = { inRps: 0, processed: 0, capacity: def.capacity, util: 0 }
      if (def.role === 'queue') newBacklogs[n.id] = queueBacklogs[n.id] ?? 0
    }
  }

  return {
    nodeLoads,
    edgeFlows,
    served,
    dropped,
    total: rps + extraTotal,
    queueBacklogs: newBacklogs,
    issues: [...issues],
  }
}

/** Monthly cost estimate: fixed costs plus usage-based costs at the given per-node load. */
export function estimateMonthlyCost(nodes: LiteNode[], nodeLoads?: Record<string, NodeLoad>): number {
  let cost = 0
  for (const n of nodes) {
    const def = SERVICES[n.serviceId]
    if (def.scaling) {
      cost += (nodeLoads?.[n.id]?.instances ?? def.scaling.min) * def.scaling.costPerUnit
      continue
    }
    cost += def.monthlyCost
    if (def.costPerRps > 0 && nodeLoads) {
      cost += def.costPerRps * (nodeLoads[n.id]?.processed ?? 0)
    }
  }
  return Math.round(cost)
}

/** Which required services are missing from the design, or present but carrying no traffic. */
export function blueprintMissing(
  required: string[] | undefined,
  nodes: LiteNode[],
  nodeLoads: Record<string, NodeLoad>,
): string[] {
  if (!required || required.length === 0) return []
  return required.filter(
    (serviceId) =>
      !nodes.some((n) => n.serviceId === serviceId && (nodeLoads[n.id]?.processed ?? 0) > 0.5),
  )
}

export interface SecurityFinding {
  nodeId: string
  label: string
  tip: string
}

/**
 * The security probe: static analysis of the design. Users may only connect to
 * edge-safe services (CloudFront, ALB, API Gateway — and Kinesis, whose ingest
 * is IAM-authenticated). A direct edge from Users to anything else means that
 * resource is exposed to the raw internet.
 */
export function securityAudit(nodes: LiteNode[], edges: LiteEdge[]): SecurityFinding[] {
  const nodeById = new Map(nodes.map((n) => [n.id, n]))
  const users = nodes.find((n) => n.serviceId === 'users')
  if (!users) return []

  const findings: SecurityFinding[] = []
  for (const e of edges) {
    if (e.source !== users.id) continue
    const target = nodeById.get(e.target)
    if (!target) continue
    const def = SERVICES[target.serviceId]
    if (def.edgeSafe) continue

    if (def.role === 'origin-static') {
      findings.push({
        nodeId: target.id,
        label: 'Public S3 bucket',
        tip: 'Your S3 bucket is open to the raw internet — the classic public-bucket mistake. Serve it through CloudFront (with Origin Access Control) and block public access.',
      })
    } else if (def.role === 'db' || def.role === 'cache' || def.role === 'retriever') {
      findings.push({
        nodeId: target.id,
        label: `${def.name} exposed to the internet`,
        tip: `${def.name} is directly reachable from the internet. Databases, caches, and model endpoints belong behind your app tier.`,
      })
    } else if (def.role === 'queue' || def.role === 'fanout') {
      findings.push({
        nodeId: target.id,
        label: `${def.name} exposed to the internet`,
        tip: `${def.name} is taking events straight from the internet with no authenticated front door. Put API Gateway in front (Kinesis is the exception — its ingest is IAM-authenticated).`,
      })
    } else {
      findings.push({
        nodeId: target.id,
        label: `${def.name} directly internet-facing`,
        tip: `${def.name} takes raw internet traffic with nothing in front of it. Put an ALB or API Gateway in front — that's where TLS, health checks, and WAF live.`,
      })
    }
  }
  return findings
}

export const ISSUE_TIPS: Record<string, string> = {
  'users-disconnected': 'Users are not connected to anything — traffic has nowhere to go.',
  'cdn-no-origin': 'CloudFront has no origin. Connect it to S3 (or your app tier) so it has somewhere to fetch content from.',
  'router-no-targets': 'Your load balancer / API Gateway forwards to nothing. Connect it to a compute tier.',
  'static-cant-dynamic': 'S3 can only serve files — it cannot run application logic. This app needs a compute tier (EC2 or Lambda).',
  'compute-no-db': 'Your compute tier has no database or model behind it, so dynamic requests are failing. Connect it onward.',
  'db-overloaded': 'Your database saturated. Put ElastiCache in front to absorb reads, or spread the load across more databases.',
  'db-direct-access': 'Users cannot query a database or model directly. Put a compute tier (EC2 or Lambda) in front of it.',
  'cache-direct': 'A cache sits behind your compute tier, not in front of it. Route traffic compute → cache → database.',
  'cache-no-db': 'A cache needs somewhere to send its misses. Connect it onward to a database or model.',
  'retriever-no-model':
    'Retrieval without generation answers nothing. A vector store grounds the request — connect it onward to the model that writes the answer.',
  'needs-az': 'Zonal services (EC2, RDS, ElastiCache) must be placed inside an Availability Zone box.',
  'hit-dead-node': 'Traffic was sent straight to resources in the failed AZ and was lost. A load balancer health-checks and routes around zone failures.',
  'db-unavailable': 'Everything your app tier depends on lived in the failed AZ. Keep a standby (database, cache) in a second zone.',
  'all-targets-dead': 'Everything behind your router lived in the failed AZ. Spread instances across both zones.',
  'fanout-no-subscribers': 'SNS published into the void — no queues or functions are subscribed to it.',
  'queue-no-consumers': 'Your queue has no consumers. Messages are piling up with nothing draining them — connect a compute tier.',
  'queue-overflow': 'The queue backlog overflowed its buffer and events were lost. Add consumer capacity so it drains faster.',
}

const OVERLOAD_TIPS: Record<string, string> = {
  'Auto Scaling':
    'Auto Scaling briefly saturated while new instances booted — scaling is not instant. A higher minimum size absorbs sharper spikes.',
  Bedrock:
    'Bedrock throttled at its 150 RPS on-demand quota. Put ElastiCache in front as a semantic cache — repeated prompts never reach the model.',
  Kinesis:
    'Kinesis throttled writes above its 5,000 rec/s stream capacity. In real AWS you would add shards.',
  SageMaker:
    'Your SageMaker endpoint saturated at 2,000 predictions/s. Provisioned inference has a hard ceiling.',
}

export function tipsForIssues(issues: string[]): string[] {
  const tips: string[] = []
  for (const issue of issues) {
    if (issue.startsWith('overloaded:')) {
      const name = issue.split(':')[1]
      // Elastic fleets saturate transiently while units start — that's the
      // mechanic working, not a design flaw, so never tell them to "switch to
      // something that auto-scales".
      const def = Object.values(SERVICES).find((s) => s.name === name)
      tips.push(
        OVERLOAD_TIPS[name] ??
          (def?.scaling
            ? `${name} saturated while the fleet was still scaling up — ${def.scaling.unitLabel} take time to start. Raising the minimum absorbs sharper spikes.`
            : `${name} hit 100% utilization and started dropping requests. Add more instances, or switch to a service that auto-scales.`),
      )
    } else if (ISSUE_TIPS[issue]) {
      tips.push(ISSUE_TIPS[issue])
    }
  }
  return [...new Set(tips)]
}
