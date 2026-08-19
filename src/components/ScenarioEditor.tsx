import { useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { getScenario, type Scenario } from '../game/scenarios'
import { PALETTE, SERVICES } from '../game/services'
import { ICONS } from '../game/icons'
import { LIMITS, decodeShareCode, sanitizeScenario } from '../game/customScenarios'
import { useGameStore } from '../store'

// The editor works on a loose draft and runs it through sanitizeScenario on
// save, so the form never has to block on anything except an empty title.
interface Draft {
  title: string
  emoji: string
  hook: string
  brief: string
  difficulty: 1 | 2 | 3
  need: 'static' | 'app'
  isAsync: boolean
  baselineRps: number
  spikeRps: number
  spikeLabel: string
  budget: number
  hasProbe: boolean
  hasVpc: boolean
  hasOutage: boolean
  outageLabel: string
  banned: string[]
  bannedReason: string
  required: string[]
  hints: string[]
}

const emptyDraft = (): Draft => ({
  title: '',
  emoji: '🛠️',
  hook: '',
  brief: '',
  difficulty: 2,
  need: 'app',
  isAsync: false,
  baselineRps: 200,
  spikeRps: 1200,
  spikeLabel: '🔥 Traffic spike!',
  budget: 150,
  hasProbe: true,
  hasVpc: false,
  hasOutage: false,
  outageLabel: '💥 Availability Zone failure!',
  banned: [],
  bannedReason: '',
  required: [],
  hints: ['', '', ''],
})

const draftFrom = (s: Scenario): Draft => ({
  title: s.title,
  emoji: s.emoji,
  hook: s.hook,
  brief: s.brief,
  difficulty: s.difficulty,
  need: s.need,
  isAsync: s.async === true,
  baselineRps: s.baselineRps,
  spikeRps: s.spikeRps,
  spikeLabel: s.spikeLabel,
  budget: s.budget,
  hasProbe: s.hasProbe === true,
  hasVpc: s.hasVpc === true,
  hasOutage: s.hasOutage === true,
  outageLabel: s.outageLabel ?? '💥 Availability Zone failure!',
  banned: s.banned ?? [],
  bannedReason: s.bannedReason ?? '',
  required: s.requiredServices ?? [],
  hints: [0, 1, 2].map((i) => s.goalHints[i] ?? ''),
})

const toScenario = (d: Draft, id: string | undefined, order: number): Scenario | null =>
  sanitizeScenario({
    id,
    order,
    difficulty: d.difficulty,
    title: d.title,
    emoji: d.emoji,
    hook: d.hook,
    brief: d.brief,
    need: d.need,
    async: d.isAsync,
    baselineRps: d.baselineRps,
    spikeRps: d.spikeRps,
    spikeLabel: d.spikeLabel,
    budget: d.budget,
    hasProbe: d.hasProbe,
    hasVpc: d.hasVpc,
    hasOutage: d.hasOutage,
    outageLabel: d.outageLabel,
    banned: d.banned,
    bannedReason: d.bannedReason,
    requiredServices: d.required,
    goalHints: d.hints,
  })

const QUICK_EMOJI = ['🛠️', '🚀', '🏦', '🎮', '🏥', '📰', '🎓', '🛍️', '⚽', '🎬', '📡', '🧪']

// ---- small styled primitives ----

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
      <h3 className="mb-3 text-[11px] font-bold uppercase tracking-wider text-slate-400">{title}</h3>
      <div className="space-y-3">{children}</div>
    </section>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-medium text-slate-400">{label}</span>
      {children}
    </label>
  )
}

const inputCls =
  'w-full rounded-lg border border-slate-700 bg-slate-950/60 px-2.5 py-1.5 text-[13px] text-slate-100 placeholder:text-slate-600 focus:border-cyan-500 focus:outline-none'

function NumberField({
  label,
  value,
  min,
  max,
  step,
  prefix,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  prefix?: string
  onChange: (n: number) => void
}) {
  return (
    <Field label={label}>
      <div className="flex items-center gap-2">
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className="flex-1 accent-cyan-500"
        />
        <div className="flex w-24 items-center rounded-lg border border-slate-700 bg-slate-950/60 px-2 py-1">
          {prefix && <span className="text-[12px] text-slate-500">{prefix}</span>}
          <input
            type="number"
            min={min}
            max={max}
            value={value}
            onChange={(e) => onChange(Number(e.target.value))}
            className="w-full bg-transparent text-right text-[13px] tabular-nums text-slate-100 focus:outline-none"
          />
        </div>
      </div>
    </Field>
  )
}

function Toggle({
  label,
  hint,
  on,
  onChange,
}: {
  label: string
  hint: string
  on: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!on)}
      className={`flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left transition ${
        on ? 'border-cyan-500/50 bg-cyan-500/10' : 'border-slate-700 bg-slate-950/40'
      }`}
    >
      <span>
        <span className="block text-[12px] font-semibold text-slate-200">{label}</span>
        <span className="block text-[10px] text-slate-500">{hint}</span>
      </span>
      <span
        className={`ml-3 flex h-5 w-9 shrink-0 items-center rounded-full p-0.5 transition ${
          on ? 'bg-cyan-500' : 'bg-slate-700'
        }`}
      >
        <span className={`h-4 w-4 rounded-full bg-white transition ${on ? 'translate-x-4' : ''}`} />
      </span>
    </button>
  )
}

// ---- live preview card (mirrors the ScenarioSelect card + mission chips) ----

function Chip({ tone, children }: { tone: string; children: React.ReactNode }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md bg-slate-900/80 px-1.5 py-1 text-[11px] font-medium leading-none ${tone}`}
    >
      {children}
    </span>
  )
}

function Preview({ d }: { d: Draft }) {
  return (
    <div className="rounded-xl border border-slate-700/70 bg-slate-900/60 p-3">
      <div className="flex items-start justify-between">
        <span className="text-2xl">{d.emoji || '🛠️'}</span>
        <span className="flex gap-0.5 pt-1.5">
          {[1, 2, 3].map((i) => (
            <span
              key={i}
              className={`h-1.5 w-1.5 rounded-full ${i <= d.difficulty ? 'bg-orange-400' : 'bg-slate-700'}`}
            />
          ))}
        </span>
      </div>
      <div className="mt-1.5 text-[13px] font-bold text-slate-100">{d.title || 'Untitled scenario'}</div>
      <div className="mt-0.5 min-h-[2em] text-[10px] leading-snug text-slate-400">
        {d.hook || 'Your one-line hook shows here.'}
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        <Chip tone="text-sky-300">
          📊 {d.baselineRps.toLocaleString()} → {d.spikeRps.toLocaleString()} rps
        </Chip>
        <Chip tone="text-emerald-300">💰 ≤ ${d.budget}/mo</Chip>
        {d.isAsync && <Chip tone="text-indigo-300">⏳ async · zero loss</Chip>}
        {d.hasOutage && <Chip tone="text-fuchsia-300">💥 AZ outage</Chip>}
        {d.hasProbe && <Chip tone="text-amber-300">🕵️ probe</Chip>}
      </div>
      {d.required.length > 0 && (
        <div className="mt-2 flex items-center gap-1.5">
          <span className="text-[10px] text-slate-500">Must use</span>
          {d.required.map((id) => (
            <img key={id} src={ICONS[id]} alt={SERVICES[id]?.name} title={SERVICES[id]?.name} className="h-5 w-5" />
          ))}
        </div>
      )}
      {d.banned.length > 0 && (
        <div className="mt-1.5 text-[10px] text-red-300/80">
          🔒 {d.banned.map((id) => SERVICES[id]?.name ?? id).join(', ')} banned
        </div>
      )}
    </div>
  )
}

// ---- the editor screen ----

export function ScenarioEditor() {
  const editingId = useGameStore((s) => s.editingScenarioId)
  const closeEditor = useGameStore((s) => s.closeEditor)
  const saveCustomScenario = useGameStore((s) => s.saveCustomScenario)

  const editing = useMemo(
    () => (editingId ? getScenario(editingId) : null),
    [editingId],
  )
  const [draft, setDraft] = useState<Draft>(() => (editing ? draftFrom(editing) : emptyDraft()))
  const [importOpen, setImportOpen] = useState(false)
  const [importCode, setImportCode] = useState('')
  const [importError, setImportError] = useState(false)
  // An imported draft isn't the player's own writing — let them get the
  // first-time briefing like any recipient. Authoring by hand skips it.
  const [imported, setImported] = useState(false)

  const up = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }))

  // Cycle a service through allowed → required → banned → allowed.
  const cycleService = (id: string) => {
    setDraft((d) => {
      if (d.required.includes(id))
        return { ...d, required: d.required.filter((s) => s !== id), banned: [...d.banned, id] }
      if (d.banned.includes(id)) return { ...d, banned: d.banned.filter((s) => s !== id) }
      return { ...d, required: [...d.required, id] }
    })
  }

  const canSave = draft.title.trim().length > 0
  const save = (play: boolean) => {
    const scenario = toScenario(draft, editing?.id, editing?.order ?? 1)
    if (scenario) saveCustomScenario(scenario, play, !imported)
  }

  const runImport = () => {
    const decoded = decodeShareCode(importCode)
    if (!decoded) {
      setImportError(true)
      return
    }
    setDraft(draftFrom(decoded))
    setImported(true)
    setImportOpen(false)
    setImportCode('')
    setImportError(false)
  }

  return (
    <div className="h-screen w-screen overflow-y-auto bg-slate-950 text-slate-100">
      <div className="mx-auto max-w-4xl px-6 py-8">
        <div className="mb-5 flex items-center justify-between">
          <div>
            <h1 className="bg-gradient-to-r from-cyan-400 to-indigo-400 bg-clip-text text-2xl font-black tracking-tight text-transparent">
              {editing ? 'Edit scenario' : 'New scenario'}
            </h1>
            <p className="text-[12px] text-slate-500">
              Author a mission — it plays through the same engine, events, and scoring as the built-ins.
            </p>
          </div>
          <button
            onClick={closeEditor}
            className="rounded-lg border border-slate-700 px-3 py-1.5 text-[12px] text-slate-400 transition hover:border-slate-500 hover:text-slate-200"
          >
            ✕ Cancel
          </button>
        </div>

        {!editing && (
          <div className="mb-4">
            {importOpen ? (
              <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-3">
                <textarea
                  value={importCode}
                  onChange={(e) => {
                    setImportCode(e.target.value)
                    setImportError(false)
                  }}
                  placeholder="Paste a share code (starts with SC1.)"
                  rows={2}
                  className={`${inputCls} font-mono text-[11px]`}
                />
                <div className="mt-2 flex items-center gap-2">
                  <button
                    onClick={runImport}
                    className="rounded-lg bg-cyan-600 px-3 py-1.5 text-[12px] font-semibold text-white transition hover:bg-cyan-500"
                  >
                    Import
                  </button>
                  <button
                    onClick={() => setImportOpen(false)}
                    className="rounded-lg border border-slate-700 px-3 py-1.5 text-[12px] text-slate-400 transition hover:text-slate-200"
                  >
                    Never mind
                  </button>
                  {importError && (
                    <span className="text-[11px] text-red-400">That doesn't look like a valid share code.</span>
                  )}
                </div>
              </div>
            ) : (
              <button
                onClick={() => setImportOpen(true)}
                className="text-[12px] text-cyan-400 transition hover:text-cyan-300"
              >
                📥 Have a share code? Import it
              </button>
            )}
          </div>
        )}

        <div className="flex gap-5 pb-12">
          <div className="min-w-0 flex-1 space-y-4">
            <Section title="Story">
              <div className="flex gap-3">
                <Field label="Title">
                  <input
                    value={draft.title}
                    onChange={(e) => up({ title: e.target.value.slice(0, 40) })}
                    placeholder="e.g. Black Friday at MegaMart"
                    className={inputCls}
                    autoFocus={!editing}
                  />
                </Field>
                <div className="w-40 shrink-0">
                  <Field label="Emoji">
                    <input
                      value={draft.emoji}
                      onChange={(e) => up({ emoji: e.target.value.slice(0, 8) })}
                      className={inputCls}
                    />
                  </Field>
                </div>
              </div>
              <div className="flex flex-wrap gap-1">
                {QUICK_EMOJI.map((e) => (
                  <button
                    key={e}
                    type="button"
                    onClick={() => up({ emoji: e })}
                    className={`rounded-md px-1.5 py-0.5 text-lg transition hover:bg-slate-800 ${
                      draft.emoji === e ? 'bg-slate-800 ring-1 ring-cyan-500/60' : ''
                    }`}
                  >
                    {e}
                  </button>
                ))}
              </div>
              <Field label="Hook — one line shown on the scenario card">
                <input
                  value={draft.hook}
                  onChange={(e) => up({ hook: e.target.value.slice(0, 90) })}
                  placeholder="e.g. Your biggest sales day meets your oldest database."
                  className={inputCls}
                />
              </Field>
              <Field label="Briefing — the story shown before the first play">
                <textarea
                  value={draft.brief}
                  onChange={(e) => up({ brief: e.target.value.slice(0, 600) })}
                  rows={3}
                  placeholder="Set the scene: who's the customer, what's at stake, what's the twist?"
                  className={inputCls}
                />
              </Field>
              <Field label="Difficulty dots">
                <div className="flex gap-1.5">
                  {([1, 2, 3] as const).map((n) => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => up({ difficulty: n })}
                      className={`flex h-8 w-12 items-center justify-center gap-0.5 rounded-lg border transition ${
                        draft.difficulty === n
                          ? 'border-orange-400/60 bg-orange-400/10'
                          : 'border-slate-700 bg-slate-950/40 hover:border-slate-500'
                      }`}
                    >
                      {Array.from({ length: n }, (_, i) => (
                        <span key={i} className="h-1.5 w-1.5 rounded-full bg-orange-400" />
                      ))}
                    </button>
                  ))}
                </div>
              </Field>
            </Section>

            <Section title="Traffic & budget">
              <NumberField
                label="Baseline traffic (rps)"
                value={draft.baselineRps}
                min={LIMITS.baselineRps.min}
                max={LIMITS.baselineRps.max}
                step={10}
                onChange={(n) => up({ baselineRps: n, spikeRps: Math.max(n, draft.spikeRps) })}
              />
              <NumberField
                label="Spike traffic (rps)"
                value={draft.spikeRps}
                min={draft.baselineRps}
                max={LIMITS.spikeRps.max}
                step={50}
                onChange={(n) => up({ spikeRps: n })}
              />
              <Field label="Spike label — flashes in the HUD when it hits">
                <input
                  value={draft.spikeLabel}
                  onChange={(e) => up({ spikeLabel: e.target.value.slice(0, 60) })}
                  className={inputCls}
                />
              </Field>
              <NumberField
                label="Monthly budget"
                value={draft.budget}
                min={LIMITS.budget.min}
                max={LIMITS.budget.max}
                step={5}
                prefix="$"
                onChange={(n) => up({ budget: n })}
              />
            </Section>

            <Section title="Workload type">
              <div className="flex gap-2">
                {(
                  [
                    ['static', 'Static site', 'files only — S3 + CDN can serve everything'],
                    ['app', 'Application', 'requests need compute plus a database or model'],
                  ] as const
                ).map(([value, label, hint]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => up({ need: value })}
                    className={`flex-1 rounded-lg border px-3 py-2 text-left transition ${
                      draft.need === value
                        ? 'border-cyan-500/50 bg-cyan-500/10'
                        : 'border-slate-700 bg-slate-950/40 hover:border-slate-500'
                    }`}
                  >
                    <span className="block text-[12px] font-semibold text-slate-200">{label}</span>
                    <span className="block text-[10px] text-slate-500">{hint}</span>
                  </button>
                ))}
              </div>
              <Toggle
                label="⏳ Async pipeline"
                hint="scored on Delivery / Durability / Drain instead of instant service — for queue and streaming missions"
                on={draft.isAsync}
                onChange={(v) => up({ isAsync: v })}
              />
            </Section>

            <Section title="Events">
              <Toggle
                label="🕵️ Security probe"
                hint="attackers scan for resources wired straight to Users"
                on={draft.hasProbe}
                onChange={(v) => up({ hasProbe: v })}
              />
              <Toggle
                label="🗺️ VPC + Availability Zones"
                hint="zonal services (EC2, RDS, ElastiCache) must be placed inside an AZ box"
                on={draft.hasVpc}
                onChange={(v) => up({ hasVpc: v, hasOutage: v ? draft.hasOutage : false })}
              />
              <Toggle
                label="💥 AZ outage"
                hint="one Availability Zone fails mid-run (turns on the VPC too)"
                on={draft.hasOutage}
                onChange={(v) => up({ hasOutage: v, hasVpc: v ? true : draft.hasVpc })}
              />
              {draft.hasOutage && (
                <Field label="Outage label">
                  <input
                    value={draft.outageLabel}
                    onChange={(e) => up({ outageLabel: e.target.value.slice(0, 60) })}
                    className={inputCls}
                  />
                </Field>
              )}
            </Section>

            <Section title="Service rules">
              <p className="-mt-1 text-[11px] text-slate-500">
                Click a service to cycle: allowed → <span className="text-cyan-300">required 🧩</span> →{' '}
                <span className="text-red-300">banned 🔒</span> → allowed.
              </p>
              <div className="grid grid-cols-4 gap-1.5">
                {PALETTE.map((svc) => {
                  const required = draft.required.includes(svc.id)
                  const banned = draft.banned.includes(svc.id)
                  return (
                    <button
                      key={svc.id}
                      type="button"
                      onClick={() => cycleService(svc.id)}
                      title={svc.name}
                      className={`flex items-center gap-1.5 rounded-lg border px-2 py-1.5 text-left transition ${
                        required
                          ? 'border-cyan-500/60 bg-cyan-500/10'
                          : banned
                            ? 'border-red-500/50 bg-red-500/10 opacity-80'
                            : 'border-slate-700 bg-slate-950/40 hover:border-slate-500'
                      }`}
                    >
                      <img src={ICONS[svc.id]} alt="" className="h-5 w-5 shrink-0" />
                      <span className="min-w-0">
                        <span className="block truncate text-[10px] font-medium text-slate-200">{svc.name}</span>
                        <span className="block text-[9px] leading-tight">
                          {required ? (
                            <span className="text-cyan-300">🧩 required</span>
                          ) : banned ? (
                            <span className="text-red-300">🔒 banned</span>
                          ) : (
                            <span className="text-slate-600">allowed</span>
                          )}
                        </span>
                      </span>
                    </button>
                  )
                })}
              </div>
              {draft.banned.length > 0 && (
                <Field label="Why are they banned? (shown on the locked palette entries)">
                  <input
                    value={draft.bannedReason}
                    onChange={(e) => up({ bannedReason: e.target.value.slice(0, 120) })}
                    placeholder="e.g. Compliance: the catalog must stay relational — use RDS."
                    className={inputCls}
                  />
                </Field>
              )}
            </Section>

            <Section title="Hints (shown under 💡 Hints in the briefing)">
              {draft.hints.map((h, i) => (
                <input
                  key={i}
                  value={h}
                  onChange={(e) =>
                    up({ hints: draft.hints.map((x, j) => (j === i ? e.target.value.slice(0, 140) : x)) })
                  }
                  placeholder={`Hint ${i + 1} (optional)`}
                  className={inputCls}
                />
              ))}
            </Section>
          </div>

          <div className="hidden w-[280px] shrink-0 md:block">
            <div className="sticky top-8 space-y-2">
              <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Card preview</div>
              <Preview d={draft} />
              {!canSave && <p className="text-[11px] text-amber-400">Give it a title to enable saving.</p>}
            </div>
          </div>
        </div>

        <motion.div
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          className="sticky bottom-0 -mx-6 flex items-center justify-end gap-2 border-t border-slate-800 bg-slate-950/90 px-6 py-3 backdrop-blur"
        >
          <button
            onClick={closeEditor}
            className="rounded-xl border border-slate-600 px-4 py-2 text-[13px] font-semibold text-slate-300 transition hover:border-slate-400 hover:text-white"
          >
            Cancel
          </button>
          <button
            onClick={() => save(false)}
            disabled={!canSave}
            className="rounded-xl border border-cyan-500/50 px-4 py-2 text-[13px] font-semibold text-cyan-300 transition hover:bg-cyan-500/10 disabled:opacity-40"
          >
            💾 Save
          </button>
          <button
            onClick={() => save(true)}
            disabled={!canSave}
            className="rounded-xl bg-gradient-to-r from-cyan-500 to-indigo-500 px-5 py-2 text-[13px] font-bold text-white shadow-lg shadow-cyan-500/25 transition hover:brightness-110 disabled:opacity-40"
          >
            ▶ Save & play
          </button>
        </motion.div>
      </div>
    </div>
  )
}
