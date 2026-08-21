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
  /** Killed by the AZ (or, in multi-region scenarios, Region) outage this tick */
  dead?: boolean
  /**
   * Placed in no container it requires — a zonal service outside every AZ box,
   * or, in multi-region scenarios, any regional service outside every Region box.
   * The caller decides; the engine just refuses to run it.
   */
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
  /** Scrubbing services (WAF) only: attack rps dropped here this tick */
  blocked?: number
  /** Object storage only: events written here batched, which cost no requests */
  delivered?: number
  /**
   * Queue consumers only: what the queue actually had waiting for this node,
   * which is more than `inRps` whenever the node is the bottleneck. Scale a
   * fleet on this, never on `inRps` — a queue only ever hands a consumer what
   * it can already take, so a fleet watching its own throughput concludes it is
   * exactly the right size and never grows.
   */
  demand?: number
}

/**
 * Live per-tick inputs the store owns rather than the graph: a mid-run
 * decision's effects, and how hard the design is currently being attacked.
 * Deliberately thin — the engine is told the numbers, never why they changed.
 */
export interface TickModifiers {
  /** Multiplies every compute tier's capacity — emergency capacity, or a leak */
  computeCapacityFactor?: number
  /**
   * Malicious requests per second arriving alongside `rps`, indistinguishable
   * from it. They consume capacity and run up per-request charges exactly like
   * real traffic; they just never count as anyone being served.
   */
  attackRps?: number
}

export interface TickStats {
  nodeLoads: Record<string, NodeLoad>
  edgeFlows: Record<string, number>
  /** Real requests answered. Attack traffic that gets processed is never served. */
  served: number
  /** Real requests lost. Attack traffic that gets dropped is not a loss. */
  dropped: number
  /** rps plus any fan-out copies emitted this tick — real traffic only */
  total: number
  /** Attack rps a scrubbing layer (WAF) threw away before it cost anything */
  blocked: number
  /**
   * Dollars per month of per-request charges run up by the attack this tick.
   * A design that absorbs a flood without dropping a request still invoices
   * you for every one of them — this is the number that makes that visible.
   */
  attackBill: number
  /** Updated queue backlogs — feed these into the next tick */
  queueBacklogs: Record<string, number>
  /** Updated warm capacity per cold-start service — feed these into the next tick */
  warmCapacity: Record<string, number>
  issues: string[]
}

const CACHE_RATIO_STATIC = 0.8
const CACHE_RATIO_APP = 0.3
const CACHE_HIT_RATIO = 0.7

// Cold starts. A serverless function keeps some capacity warm; traffic beyond
// it needs new containers, and starting them is fast but not free. Warm
// capacity climbs quickly toward demand and drains away slowly when the traffic
// stops — which is why a workload that is idle between bursts pays again every
// single burst.
/** rps a plain function keeps warm with no traffic at all */
const COLD_AMBIENT = 200
/** rps of warm capacity gained per tick while climbing */
const COLD_RAMP = 800
/** rps of warm capacity lost per tick while idle */
const COLD_DECAY = 400
/** share of cold-started requests that time out rather than just running slow */
const COLD_TIMEOUT_RATE = 0.5

// Elastic fleets (ASG instances, Fargate tasks). Each service declares its own
// numbers in `services.ts`; the difference in `rate` is what makes containers
// feel different from VMs.

/** Fleet size a service starts at, or 0 for services that aren't fleets. */
export const fleetMin = (serviceId: string): number => SERVICES[serviceId]?.scaling?.min ?? 0

/**
 * What a fleet should size itself against, given last tick's numbers.
 *
 * Behind a queue this MUST be the demand rather than the throughput. A queue
 * hands a consumer only what that consumer can already take, so a fleet reading
 * its own `inRps` sees its own capacity reflected back, concludes it is exactly
 * the right size, and sits at two units while a backlog of hundreds of
 * thousands piles up in front of it.
 */
export const observedLoad = (load: NodeLoad | undefined): number =>
  load === undefined ? 0 : Math.max(load.demand ?? 0, load.inRps)

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
  warmCapacity: Record<string, number> = {},
  modifiers: TickModifiers = {},
): TickStats {
  const computeFactor = modifiers.computeCapacityFactor ?? 1
  const attackRps = modifiers.attackRps ?? 0
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
  // How much of what arrived at each node is the attack. Junk is not tagged in
  // any way your infrastructure can see; this is bookkeeping for the scoreboard.
  const attackIn: Record<string, number> = {}
  // Events handed to a bucket by a delivery stream, already batched — the one
  // kind of traffic a bucket takes without paying its per-request ceiling.
  const storageIn: Record<string, number> = {}
  for (const n of nodes) {
    inLoad[n.id] = 0
    appIn[n.id] = 0
    attackIn[n.id] = 0
    storageIn[n.id] = 0
  }

  const nodeLoads: Record<string, NodeLoad> = {}
  const edgeFlows: Record<string, number> = {}
  const newBacklogs: Record<string, number> = {}
  // What each queue had waiting for a consumer this tick — reported so elastic
  // fleets can scale on the backlog instead of on their own throughput.
  const queueDemand: Record<string, number> = {}
  const newWarm: Record<string, number> = { ...warmCapacity }
  const issues = new Set<string>()
  let served = 0
  let dropped = 0
  let blocked = 0
  let extraTotal = 0

  const users = nodes.find((n) => n.serviceId === 'users')
  if (!users) {
    return {
      nodeLoads,
      edgeFlows,
      served: 0,
      dropped: rps,
      total: rps,
      blocked: 0,
      attackBill: 0,
      queueBacklogs: { ...queueBacklogs },
      warmCapacity: { ...warmCapacity },
      issues: ['users-disconnected'],
    }
  }
  // The flood arrives at the same front door as everyone else.
  inLoad[users.id] = rps + attackRps
  attackIn[users.id] = attackRps

  // The share of what is arriving at the node being processed right now that is
  // junk. Attack traffic is indistinguishable from real traffic once it is past
  // the edge, so every capacity ceiling, cache hit ratio, and fan-out split
  // applies to both in exactly the same proportion — and `served` and `dropped`
  // stay counted in real requests, so success keeps meaning what your users saw.
  let attackFrac = 0
  const serve = (amount: number) => {
    served += amount * (1 - attackFrac)
  }
  const drop = (amount: number) => {
    dropped += amount * (1 - attackFrac)
  }

  const isOffline = (id: string): boolean => {
    const n = nodeById.get(id)
    return n !== undefined && (n.dead === true || n.unplaced === true)
  }

  const effectiveCapacity = (n: LiteNode): number => {
    const svc = SERVICES[n.serviceId]
    const base = svc.scaling
      ? (fleetCounts[n.id] ?? svc.scaling.min) * svc.scaling.perUnit
      : svc.capacity
    // A decision that adds or removes capacity acts on the compute tier only —
    // nobody emergency-provisions their way out of a database ceiling.
    return svc.role === 'compute' ? base * computeFactor : base
  }

  // A read replica is a copy of something. With no primary in the design there
  // is nothing to replicate, so the replicas serve nothing at all.
  const hasRdsPrimary = nodes.some((n) => n.serviceId === 'rds')

  // Same "you didn't put it anywhere" failure, one level of the hierarchy apart.
  const placementIssue = scenario.multiRegion === true ? 'needs-region' : 'needs-az'
  for (const n of nodes) {
    if (n.unplaced) issues.add(placementIssue)
  }

  const queue: string[] = nodes.filter((n) => (indeg.get(n.id) ?? 0) === 0).map((n) => n.id)
  const done = new Set<string>()

  const forward = (amount: number, targets: LiteEdge[], fromApp: boolean) => {
    if (targets.length === 0 || amount <= 0) return false
    const share = amount / targets.length
    const junk = share * attackFrac
    for (const e of targets) {
      edgeFlows[e.id] = (edgeFlows[e.id] ?? 0) + share
      inLoad[e.target] += share
      attackIn[e.target] += junk
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
    attackFrac = L > 0 ? Math.min(1, attackIn[id] / L) : 0
    const outs = out.get(id) ?? []
    const healthyOuts = outs.filter((e) => !isOffline(e.target))

    // A dead or unplaced node serves nothing: everything sent to it is lost.
    if (isOffline(id)) {
      if (L > 1) {
        drop(L)
        issues.add(node.dead ? 'hit-dead-node' : placementIssue)
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
          drop(L)
          issues.add('users-disconnected')
        }
        nodeLoads[id] = { inRps: L, processed: L, capacity: Infinity, util: 0 }
        break
      }
      case 'cdn': {
        const p = Math.min(L, def.capacity)
        const over = L - p
        drop(over)
        if (over > 1) issues.add(`overloaded:${def.name}`)
        if (outs.length === 0) {
          if (p > 0) {
            drop(p)
            issues.add('cdn-no-origin')
          }
        } else if (healthyOuts.length === 0) {
          if (p > 0) {
            drop(p)
            issues.add('all-targets-dead')
          }
        } else {
          const cache = scenario.need === 'static' ? CACHE_RATIO_STATIC : CACHE_RATIO_APP
          serve(p * cache)
          forward(p * (1 - cache), healthyOuts, false)
        }
        nodeLoads[id] = { inRps: L, processed: p, capacity: def.capacity, util: L / def.capacity }
        break
      }
      case 'router': {
        // A scrubbing layer (WAF) inspects what arrives and throws the attack
        // away right here — before it can occupy a task slot or bill a single
        // per-request charge to anything behind it. Everything downstream of
        // this point sees clean traffic, which is the entire value proposition.
        const junk = def.scrubsAttack === true ? attackIn[id] : 0
        if (junk > 0) {
          blocked += junk
          attackFrac = 0
        }
        const arriving = L - junk
        const p = Math.min(arriving, def.capacity)
        const over = arriving - p
        drop(over)
        if (over > 1) issues.add(`overloaded:${def.name}`)
        if (p > 0) {
          if (outs.length === 0) {
            drop(p)
            issues.add('router-no-targets')
          } else if (!forward(p, healthyOuts, false)) {
            drop(p)
            issues.add('all-targets-dead')
          }
        }
        nodeLoads[id] = {
          inRps: L,
          processed: p,
          capacity: def.capacity,
          util: L / def.capacity,
          blocked: def.scrubsAttack === true ? junk : undefined,
        }
        break
      }
      case 'fanout': {
        // Pub/sub: every healthy subscriber gets its own full copy of each
        // event — unless this bus routes by rule, in which case each target
        // gets only the share its rule matched. That difference is the entire
        // argument for an event bus over a broadcast topic.
        const p = Math.min(L, def.capacity)
        const over = L - p
        drop(over)
        if (over > 1) issues.add(`overloaded:${def.name}`)
        const subs = healthyOuts.filter((e) => {
          const t = nodeById.get(e.target)
          if (!t) return false
          const r = SERVICES[t.serviceId].role
          return r === 'queue' || r === 'compute'
        })
        // A bus has no way to write an object. Wiring one straight at a bucket
        // is the mistake a delivery stream exists to fix, so say so rather than
        // silently routing nothing there.
        if (healthyOuts.some((e) => SERVICES[nodeById.get(e.target)!.serviceId].role === 'origin-static')) {
          issues.add('bus-needs-delivery-stream')
        }
        if (p > 0) {
          if (subs.length === 0) {
            drop(p)
            issues.add('fanout-no-subscribers')
          } else {
            // Unlisted targets get a catch-all rule: everything. A plain topic
            // has no rules at all, so every share is 1 and this reduces to the
            // broadcast it has always been.
            const shareFor = (e: LiteEdge) =>
              def.rules === true
                ? (scenario.busRules?.[nodeById.get(e.target)!.serviceId] ?? 1)
                : 1
            let shareSum = 0
            for (const e of subs) {
              const amount = p * shareFor(e)
              shareSum += shareFor(e)
              if (amount <= 0) continue
              edgeFlows[e.id] = (edgeFlows[e.id] ?? 0) + amount
              inLoad[e.target] += amount
              attackIn[e.target] += amount * attackFrac
            }
            // Every delivery the bus made is an event that has to be handled,
            // so it counts toward the total. Broadcasting to three subscribers
            // triples the work; routing 5% of it to one of them does not.
            extraTotal += p * (1 - attackFrac) * (shareSum - 1)

            // A rule with nothing wired to it still fired — those events were
            // routed at a destination that does not exist, and they are gone.
            // Without this you could win by building fewer destinations, since
            // a branch you never drew is a branch that never costs you.
            if (def.rules === true && scenario.busRules) {
              const wired = new Set(subs.map((e) => nodeById.get(e.target)!.serviceId))
              for (const [serviceId, share] of Object.entries(scenario.busRules)) {
                if (share <= 0 || wired.has(serviceId)) continue
                extraTotal += p * (1 - attackFrac) * share
                drop(p * share)
                issues.add('bus-rule-undelivered')
              }
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
        drop(throttled)
        if (throttled > 1) issues.add(`overloaded:${def.name}`)

        const backlog = queueBacklogs[id] ?? 0
        const available = backlog + accepted

        const consumers = healthyOuts.filter((e) => {
          const t = nodeById.get(e.target)
          if (t === undefined) return false
          const r = SERVICES[t.serviceId].role
          // A delivery stream drains into storage as happily as into compute —
          // that is the point of it, there is no function in the path at all.
          return r === 'compute' || (def.deliversToStorage === true && r === 'origin-static')
        })
        let drained = 0
        if (consumers.length === 0) {
          if (accepted > 0) issues.add('queue-no-consumers')
        } else {
          const caps = consumers.map((e) => {
            const t = nodeById.get(e.target)!
            // Delivered events arrive batched: a second of them becomes a
            // handful of writes, so the bucket's request ceiling never binds
            // and it takes everything on offer.
            return SERVICES[t.serviceId].role === 'origin-static'
              ? available
              : effectiveCapacity(t)
          })
          const capSum = caps.reduce((a, b) => a + b, 0)
          drained = Math.min(available, capSum)
          if (capSum > 0) {
            // Tell each consumer what was waiting for it, not just what it got.
            consumers.forEach((e, i) => {
              queueDemand[e.target] = (queueDemand[e.target] ?? 0) + (available * caps[i]) / capSum
            })
          }
          if (drained > 0 && capSum > 0) {
            consumers.forEach((e, i) => {
              const share = (drained * caps[i]) / capSum
              edgeFlows[e.id] = (edgeFlows[e.id] ?? 0) + share
              inLoad[e.target] += share
              // Approximate once a backlog has built up: the queue does not
              // remember which of the messages it is holding were junk. Every
              // scenario that turns the attack on bans buffering outright, so
              // nothing shipped ever drains a mixed backlog.
              attackIn[e.target] += share * attackFrac
              if (SERVICES[nodeById.get(e.target)!.serviceId].role === 'origin-static') {
                storageIn[e.target] += share
              }
            })
          }
        }

        let remaining = available - drained
        const buffer = def.bufferSize ?? 0
        if (remaining > buffer) {
          drop(remaining - buffer)
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
        // Batched deliveries bypass the request ceiling entirely; everything
        // else — page requests, or one PUT per event from a function — pays it.
        const delivered = Math.min(storageIn[id], L)
        serve(delivered)
        const direct = L - delivered
        const p = Math.min(direct, def.capacity)
        const over = direct - p
        drop(over)
        if (over > 1) issues.add(`overloaded:${def.name}`)
        // In an async pipeline a bucket is somewhere events are archived, not
        // somewhere pages are rendered — so it answers for them.
        if (scenario.need === 'static' || scenario.async === true) {
          serve(p)
        } else if (p > 0) {
          drop(p)
          issues.add('static-cant-dynamic')
        }
        nodeLoads[id] = {
          inRps: L,
          processed: delivered + p,
          capacity: def.capacity,
          util: direct / def.capacity,
          delivered: delivered > 0 ? delivered : undefined,
        }
        break
      }
      case 'compute': {
        const cap = effectiveCapacity(node)
        const instances = def.scaling ? (fleetCounts[id] ?? def.scaling.min) : undefined
        let p = Math.min(L, cap)
        const over = L - p
        drop(over)
        if (over > 1) issues.add(`overloaded:${def.name}`)

        // Cold starts: anything above what this function has warm needs a new
        // container. Those requests run slow, and some fraction of them run so
        // slow the caller gives up.
        if (scenario.coldStarts === true && def.coldStart === true) {
          const floor = def.warmFloor ?? COLD_AMBIENT
          const warm = Math.max(floor, warmCapacity[id] ?? floor)
          // What this tick asked the function to be ready for — containers get
          // started for everything that arrived, not just what survived.
          const target = p
          const timedOut = Math.max(0, target - warm) * COLD_TIMEOUT_RATE
          if (timedOut > 1) {
            drop(timedOut)
            issues.add('cold-start')
            p -= timedOut
          }
          newWarm[id] =
            target > warm
              ? Math.min(target, warm + COLD_RAMP)
              : Math.max(floor, target, warm - COLD_DECAY)
        }

        if (scenario.need === 'app') {
          const appTargets = outs.filter((e) => {
            const t = nodeById.get(e.target)
            if (!t) return false
            const r = SERVICES[t.serviceId].role
            // In an async pipeline a bucket is a legitimate write target: the
            // event gets archived rather than rendered. It is still one PUT per
            // event, though, so it pays S3's request ceiling in full —
            // batching those writes is exactly what a delivery stream is for.
            return (
              r === 'db' ||
              r === 'cache' ||
              r === 'retriever' ||
              (scenario.async === true && r === 'origin-static')
            )
          })
          const healthyApp = appTargets.filter((e) => !isOffline(e.target))
          if (p > 0) {
            if (appTargets.length === 0) {
              drop(p)
              issues.add('compute-no-db')
            } else if (healthyApp.length === 0) {
              drop(p)
              issues.add('db-unavailable')
            } else if (scenario.writeFraction === undefined) {
              forward(p, healthyApp, true)
            } else {
              // Levels that model a read/write split route the two apart, the
              // way a reader endpoint does: reads fan out over the replicas if
              // there are any, and every write goes to a primary or nowhere.
              const readers = healthyApp.filter(
                (e) => SERVICES[nodeById.get(e.target)!.serviceId].readsOnly === true,
              )
              const writers = healthyApp.filter(
                (e) => SERVICES[nodeById.get(e.target)!.serviceId].readsOnly !== true,
              )
              const writes = p * scenario.writeFraction
              const reads = p - writes

              if (writers.length === 0) {
                drop(writes)
                issues.add('writes-need-primary')
              } else {
                forward(writes, writers, true)
              }
              // No replicas wired? Reads fall back to the primary, which is
              // exactly the design this level is trying to break.
              forward(reads, readers.length > 0 ? readers : writers, true)
            }
          }
        } else {
          // In a static scenario a web server can serve files directly.
          serve(p)
        }
        nodeLoads[id] = {
          inRps: L,
          processed: p,
          capacity: cap,
          util: L / cap,
          instances,
          demand: queueDemand[id],
        }
        break
      }
      case 'cache': {
        const legit = Math.min(appIn[id], L)
        const direct = L - legit
        if (direct > 1) {
          drop(direct)
          issues.add('cache-direct')
        }
        const p = Math.min(legit, def.capacity)
        const over = legit - p
        drop(over)
        if (over > 1) issues.add(`overloaded:${def.name}`)
        if (p > 0) {
          serve(p * CACHE_HIT_RATIO)
          const misses = p * (1 - CACHE_HIT_RATIO)
          const dbTargets = outs.filter((e) => {
            const t = nodeById.get(e.target)
            if (t === undefined) return false
            const r = SERVICES[t.serviceId].role
            return r === 'db' || r === 'retriever'
          })
          const healthyDb = dbTargets.filter((e) => !isOffline(e.target))
          if (dbTargets.length === 0) {
            drop(misses)
            issues.add('cache-no-db')
          } else if (healthyDb.length === 0) {
            drop(misses)
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
          drop(direct)
          issues.add('db-direct-access')
        }
        const p = Math.min(legit, def.capacity)
        const over = legit - p
        drop(over)
        if (over > 1) issues.add(`overloaded:${def.name}`)
        if (p > 0) {
          const modelTargets = outs.filter((e) => {
            const t = nodeById.get(e.target)
            return t !== undefined && SERVICES[t.serviceId].role === 'db'
          })
          const healthyModels = modelTargets.filter((e) => !isOffline(e.target))
          if (modelTargets.length === 0) {
            drop(p)
            issues.add('retriever-no-model')
          } else if (healthyModels.length === 0) {
            drop(p)
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
        if (def.readsOnly === true && !hasRdsPrimary) {
          if (L > 1) {
            drop(L)
            issues.add('replica-no-primary')
          }
          nodeLoads[id] = { inRps: L, processed: 0, capacity: def.capacity, util: 0 }
          break
        }
        const legit = Math.min(appIn[id], L)
        const direct = L - legit
        if (direct > 1) {
          drop(direct)
          issues.add('db-direct-access')
        }
        const p = Math.min(legit, def.capacity)
        const over = legit - p
        drop(over)
        if (over > 1) {
          issues.add(`overloaded:${def.name}`)
          if (node.serviceId !== 'bedrock' && node.serviceId !== 'sagemaker') issues.add('db-overloaded')
        }
        serve(p)
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

  // What the flood ran up on your bill. Per-request pricing does not care
  // whether the request was real, so a design that absorbs an attack without
  // dropping anything is not winning — it is being charged full price to serve
  // a botnet. This is the whole of "economic denial of service" in four lines.
  let attackBill = 0
  if (attackRps > 0) {
    for (const n of nodes) {
      const def = SERVICES[n.serviceId]
      if (def.costPerRps <= 0) continue
      const arrived = inLoad[n.id]
      if (arrived <= 0) continue
      // A scrubber's `processed` count is already junk-free — it never passed
      // any of it on, so none of it is on the invoice.
      const frac = def.scrubsAttack === true ? 0 : Math.min(1, attackIn[n.id] / arrived)
      attackBill += def.costPerRps * (nodeLoads[n.id]?.processed ?? 0) * frac
    }
  }

  return {
    nodeLoads,
    edgeFlows,
    served,
    dropped,
    total: rps + extraTotal,
    blocked,
    attackBill,
    queueBacklogs: newBacklogs,
    warmCapacity: newWarm,
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
        tip: `${def.name} is taking events straight from the internet with no authenticated front door. Put API Gateway in front — or use an ingest service whose own API is IAM-authenticated, like Kinesis, Firehose, or EventBridge.`,
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
  'cold-start':
    'Requests arrived faster than your functions had containers warm, and the ones that had to cold-start timed out. Serverless scales fast, not instantly — a burst from near-idle pays for every container it starts.',
  'writes-need-primary':
    'Replicas answer reads and refuse writes, so your writes had nowhere to go. Keep the RDS primary in the design — replicas scale reads out, they do not replace the one writer.',
  'replica-no-primary':
    'A read replica is a streaming copy of a primary, and there is no primary here to copy from. Add the RDS instance the replicas read from.',
  'db-direct-access': 'Users cannot query a database or model directly. Put a compute tier (EC2 or Lambda) in front of it.',
  'cache-direct': 'A cache sits behind your compute tier, not in front of it. Route traffic compute → cache → database.',
  'cache-no-db': 'A cache needs somewhere to send its misses. Connect it onward to a database or model.',
  'retriever-no-model':
    'Retrieval without generation answers nothing. A vector store grounds the request — connect it onward to the model that writes the answer.',
  'needs-az': 'Zonal services (EC2, RDS, ElastiCache) must be placed inside an Availability Zone box.',
  'needs-region':
    'Almost everything in AWS is regional. Drag it inside a Region box — only DNS and the CDN edge live outside one.',
  'hit-dead-node': 'Traffic was sent straight to resources in the failed AZ and was lost. A load balancer health-checks and routes around zone failures.',
  'db-unavailable': 'Everything your app tier depends on lived in the failed AZ. Keep a standby (database, cache) in a second zone.',
  'all-targets-dead': 'Everything behind your router lived in the failed AZ. Spread instances across both zones.',
  'fanout-no-subscribers': 'SNS published into the void — no queues or functions are subscribed to it.',
  'queue-no-consumers': 'Your queue has no consumers. Messages are piling up with nothing draining them — connect a compute tier.',
  'queue-overflow': 'The queue backlog overflowed its buffer and events were lost. Add consumer capacity so it drains faster.',
  'bus-rule-undelivered':
    'One of the bus rules is firing at a destination you never built, and everything it matched is gone. A rule is a promise that those events land somewhere — every destination in the brief needs a target wired to it.',
  'bus-needs-delivery-stream':
    'An event bus cannot write an object — there is no PutEvents target on a bucket. Put a delivery stream between them: it batches the stream and lands it in S3 with none of your code in the path.',
}

/**
 * A design under attack fails in ways that look ordinary and are not. Saturating
 * because the flood ate your capacity is not a sizing problem, and a bill that
 * tripled is not a pricing problem — both are the same missing scrubbing layer.
 */
const ATTACK_TIPS: Record<string, string> = {
  'db-overloaded':
    'Your database saturated because it was answering the attack too. Nothing behind the front door can tell junk from a customer — the filtering has to happen before the request gets that far.',
}

/** Advice keyed off how the attack got through, assembled at scoring time. */
export const ATTACK_ADVICE = {
  noWaf:
    'The flood walked in through your front door and consumed the capacity your customers needed. AWS WAF inspects requests at the edge and drops the junk before it reaches anything you pay for or depend on.',
  absorbed:
    'Nothing broke — you simply paid for the attack. Per-request pricing bills a botnet exactly like a customer, so a service elastic enough to absorb a flood will absorb the invoice too. This is economic denial of service, and scaling is not the answer to it.',
  wafTooDeep:
    'Your scrubbing layer is behind a service that bills per request, so the attack was already on the invoice by the time it was blocked. WAF belongs in front of everything that costs money — the first thing the traffic touches, not the second.',
} as const

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

/**
 * The same failures, retold one level up. A design that loses traffic to a dead
 * AZ and one that loses traffic to a dead Region break for identical reasons,
 * but "spread instances across both zones" is useless advice when the thing that
 * died was ap-northeast-2.
 */
const REGION_TIPS: Record<string, string> = {
  'hit-dead-node':
    'Traffic went straight into the failed Region and was lost. Users resolve DNS once and believe it — they never health-check. Route 53 does: put it in front so DNS stops handing out the dead endpoint.',
  'db-unavailable':
    'Everything your app tier depends on lived in the failed Region. A standby Region needs its own data, not a pointer to someone else’s.',
  'all-targets-dead':
    'Everything behind your entry point lived in the failed Region. Each Region needs a complete stack — router, compute, and data — and Route 53 choosing between them.',
}

/**
 * Levels with a read/write split need their own saturation advice: the stock
 * answer is "put a cache in front", and these levels are precisely the ones
 * where that is off the table.
 */
const SPLIT_TIPS: Record<string, string> = {
  'db-overloaded':
    'Your primary saturated under read traffic. Reads are what replicas are for — route them to enough replicas and the primary is left doing only the writes.',
  'overloaded:RDS':
    'The RDS primary saturated. In a read-heavy app it should be handling little more than the writes; every read it serves is a read a replica could have taken.',
  'overloaded:RDS Replica':
    'Your replicas saturated — there are not enough of them for peak reads. Each one handles 250 rps, so size the fleet for the spike, not the baseline.',
}

export function tipsForIssues(
  issues: string[],
  opts?: { multiRegion?: boolean; writeSplit?: boolean; underAttack?: boolean },
): string[] {
  const base = {
    ...ISSUE_TIPS,
    ...(opts?.multiRegion === true ? REGION_TIPS : {}),
    ...(opts?.writeSplit === true ? SPLIT_TIPS : {}),
    ...(opts?.underAttack === true ? ATTACK_TIPS : {}),
  }
  const tips: string[] = []
  for (const issue of issues) {
    if (base[issue]) {
      tips.push(base[issue])
    } else if (issue.startsWith('overloaded:')) {
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
    }
  }
  return [...new Set(tips)]
}
