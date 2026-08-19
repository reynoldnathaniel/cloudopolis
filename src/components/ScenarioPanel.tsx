import { TRACKS } from '../game/scenarios'
import { SERVICES } from '../game/services'
import { ICONS } from '../game/icons'
import { estimateMonthlyCost } from '../game/engine'
import { useGameStore } from '../store'
import { useTutorialHighlight } from './TutorialCoach'

function Chip({ tone, children }: { tone: string; children: React.ReactNode }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md bg-slate-900/80 px-1.5 py-1 text-[11px] font-medium leading-none ${tone}`}
    >
      {children}
    </span>
  )
}

export function ScenarioPanel() {
  const scenario = useGameStore((s) => s.scenario())
  const phase = useGameStore((s) => s.phase)
  const nodes = useGameStore((s) => s.nodes)
  const edges = useGameStore((s) => s.edges)
  const startRun = useGameStore((s) => s.startRun)
  const clearCanvas = useGameStore((s) => s.clearCanvas)
  const openSelect = useGameStore((s) => s.openSelect)
  const openBriefing = useGameStore((s) => s.openBriefing)
  const bestStars = useGameStore((s) => s.bestStars)
  const highlight = useTutorialHighlight()

  const track = TRACKS.find((t) => t.id === scenario.track)
  const earned = bestStars[scenario.id] ?? 0
  const editing = phase === 'edit'
  const fixedCost = estimateMonthlyCost(
    nodes.map((n) => ({
      id: n.id,
      serviceId: n.type === 'users' ? 'users' : ((n.data as { serviceId?: string }).serviceId ?? 'users'),
    })),
  )
  const usersConnected = edges.some((e) => e.source === 'users')
  const canRun = editing && usersConnected

  return (
    <div className="space-y-3">
      <button
        onClick={openSelect}
        disabled={phase === 'run'}
        className="flex w-full items-center justify-between rounded-lg border border-slate-700 bg-slate-800/50 px-3 py-1.5 text-[12px] text-slate-400 transition hover:border-slate-500 hover:text-slate-200 disabled:opacity-50"
      >
        <span>
          {track?.emoji} {track?.name} · #{scenario.order}
        </span>
        <span className="font-semibold text-cyan-400">⇄ change scenario</span>
      </button>

      <div
        className={`rounded-xl border p-3 ${
          highlight === 'brief'
            ? 'animate-pulse border-cyan-400 bg-cyan-500/5 ring-2 ring-cyan-400/50'
            : 'border-slate-700/70 bg-slate-800/40'
        }`}
      >
        <div className="flex items-center gap-2">
          <span className="text-xl">{scenario.emoji}</span>
          <h3 className="flex-1 text-[15px] font-bold text-slate-100">{scenario.title}</h3>
          <span className="text-[11px] tracking-tight">
            {[1, 2, 3].map((i) => (
              <span key={i} className={i <= earned ? 'text-amber-400' : 'text-slate-700'}>
                ★
              </span>
            ))}
          </span>
        </div>

        <div className="mt-2.5 flex flex-wrap gap-1.5">
          <Chip tone="text-sky-300">
            📊 {scenario.baselineRps.toLocaleString()} → {scenario.spikeRps.toLocaleString()} rps
          </Chip>
          <Chip tone="text-emerald-300">💰 ≤ ${scenario.budget}/mo</Chip>
          {scenario.async && <Chip tone="text-indigo-300">⏳ async · zero loss</Chip>}
          {scenario.hasOutage && <Chip tone="text-fuchsia-300">💥 AZ outage</Chip>}
          {scenario.hasProbe && <Chip tone="text-amber-300">🕵️ probe</Chip>}
        </div>

        {(scenario.requiredServices?.length ?? 0) > 0 && (
          <div className="mt-2.5 flex items-center gap-2">
            <span className="text-[11px] text-slate-500">Must use</span>
            <span className="flex gap-1.5">
              {scenario.requiredServices!.map((id) => (
                <img
                  key={id}
                  src={ICONS[id]}
                  alt={SERVICES[id]?.name ?? id}
                  title={`${SERVICES[id]?.fullName ?? id} — required by this scenario`}
                  className="h-6 w-6 rounded-md"
                  draggable={false}
                />
              ))}
            </span>
          </div>
        )}

        <button
          onClick={openBriefing}
          className="mt-3 w-full rounded-lg border border-slate-700 px-3 py-1.5 text-[12px] font-medium text-cyan-400 transition hover:border-cyan-500/50 hover:bg-cyan-500/5"
        >
          📖 Read the full briefing
        </button>
      </div>

      <div className="flex items-center justify-between rounded-lg border border-slate-700/70 bg-slate-800/40 px-3 py-2">
        <span className="text-[11px] uppercase tracking-wider text-slate-500">Est. fixed cost</span>
        <span className={`text-sm font-bold ${fixedCost > scenario.budget ? 'text-red-400' : 'text-emerald-400'}`}>
          ${fixedCost}
          <span className="text-[11px] font-normal text-slate-500">/mo + usage</span>
        </span>
      </div>

      <div className="flex gap-2">
        <button
          onClick={startRun}
          disabled={!canRun}
          className={`flex-1 rounded-xl bg-gradient-to-r from-cyan-500 to-indigo-500 px-4 py-2.5 text-sm font-bold text-white shadow-lg shadow-cyan-500/25 transition hover:brightness-110 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none ${
            highlight === 'simulate' && canRun ? 'animate-pulse ring-2 ring-cyan-300' : ''
          }`}
        >
          {phase === 'run' ? 'Running…' : '▶ Simulate'}
        </button>
        <button
          onClick={clearCanvas}
          disabled={phase === 'run'}
          title="Clear the canvas"
          className="rounded-xl border border-slate-700 px-3 py-2.5 text-sm text-slate-400 transition hover:border-red-500/50 hover:text-red-400 disabled:opacity-40"
        >
          ✕
        </button>
      </div>
      {editing && !usersConnected && (
        <p className="text-center text-[11px] text-slate-500">Connect Users to something to simulate.</p>
      )}
    </div>
  )
}
