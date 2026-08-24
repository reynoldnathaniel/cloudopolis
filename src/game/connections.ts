// Which wires the player is allowed to draw.
//
// Until now any node could connect to any other, which meant CloudFront could
// feed SNS. The engine did not crash on that — it silently ignored the edge —
// and a silent no-op is the worst possible answer, because the design fails
// with no story attached to the failure.
//
// The rule is NOT "is this real AWS". Every candidate edge falls into one of
// three classes, and only the third is blocked here:
//
//   1. Meaningful — the engine routes traffic along it (ALB -> EC2).
//   2. A teaching failure — the engine punishes it by NAME, with a tip:
//      Users -> RDS raises `db-direct-access`, SNS -> S3 raises
//      `bus-needs-delivery-stream`, S3 under a dynamic app raises
//      `static-cant-dynamic`. These stay connectable. Being allowed to build
//      the wrong thing and watch it fail is most of the game.
//   3. Silent nonsense — the engine ignores it and says nothing. Blocked.
//
// So the allowed sets below are read straight off the engine's own target
// filters in `simulateTick`: `fanout` accepts queue|compute, `queue` accepts
// compute (plus storage for a delivery stream), `compute` accepts
// db|cache|retriever|origin-static, `cache` accepts db|retriever, `retriever`
// accepts db. If you change a filter there, change the row here.
//
// Some blocked pairs ARE real AWS — EventBridge genuinely targets SNS and API
// Gateway, DynamoDB has Streams, S3 has event notifications, a Lambda can
// absolutely put a message on a queue. Cloudopolis does not simulate any of that,
// so the copy says "not simulated here" and never "impossible in AWS". Telling
// someone a real architecture is illegal would be worse than the silent edge
// this whole file exists to remove.

import { SERVICES, type Role, type ServiceDef } from './services'

/**
 * Target roles each source role can hand traffic to.
 *
 * Users and routers are deliberately unconstrained: everything they can reach
 * is either meaningful or a named teaching failure, so there is nothing here
 * worth taking away from them.
 */
const EVERYTHING: Role[] = [
  'router',
  'cdn',
  'origin-static',
  'compute',
  'cache',
  'queue',
  'fanout',
  'db',
  'retriever',
]

const ALLOWED: Record<Role, Role[]> = {
  client: EVERYTHING,
  router: EVERYTHING,
  // A distribution pulls from an origin: a bucket, a load balancer, or a
  // server. Reaching data directly is wrong but *named* (db-direct-access).
  cdn: ['origin-static', 'router', 'compute', 'cache', 'db', 'retriever'],
  // Subscribers, per the engine. origin-static stays allowed on purpose: it is
  // the mistake `bus-needs-delivery-stream` exists to explain, and Paper Trail's
  // solution notes teach it by name.
  fanout: ['queue', 'compute', 'origin-static'],
  // Consumers drain a queue. A delivery stream also writes to storage — that
  // flag is what separates Firehose from SQS, here and in the engine.
  queue: ['compute'],
  compute: ['db', 'cache', 'retriever', 'origin-static'],
  cache: ['db', 'retriever'],
  retriever: ['db'],
  // Sinks. A request that reaches storage or a data store is answered there.
  'origin-static': [],
  db: [],
}

/** The allowed set for one service, including flag-driven extras. */
export function allowedTargetRoles(source: ServiceDef): Role[] {
  const base = ALLOWED[source.role]
  return source.role === 'queue' && source.deliversToStorage === true
    ? [...base, 'origin-static']
    : base
}

/**
 * Why this wire is refused, or `null` if it is fine.
 *
 * Every line has to do two jobs: say what is wrong, and say what to build
 * instead. A rejection the player cannot act on is just a locked door.
 */
function rejectionMessage(source: ServiceDef, target: ServiceDef): string {
  const to = target.name

  if (target.role === 'client') {
    return `Traffic starts at Users — nothing delivers back to them. Wire ${source.name} onward instead.`
  }

  switch (source.role) {
    case 'origin-static':
      return `${source.name} stores objects and serves them — a request that reaches it is answered there. (Real S3 can fire event notifications; Cloudopolis doesn't simulate those.)`

    case 'db':
      return `${source.name} answers the request that reached it, so it's the end of the line. (Change streams like DynamoDB Streams are real AWS, but not simulated here.)`

    case 'cdn':
      if (target.role === 'fanout')
        return `A distribution pulls pages from an origin — a bucket, a load balancer, or a server. ${to} carries events, not page requests.`
      if (target.role === 'queue')
        return `${to} buffers messages; it can't answer a page request. Give ${source.name} an origin: S3, an ALB, or a compute tier.`
      return `A distribution needs an origin behind it, not another cache layer.`

    case 'fanout':
      if (target.role === 'router' || target.role === 'fanout')
        return `In AWS ${source.name} really can target an API or another bus — Cloudopolis only simulates delivery to queues and functions.`
      return `${source.name} delivers events to queues and functions. Put a consumer on this rule, and let it write to ${to}.`

    case 'queue':
      if (target.role === 'origin-static')
        return `${source.name} holds messages until something reads them — it can't write an object. Firehose is the stream that delivers straight to a bucket.`
      return `Something has to read from ${source.name}. Drain it with a compute tier, which can then reach ${to}.`

    case 'compute':
      if (target.role === 'queue')
        return `Put the queue in front of the function, not behind it: the queue absorbs the burst and the function drains it at its own pace. (A function really can enqueue work in AWS — that path just isn't simulated.)`
      if (target.role === 'fanout')
        return `Publishing from a function isn't simulated. Wire ${to} ahead of the compute tier so it fans the events out to its subscribers.`
      if (target.role === 'compute')
        return `Chaining compute tiers isn't simulated — one tier handles the request, then reaches its data.`
      return `Traffic flows edge → router → compute → data. Wiring ${source.name} back to ${to} points it at the front door again.`

    case 'cache':
      return `A cache sits between the app and its data. Misses go to a database or a search index, not to ${to}.`

    case 'retriever':
      return `${source.name} grounds the request and hands it to a model — that's retrieve-then-generate. Wire it to Bedrock or SageMaker.`

    default:
      return `${source.name} can't deliver to ${to}.`
  }
}

/**
 * `null` when the connection is allowed, otherwise the line to show the player.
 *
 * Scenario-independent on purpose. A few edges only do something in particular
 * levels (a function writes to a bucket only in an async pipeline), but a rule
 * that changed shape from level to level would be unlearnable — and the engine
 * already names those cases when they matter.
 */
export function connectionError(sourceServiceId: string, targetServiceId: string): string | null {
  const source = SERVICES[sourceServiceId]
  const target = SERVICES[targetServiceId]
  // An unknown service is not this function's problem to report.
  if (!source || !target) return null
  return allowedTargetRoles(source).includes(target.role)
    ? null
    : rejectionMessage(source, target)
}

export const canConnect = (sourceServiceId: string, targetServiceId: string): boolean =>
  connectionError(sourceServiceId, targetServiceId) === null
