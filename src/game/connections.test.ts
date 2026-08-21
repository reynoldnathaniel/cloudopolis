// The connection matrix.
//
// Two failure modes matter here and they pull in opposite directions. Too
// loose and the nonsense edges this exists to stop get through. Too tight and
// it blocks a design the game itself wants built — which is why the first
// suite walks every edge of every reference answer, and the second insists the
// deliberate mistakes stay drawable.

import { describe, it, expect } from 'vitest'
import { canConnect, connectionError, allowedTargetRoles } from './connections'
import { SERVICES, type Role } from './services'
import { SOLUTIONS } from './solutions'

const ROLES: Role[] = [
  'client',
  'compute',
  'db',
  'router',
  'cdn',
  'origin-static',
  'cache',
  'queue',
  'fanout',
  'retriever',
]

/** One service id per role, for exhaustive pair sweeps. */
const sampleOf = (role: Role): string =>
  Object.values(SERVICES).find((s) => s.role === role)!.id

describe('the reference answers stay buildable', () => {
  // If a solution can be revealed but not drawn by hand, the rules are wrong.
  it('allows every edge in every reference solution', () => {
    for (const [scenarioId, solution] of Object.entries(SOLUTIONS)) {
      const serviceOf = (key: string): string =>
        key === 'users' ? 'users' : solution.nodes.find((n) => n.key === key)!.serviceId
      for (const [from, to] of solution.edges) {
        const source = serviceOf(from)
        const target = serviceOf(to)
        expect(
          connectionError(source, target),
          `${scenarioId}: ${source} -> ${target} is in the reference answer but rejected`,
        ).toBeNull()
      }
    }
  })

  it('allows the wires the tutorial asks for by name', () => {
    // The tutorial's `done` predicates wait for these exact edges, so blocking
    // one would strand a first-time player on step 4 with no way forward.
    expect(canConnect('users', 's3')).toBe(true)
    expect(canConnect('users', 'cloudfront')).toBe(true)
    expect(canConnect('cloudfront', 's3')).toBe(true)
    // ...and the sandbox tour's.
    expect(canConnect('users', 'alb')).toBe(true)
    expect(canConnect('alb', 'ec2')).toBe(true)
  })
})

describe('teaching failures stay connectable', () => {
  // Each of these is wrong, and each is wrong in a way the engine explains by
  // name. Blocking them would delete the lesson instead of teaching it.
  it.each([
    ['users', 'rds', 'db-direct-access + the security probe'],
    ['users', 's3', 'static-cant-dynamic in an app scenario'],
    ['users', 'dynamodb', 'db-direct-access'],
    ['alb', 'rds', 'db-direct-access'],
    ['sns', 's3', 'bus-needs-delivery-stream'],
    ['eventbridge', 's3', 'bus-needs-delivery-stream'],
    ['apigw', 'waf', 'the Shakedown two-star trap: scrubbing after the meter'],
    ['lambda', 's3', 'the Paper Trail trap: a function paying per PUT'],
    ['users', 'apigw', 'the Click Stream cost trap'],
    ['lambda', 'rds', 'no cache in front of the database'],
  ])('%s -> %s stays allowed (%s)', (from, to) => {
    expect(connectionError(from, to)).toBeNull()
  })
})

describe('silent nonsense is refused', () => {
  it.each([
    ['cloudfront', 'sns'],
    ['cloudfront', 'sqs'],
    ['cloudfront', 'cloudfront'],
    ['s3', 'lambda'],
    ['s3', 'sns'],
    ['dynamodb', 'lambda'],
    ['rds', 'elasticache'],
    ['sqs', 's3'],
    ['sqs', 'rds'],
    ['kinesis', 'sns'],
    ['lambda', 'sqs'],
    ['lambda', 'sns'],
    ['lambda', 'lambda'],
    ['lambda', 'alb'],
    ['fargate', 'cloudfront'],
    ['elasticache', 'lambda'],
    ['elasticache', 'elasticache'],
    ['opensearch', 'cloudfront'],
    ['sns', 'rds'],
    ['sns', 'sns'],
    ['eventbridge', 'apigw'],
    ['alb', 'users'],
    ['cloudfront', 'users'],
  ])('%s -> %s is blocked', (from, to) => {
    expect(canConnect(from, to)).toBe(false)
  })

  it('refuses to let anything deliver back to Users', () => {
    for (const id of Object.keys(SERVICES)) {
      if (id === 'users') continue
      expect(canConnect(id, 'users'), `${id} -> users`).toBe(false)
    }
  })

  it('treats data stores and buckets as the end of the line', () => {
    for (const sink of ['s3', 'rds', 'dynamodb', 'bedrock', 'sagemaker']) {
      for (const id of Object.keys(SERVICES)) {
        expect(canConnect(sink, id), `${sink} -> ${id}`).toBe(false)
      }
    }
  })
})

describe('the matrix mirrors the engine', () => {
  // These four sets are read straight off the target filters in simulateTick.
  // If one drifts, a player can draw an edge the engine will silently ignore —
  // which is the exact bug this file was written to remove.
  it('matches the fan-out subscriber filter (queue | compute, plus the named bucket case)', () => {
    expect(canConnect('sns', 'sqs')).toBe(true)
    expect(canConnect('sns', 'lambda')).toBe(true)
    expect(canConnect('sns', 'elasticache')).toBe(false)
  })

  it('matches the queue consumer filter, and only a delivery stream reaches storage', () => {
    expect(canConnect('sqs', 'lambda')).toBe(true)
    expect(canConnect('kinesis', 'fargate')).toBe(true)
    // The flag is the whole difference between these two lines.
    expect(SERVICES.firehose.deliversToStorage).toBe(true)
    expect(canConnect('firehose', 's3')).toBe(true)
    expect(canConnect('sqs', 's3')).toBe(false)
  })

  it('matches the compute app-target filter', () => {
    for (const target of ['dynamodb', 'rds', 'elasticache', 'opensearch', 's3']) {
      expect(canConnect('lambda', target), `lambda -> ${target}`).toBe(true)
    }
  })

  it('matches the cache and retriever filters', () => {
    expect(canConnect('elasticache', 'rds')).toBe(true)
    expect(canConnect('elasticache', 'opensearch')).toBe(true)
    expect(canConnect('opensearch', 'bedrock')).toBe(true)
    expect(canConnect('opensearch', 'elasticache')).toBe(false)
    // The engine's retriever filter is `role === 'db'`, and a table is a db —
    // so this forwards and gets served. Odd architecture, but not a silent
    // no-op, and the matrix must not be stricter than the thing it describes.
    expect(canConnect('opensearch', 'dynamodb')).toBe(true)
  })

  it('leaves Users and routers unconstrained, so every mistake there still teaches', () => {
    for (const id of Object.keys(SERVICES)) {
      if (id === 'users') continue
      expect(canConnect('users', id), `users -> ${id}`).toBe(true)
      expect(canConnect('alb', id), `alb -> ${id}`).toBe(true)
    }
  })
})

describe('every rule can explain itself', () => {
  it('gives every role a row — a new role cannot ship without a decision', () => {
    for (const role of ROLES) {
      expect(allowedTargetRoles(SERVICES[sampleOf(role)]), role).toBeDefined()
    }
    // And every role in the catalog is covered by the list above.
    const catalogRoles = new Set(Object.values(SERVICES).map((s) => s.role))
    for (const role of catalogRoles) expect(ROLES).toContain(role)
  })

  it('attaches actionable copy to every blocked pair in the catalog', () => {
    const ids = Object.keys(SERVICES)
    let blocked = 0
    for (const from of ids) {
      for (const to of ids) {
        const message = connectionError(from, to)
        if (message === null) continue
        blocked += 1
        // Long enough to say what to do instead, not just "no".
        expect(message.length, `${from} -> ${to}`).toBeGreaterThan(40)
        expect(message.endsWith('.') || message.endsWith(')'), `${from} -> ${to}: ${message}`).toBe(true)
      }
    }
    expect(blocked).toBeGreaterThan(50)
  })

  it('never claims a real AWS integration is impossible', () => {
    // Some blocked pairs are perfectly real architecture that this game simply
    // does not model. Saying "you can't do that" there would teach something
    // false, so the copy has to hedge to the simulation.
    for (const [from, to] of [
      ['lambda', 'sqs'],
      ['s3', 'sns'],
      ['dynamodb', 'lambda'],
      ['eventbridge', 'apigw'],
      ['eventbridge', 'sns'],
    ]) {
      const message = connectionError(from, to)!
      expect(message, `${from} -> ${to}`).toMatch(/simulat/i)
    }
  })

  it('marks exactly the sinks as having no outgoing wire', () => {
    // ServiceNode hides a node's output dot when this set is empty, so these
    // two facts have to stay the same fact.
    const sinks = Object.values(SERVICES)
      .filter((s) => allowedTargetRoles(s).length === 0)
      .map((s) => s.role)
    expect(new Set(sinks)).toEqual(new Set<Role>(['db', 'origin-static']))
  })

  it('says nothing about services it does not know', () => {
    expect(connectionError('not-a-service', 'lambda')).toBeNull()
    expect(connectionError('lambda', 'not-a-service')).toBeNull()
  })
})
