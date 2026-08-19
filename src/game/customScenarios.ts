// Custom (player-authored) scenarios: validation, persistence, and share codes.
// Stored under their own localStorage key, separate from the progress save, so
// clearing progress never deletes authored scenarios.
//
// Everything that enters the game — the editor form, a pasted share code, or
// the saved list itself — passes through sanitizeScenario, so the engine only
// ever sees well-formed, in-range data.

import { registerCustomScenarios, type Scenario } from './scenarios'
import { SERVICES } from './services'

export const CUSTOM_KEY = 'simcloud-custom-v1'
const SHARE_PREFIX = 'SC1.'

export const LIMITS = {
  baselineRps: { min: 10, max: 5000 },
  spikeRps: { min: 10, max: 20000 },
  budget: { min: 10, max: 1000 },
} as const

export const newCustomId = (): string => `custom-${Math.random().toString(36).slice(2, 10)}`

const str = (v: unknown, max: number): string => (typeof v === 'string' ? v.trim().slice(0, max) : '')

const clampInt = (v: unknown, min: number, max: number, fallback: number): number => {
  const n = typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : fallback
  return Math.min(max, Math.max(min, n))
}

const serviceIds = (v: unknown): string[] =>
  Array.isArray(v)
    ? [...new Set(v.filter((id): id is string => typeof id === 'string' && id in SERVICES))]
    : []

/**
 * Coerce untrusted input (the editor form, an import, an old save) into a
 * valid custom Scenario, or return null when it isn't even scenario-shaped.
 * Strings are trimmed and capped, numbers clamped into LIMITS, service ids
 * checked against the catalog, and impossible combinations repaired
 * (outage ⇒ VPC, a required service can't also be banned, spike ≥ baseline).
 */
export function sanitizeScenario(raw: unknown): Scenario | null {
  if (typeof raw !== 'object' || raw === null) return null
  const r = raw as Record<string, unknown>
  const title = str(r.title, 40)
  if (!title) return null

  const baselineRps = clampInt(r.baselineRps, LIMITS.baselineRps.min, LIMITS.baselineRps.max, 100)
  const spikeRps = clampInt(r.spikeRps, baselineRps, LIMITS.spikeRps.max, Math.max(baselineRps, 1000))
  const banned = serviceIds(r.banned)
  const required = serviceIds(r.requiredServices).filter((id) => !banned.includes(id))
  const hasOutage = r.hasOutage === true
  const goalHints = Array.isArray(r.goalHints)
    ? r.goalHints
        .map((h) => str(h, 140))
        .filter((h) => h.length > 0)
        .slice(0, 3)
    : []

  return {
    id: typeof r.id === 'string' && /^custom-[a-z0-9]+$/.test(r.id) ? r.id : newCustomId(),
    track: 'custom',
    order: clampInt(r.order, 1, 999, 1),
    difficulty: clampInt(r.difficulty, 1, 3, 2) as 1 | 2 | 3,
    title,
    emoji: str(r.emoji, 8) || '🛠️',
    hook: str(r.hook, 90) || 'A custom mission.',
    brief: str(r.brief, 600) || 'A custom scenario. Build something that survives the traffic.',
    need: r.need === 'static' ? 'static' : 'app',
    async: r.async === true || undefined,
    baselineRps,
    spikeRps,
    spikeLabel: str(r.spikeLabel, 60) || '🔥 Traffic spike!',
    budget: clampInt(r.budget, LIMITS.budget.min, LIMITS.budget.max, 150),
    hasVpc: r.hasVpc === true || hasOutage || undefined,
    hasOutage: hasOutage || undefined,
    hasProbe: r.hasProbe === true || undefined,
    outageLabel: hasOutage ? str(r.outageLabel, 60) || '💥 Availability Zone failure!' : undefined,
    banned: banned.length ? banned : undefined,
    bannedReason: banned.length
      ? str(r.bannedReason, 120) || 'Not allowed in this scenario.'
      : undefined,
    requiredServices: required.length ? required : undefined,
    goalHints,
  }
}

// ---- persistence ----

export function loadCustomScenarios(): Scenario[] {
  try {
    const raw = localStorage.getItem(CUSTOM_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.map(sanitizeScenario).filter((s): s is Scenario => s !== null)
  } catch {
    return []
  }
}

/** Replace the stored + registered list in one step (the store's single write path). */
export function setCustomScenarios(list: Scenario[]): void {
  registerCustomScenarios(list)
  try {
    localStorage.setItem(CUSTOM_KEY, JSON.stringify(list))
  } catch {
    // Storage full or blocked — the in-memory registry still works this session.
  }
}

// Load + register at module scope so custom scenarios exist before the store
// module validates its saved scenarioId against getScenario().
export const initialCustomScenarios: Scenario[] = loadCustomScenarios()
registerCustomScenarios(initialCustomScenarios)

/**
 * Parse an exported scenario file — a JSON array of scenarios (the export
 * format, identical to what localStorage holds) or {scenarios: [...]} for
 * tolerance. Returns only the entries that survive sanitization, or null
 * when the file isn't scenario-shaped at all.
 */
export function parseScenarioFile(text: string): Scenario[] | null {
  try {
    const parsed: unknown = JSON.parse(text)
    const list = Array.isArray(parsed)
      ? parsed
      : typeof parsed === 'object' &&
          parsed !== null &&
          Array.isArray((parsed as { scenarios?: unknown }).scenarios)
        ? (parsed as { scenarios: unknown[] }).scenarios
        : null
    if (!list) return null
    return list.map(sanitizeScenario).filter((s): s is Scenario => s !== null)
  } catch {
    return null
  }
}

// ---- share codes ----
// A share code is the scenario JSON, UTF-8 → base64, behind a versioned prefix.
// Paste-to-import is the whole distribution story: no backend, works in chat.

export function encodeShareCode(scenario: Scenario): string {
  const bytes = new TextEncoder().encode(JSON.stringify(scenario))
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return SHARE_PREFIX + btoa(bin)
}

/** Decode a share code into a fresh scenario (new id, so imports never overwrite). */
export function decodeShareCode(code: string): Scenario | null {
  const trimmed = code.trim()
  if (!trimmed.startsWith(SHARE_PREFIX)) return null
  try {
    const bin = atob(trimmed.slice(SHARE_PREFIX.length))
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0))
    const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes))
    const scenario = sanitizeScenario(parsed)
    return scenario ? { ...scenario, id: newCustomId() } : null
  } catch {
    return null
  }
}
