// Pins the custom-scenario import path: whatever a player pastes or an old
// save contains, only well-formed, in-range scenarios reach the engine.

import { describe, expect, it } from 'vitest'
import { decodeShareCode, encodeShareCode, sanitizeScenario, LIMITS } from './customScenarios'
import { getScenario, registerCustomScenarios } from './scenarios'

const valid = {
  title: 'Black Friday',
  emoji: '🛍️',
  hook: 'Survive the rush.',
  brief: 'The big day.',
  difficulty: 2,
  need: 'app',
  baselineRps: 300,
  spikeRps: 1500,
  spikeLabel: '🛍️ Doors open!',
  budget: 200,
  hasProbe: true,
  goalHints: ['Cache reads.'],
}

describe('sanitizeScenario', () => {
  it('accepts a well-formed scenario and forces the custom track', () => {
    const s = sanitizeScenario(valid)
    expect(s).not.toBeNull()
    expect(s!.track).toBe('custom')
    expect(s!.id).toMatch(/^custom-[a-z0-9]+$/)
    expect(s!.title).toBe('Black Friday')
    expect(s!.baselineRps).toBe(300)
  })

  it('rejects garbage and untitled input', () => {
    expect(sanitizeScenario(null)).toBeNull()
    expect(sanitizeScenario('nope')).toBeNull()
    expect(sanitizeScenario(42)).toBeNull()
    expect(sanitizeScenario({})).toBeNull()
    expect(sanitizeScenario({ title: '   ' })).toBeNull()
  })

  it('clamps numbers into range and keeps spike >= baseline', () => {
    const s = sanitizeScenario({
      ...valid,
      baselineRps: 999999,
      spikeRps: 3,
      budget: -50,
    })!
    expect(s.baselineRps).toBe(LIMITS.baselineRps.max)
    expect(s.spikeRps).toBeGreaterThanOrEqual(s.baselineRps)
    expect(s.budget).toBe(LIMITS.budget.min)
  })

  it('drops unknown service ids and never lets a service be both required and banned', () => {
    const s = sanitizeScenario({
      ...valid,
      banned: ['lambda', 'not-a-service', 'rds'],
      requiredServices: ['lambda', 'dynamodb', 'also-fake'],
    })!
    expect(s.banned).toEqual(['lambda', 'rds'])
    expect(s.requiredServices).toEqual(['dynamodb']) // lambda lost: it's banned
  })

  it('repairs impossible combinations: outage forces the VPC on', () => {
    const s = sanitizeScenario({ ...valid, hasOutage: true, hasVpc: false })!
    expect(s.hasOutage).toBe(true)
    expect(s.hasVpc).toBe(true)
    expect(s.outageLabel).toBeTruthy()
  })

  it('caps string lengths and hint count', () => {
    const s = sanitizeScenario({
      ...valid,
      title: 'x'.repeat(500),
      brief: 'y'.repeat(5000),
      goalHints: ['a', 'b', 'c', 'd', 'e'],
    })!
    expect(s.title.length).toBe(40)
    expect(s.brief.length).toBe(600)
    expect(s.goalHints.length).toBe(3)
  })

  it('refuses to impersonate a built-in id', () => {
    const s = sanitizeScenario({ ...valid, id: 'static-site' })!
    expect(s.id).not.toBe('static-site')
    expect(s.id).toMatch(/^custom-/)
  })
})

describe('share codes', () => {
  it('round-trips a scenario (with a fresh id, so imports never overwrite)', () => {
    const original = sanitizeScenario({ ...valid, emoji: '🛍️', brief: '한국어도 됩니다 — unicode safe.' })!
    const decoded = decodeShareCode(encodeShareCode(original))
    expect(decoded).not.toBeNull()
    expect(decoded!.title).toBe(original.title)
    expect(decoded!.brief).toBe(original.brief)
    expect(decoded!.spikeRps).toBe(original.spikeRps)
    expect(decoded!.id).not.toBe(original.id)
  })

  it('rejects malformed codes without throwing', () => {
    expect(decodeShareCode('')).toBeNull()
    expect(decodeShareCode('hello world')).toBeNull()
    expect(decodeShareCode('SC1.not-base64!!')).toBeNull()
    expect(decodeShareCode('SC1.' + btoa('{"not":"a scenario"}'))).toBeNull()
  })
})

describe('registry', () => {
  it('registered custom scenarios resolve through getScenario; built-ins win on fallback', () => {
    const s = sanitizeScenario(valid)!
    registerCustomScenarios([s])
    expect(getScenario(s.id).title).toBe('Black Friday')
    registerCustomScenarios([])
    expect(getScenario(s.id).id).toBe('static-site') // gone → safe fallback
  })
})
