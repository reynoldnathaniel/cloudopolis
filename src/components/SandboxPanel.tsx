// The sandbox control panel — replaces the mission card when the sandbox is
// open. No objectives, no budget, no stars: a live traffic dial plus chaos you
// trigger yourself, which is what turns the canvas into a whiteboard that runs.

import { estimateMonthlyCost } from '../game/engine'
import { useGameStore, type AzId } from '../store'

const PRESETS = [100, 500, 2000, 10000]

export function SandboxPanel() {
  const phase = useGameStore((s) => s.phase)
  const nodes = useGameStore((s) => s.nodes)
  const edges = useGameStore((s) => s.edges)
  const rps = useGameStore((s) => s.sandboxRps)
  const setRps = useGameStore((s) => s.setSandboxRps)
  const need = useGameStore((s) => s.sandboxNeed)
  const setNeed = useGameStore((s) => s.setSandboxNeed)
  const hint = useGameStore((s) => s.sandboxHint)
  const deadAzs = useGameStore((s) => s.sandboxDeadAzs)
  const toggleAz = useGameStore((s) => s.toggleSandboxAz)
  const runProbe = useGameStore((s) => s.runSandboxProbe)
  const breached = useGameStore((s) => s.breachedNodeIds)
  const startRun = useGameStore((s) => s.startRun)
  const stopRun = useGameStore((s) => s.stopRun)
  const clearCanvas = useGameStore((s) => s.clearCanvas)
  const openSelect = useGameStore((s) => s.openSelect)
  const liveSuccess = useGameStore((s) => s.liveSuccess)

  const running = phase === 'run'
  const cost = estimateMonthlyCost(
    nodes.map((n) => ({
      id: n.id,
      serviceId: n.type === 'users' ? 'users' : ((n.data as { serviceId?: string }).serviceId ?? 'users'),
    })),
  )
  const usersConnected = edges.some((e) => e.source === 'users')

  return (
    <div className="space-y-3">
      <button
        onClick={openSelect}
        className="flex w-full items-center justify-between rounded-lg border border-slate-700 bg-slate-800/50 px-3 py-1.5 text-[12px] text-slate-400 transition hover:border-slate-500 hover:text-slate-200"
      >
        <span>🧪 Sandbox</span>
        <span className="font-semibold text-cyan-400">⇄ scenarios</span>
      </button>

      <div className="rounded-xl border border-cyan-500/30 bg-cyan-500/5 p-3">
        <div className="flex items-center gap-2">
          <span className="text-xl">🧪</span>
          <div className="flex-1">
            <h3 className="text-[15px] font-bold text-slate-100">Sandbox</h3>
            <p className="text-[10px] text-slate-500">No budget · no scoring · endless run</p>
          </div>
        </div>

        {/* live traffic dial */}
        <div className="mt-3">
          <div className="mb-1 flex items-baseline justify-between">
            <span className="text-[11px] font-medium text-slate-400">Traffic</span>
            <span className="text-[13px] font-bold tabular-nums text-sky-300">
              {rps.toLocaleString()} <span className="text-[10px] font-normal text-slate-500">rps</span>
            </span>
          </div>
          {/* Exponential-ish feel: the slider is linear over a wide range, and the
              presets give quick jumps to the orders of magnitude that matter. */}
          <input
            type="range"
            min={10}
            max={20000}
            step={10}
            value={rps}
            onChange={(e) => setRps(Number(e.target.value))}
            className="w-full accent-sky-500"
          />
          <div className="mt-1 flex gap-1">
            {PRESETS.map((p) => (
              <button
                key={p}
                onClick={() => setRps(p)}
                className={`flex-1 rounded-md px-1 py-0.5 text-[9.5px] tabular-nums transition ${
                  rps === p
                    ? 'bg-sky-500/25 text-sky-200'
                    : 'bg-slate-800/70 text-slate-400 hover:bg-slate-700'
                }`}
              >
                {p >= 1000 ? `${p / 1000}k` : p}
              </button>
            ))}
          </div>
        </div>

        {/* workload type — decides what counts as "served" */}
        <div className="mt-3">
          <div className="mb-1 text-[11px] font-medium text-slate-400">Workload</div>
          <div className="flex gap-1">
            {(
              [
                ['static', '📄 Static', 'S3 or a CDN can serve it'],
                ['app', '⚙️ App', 'needs compute + a datastore'],
              ] as const
            ).map(([value, label, hint]) => (
              <button
                key={value}
                onClick={() => setNeed(value)}
                title={hint}
                className={`flex-1 rounded-md border px-1.5 py-1 text-[10px] font-semibold transition ${
                  need === value
                    ? 'border-cyan-500/60 bg-cyan-500/15 text-cyan-200'
                    : 'border-slate-700 bg-slate-800/60 text-slate-400 hover:border-slate-500'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* live readouts */}
        <div className="mt-3 grid grid-cols-2 gap-2">
          <div className="rounded-lg bg-slate-900/60 px-2 py-1.5">
            <div className="text-[9px] uppercase tracking-wide text-slate-500">Served</div>
            <div
              className={`text-[13px] font-bold tabular-nums ${
                running ? (liveSuccess >= 0.99 ? 'text-emerald-400' : 'text-amber-400') : 'text-slate-600'
              }`}
            >
              {running ? `${Math.round(liveSuccess * 100)}%` : '—'}
            </div>
          </div>
          <div className="rounded-lg bg-slate-900/60 px-2 py-1.5">
            <div className="text-[9px] uppercase tracking-wide text-slate-500">Fixed cost</div>
            <div className="text-[13px] font-bold tabular-nums text-slate-300">${cost}</div>
          </div>
        </div>

        {/* live diagnosis — the sandbox has no results modal, so say it here */}
        {running && hint && (
          <div className="mt-2 rounded-lg border border-amber-500/20 bg-amber-500/5 p-2 text-[10px] leading-snug text-amber-200/90">
            {hint}
          </div>
        )}

        {/* chaos on demand */}
        <div className="mt-3">
          <div className="mb-1 text-[10px] font-bold uppercase tracking-wider text-slate-500">Chaos</div>
          <div className="flex gap-1">
            {(['a', 'b'] as AzId[]).map((az) => {
              const dead = deadAzs.includes(az)
              return (
                <button
                  key={az}
                  onClick={() => toggleAz(az)}
                  title={dead ? `Bring AZ-${az.toUpperCase()} back online` : `Kill AZ-${az.toUpperCase()}`}
                  className={`flex-1 rounded-md border px-1.5 py-1 text-[10px] font-semibold transition ${
                    dead
                      ? 'border-fuchsia-500/60 bg-fuchsia-500/20 text-fuchsia-200'
                      : 'border-slate-700 bg-slate-800/60 text-slate-300 hover:border-fuchsia-500/50'
                  }`}
                >
                  {dead ? '⚡ revive' : '💥 kill'} AZ-{az.toUpperCase()}
                </button>
              )
            })}
          </div>
          <button
            onClick={runProbe}
            className="mt-1 w-full rounded-md border border-slate-700 bg-slate-800/60 px-1.5 py-1 text-[10px] font-semibold text-slate-300 transition hover:border-amber-500/50"
          >
            🕵️ Run security probe
            {breached.length > 0 && (
              <span className="ml-1 text-red-300">· {breached.length} exposed</span>
            )}
          </button>
        </div>
      </div>

      <div className="flex gap-2">
        <button
          onClick={running ? stopRun : startRun}
          disabled={!running && !usersConnected}
          className={`flex-1 rounded-xl px-4 py-2.5 text-sm font-bold text-white shadow-lg transition disabled:cursor-not-allowed disabled:opacity-40 ${
            running
              ? 'bg-gradient-to-r from-rose-500 to-orange-500 shadow-rose-500/25 hover:brightness-110'
              : 'bg-gradient-to-r from-cyan-500 to-indigo-500 shadow-cyan-500/25 hover:brightness-110'
          }`}
        >
          {running ? '■ Stop' : '▶ Run'}
        </button>
        <button
          onClick={clearCanvas}
          title="Clear the canvas"
          className="rounded-xl border border-slate-600 px-3 py-2.5 text-sm text-slate-400 transition hover:border-slate-400 hover:text-white"
        >
          ✕
        </button>
      </div>
      {!running && !usersConnected && (
        <p className="-mt-1 text-center text-[11px] text-slate-500">Connect Users to something to run.</p>
      )}
    </div>
  )
}
