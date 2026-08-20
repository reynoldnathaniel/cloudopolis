import { create } from 'zustand'
import {
  applyNodeChanges,
  applyEdgeChanges,
  addEdge,
  type Node,
  type Edge,
  type NodeChange,
  type EdgeChange,
  type Connection,
} from '@xyflow/react'
import {
  simulateTick,
  estimateMonthlyCost,
  tipsForIssues,
  securityAudit,
  blueprintMissing,
  nextAsgCount,
  ASG_MIN,
  type NodeLoad,
  type LiteNode,
  type LiteEdge,
  type SecurityFinding,
} from './game/engine'
import { SERVICES } from './game/services'
import { getScenario, SANDBOX_ID, type Scenario } from './game/scenarios'
// Importing this module also loads + registers saved custom scenarios, so it
// must stay above the saved-game validation below (imports run before body).
import { initialCustomScenarios, setCustomScenarios } from './game/customScenarios'
import { TUTORIAL_STEPS } from './game/tutorial'
import { SANDBOX_TUTORIAL_STEPS } from './game/sandboxTutorial'

const TUTORIAL_STEP_COUNT = TUTORIAL_STEPS.length

export type GamePhase = 'edit' | 'run' | 'results'
export type RunPhaseName = 'baseline' | 'spike' | 'recovery' | 'outage' | 'probe'
export type AzId = 'a' | 'b'

export interface RunResults {
  stars: number
  mode: 'sync' | 'async'
  baselineSuccess: number
  spikeSuccess: number
  /** null when the scenario has no outage event */
  outageSuccess: number | null
  /** async only: fraction of all events processed by run end */
  delivery: number | null
  /** async only: fraction of all events lost */
  lostFraction: number | null
  /** async only: events still stuck in queues at run end */
  finalBacklog: number | null
  /** null when the scenario has no security probe */
  securityFindings: number | null
  /** required services missing or idle; null = scenario has no requirement */
  blueprintMissing: string[] | null
  costAtBaseline: number
  budget: number
  tips: string[]
}

interface PhaseAgg {
  served: number
  total: number
}

/** One sample per simulation tick, for the post-run timeline chart. */
export interface TickPoint {
  rps: number
  served: number
  total: number
  backlog: number
  cost: number
  phase: RunPhaseName
}

export type Screen = 'menu' | 'select' | 'game' | 'editor'

interface GameStore {
  screen: Screen
  /** Current tutorial step index, or null when the tutorial is off */
  tutorialStep: number | null
  scenarioId: string
  phase: GamePhase
  nodes: Node[]
  edges: Edge[]
  nodeStats: Record<string, NodeLoad>
  edgeFlows: Record<string, number>
  runPhase: RunPhaseName
  currentRps: number
  monthlyCost: number
  liveSuccess: number
  results: RunResults | null
  /** Tick-by-tick record of the last completed run (drives the results timeline; not persisted) */
  runHistory: TickPoint[]
  /** The AZ struck by the outage event (set during a run of an outage scenario) */
  struckAz: AzId | null
  deadNodeIds: string[]
  /** Nodes flagged as internet-exposed by the security probe */
  breachedNodeIds: string[]
  /** Best star count earned per scenario id (persisted) */
  bestStars: Record<string, number>
  /** Player finished the tutorial at least once (persisted) */
  tutorialDone: boolean
  /** Mission briefing overlay is open */
  briefingOpen: boolean
  /** Scenario ids whose briefing has been seen (persisted; auto-open is first-time-only) */
  briefingSeen: string[]
  /** Live traffic dial for sandbox mode (rps) */
  sandboxRps: number
  /** Sandbox workload type: 'static' is servable by S3/CDN, 'app' needs compute + a datastore */
  sandboxNeed: 'static' | 'app'
  /** Live diagnosis of what is currently breaking, shown while the sandbox runs */
  sandboxHint: string | null
  /** AZs the player has manually killed in sandbox mode */
  sandboxDeadAzs: AzId[]
  /** Times the probe has been fired this session (drives a tutorial step) */
  sandboxProbeCount: number
  /** Current step of the guided sandbox tour, or null when it is off */
  sandboxTutorialStep: number | null
  /** Player has finished or skipped the sandbox tour at least once (persisted) */
  sandboxTutorialDone: boolean
  /** Player-authored scenarios (persisted separately under simcloud-custom-v1) */
  customScenarios: Scenario[]
  /** Custom scenario being edited, or null when the editor creates a new one */
  editingScenarioId: string | null

  scenario: () => Scenario
  startGame: (withTutorial: boolean) => void
  continueGame: () => void
  openSelect: () => void
  playScenario: (id: string) => void
  openBriefing: () => void
  closeBriefing: () => void
  /** Enter the sandbox: a blank region with no budget, no scoring, and a live traffic dial.
   *  The guided tour runs automatically the first time. */
  openSandbox: () => void
  /** Start the sandbox tour from the beginning (also resets the canvas) */
  startSandboxTutorial: () => void
  sandboxTutorialNext: () => void
  sandboxTutorialSkip: () => void
  setSandboxRps: (rps: number) => void
  setSandboxNeed: (need: 'static' | 'app') => void
  /** Kill or revive an AZ mid-run (sandbox only) */
  toggleSandboxAz: (az: AzId) => void
  /** Audit the current design for internet-exposed resources, on demand (sandbox only) */
  runSandboxProbe: () => void
  /** Open the scenario editor — pass a custom scenario id to edit, or null to create */
  openEditor: (id: string | null) => void
  closeEditor: () => void
  /** Upsert an authored scenario; play=true jumps straight into it.
   *  markSeen skips the first-time briefing (authors wrote it; importers didn't). */
  saveCustomScenario: (scenario: Scenario, play: boolean, markSeen: boolean) => void
  deleteCustomScenario: (id: string) => void
  /** Merge scenarios from an exported file; ids already present are skipped (idempotent restore). */
  importCustomScenarios: (incoming: Scenario[]) => { added: number; skipped: number }
  returnToMenu: () => void
  tutorialNext: () => void
  tutorialSkip: () => void
  selectScenario: (id: string) => void
  onNodesChange: (changes: NodeChange[]) => void
  onEdgesChange: (changes: EdgeChange[]) => void
  onConnect: (conn: Connection) => void
  /** exact=true keeps the given position (drag-and-drop); otherwise VPC levels auto-place sensibly */
  addServiceNode: (serviceId: string, position: { x: number; y: number }, exact?: boolean) => void
  /** Re-parent a zonal node into an AZ box (or out of all of them). Position is relative to the new parent. */
  assignZone: (nodeId: string, az: AzId | null, position: { x: number; y: number }) => void
  startRun: () => void
  stopRun: () => void
  backToEdit: () => void
  clearCanvas: () => void
}

// Absolute canvas rectangles for the zone boxes (AZ boxes are top-level nodes,
// so these coordinates double as hit-test rects for drag-and-drop placement).
export const VPC_RECT = { x: 300, y: 60, w: 660, h: 440 }
export const AZ_RECTS: Record<AzId, { x: number; y: number; w: number; h: number }> = {
  a: { x: 330, y: 130, w: 290, h: 340 },
  b: { x: 640, y: 130, w: 290, h: 340 },
}

const USERS_NODE: Node = {
  id: 'users',
  type: 'users',
  position: { x: 40, y: 260 },
  data: {},
  deletable: false,
}

const zoneNodes = (): Node[] => [
  {
    id: 'vpc',
    type: 'vpc',
    position: { x: VPC_RECT.x, y: VPC_RECT.y },
    data: { w: VPC_RECT.w, h: VPC_RECT.h },
    draggable: false,
    selectable: false,
    focusable: false,
    deletable: false,
    zIndex: -20,
  },
  ...(['a', 'b'] as AzId[]).map((az) => ({
    id: `az-${az}`,
    type: 'az',
    position: { x: AZ_RECTS[az].x, y: AZ_RECTS[az].y },
    data: { az, w: AZ_RECTS[az].w, h: AZ_RECTS[az].h },
    draggable: false,
    selectable: false,
    focusable: false,
    deletable: false,
    zIndex: -10,
  })),
]

const initialNodesFor = (scenario: Scenario): Node[] =>
  scenario.hasVpc ? [...zoneNodes(), USERS_NODE] : [USERS_NODE]

const isZoneNode = (n: Node) => n.type === 'vpc' || n.type === 'az'

// Exported so the results timeline can label its x-axis in elapsed seconds.
export const TICK_MS = 180
const RAMP_TICKS = 5
// Ticks after the ramp settle before we start scoring a phase.
const SCORE_AFTER = RAMP_TICKS + 2

let timer: ReturnType<typeof setInterval> | null = null
let idCounter = 0

// ---- persistence (localStorage) ----

const SAVE_KEY = 'simcloud-save-v1'

interface SaveData {
  scenarioId?: string
  nodes?: Node[]
  edges?: Edge[]
  bestStars?: Record<string, number>
  tutorialDone?: boolean
  sandboxTutorialDone?: boolean
  briefingSeen?: string[]
}

const loadSave = (): SaveData => {
  try {
    const raw = localStorage.getItem(SAVE_KEY)
    return raw ? (JSON.parse(raw) as SaveData) : {}
  } catch {
    return {}
  }
}

const SAVED = loadSave()
// Only restore the canvas if the saved scenario still exists in this build.
const savedGraphOk =
  typeof SAVED.scenarioId === 'string' &&
  getScenario(SAVED.scenarioId).id === SAVED.scenarioId &&
  Array.isArray(SAVED.nodes) &&
  SAVED.nodes.length > 0

// Keep generated node ids unique across reloads.
if (savedGraphOk) {
  for (const n of SAVED.nodes!) {
    const m = /-(\d+)$/.exec(n.id)
    if (m) idCounter = Math.max(idCounter, Number(m[1]))
  }
}

const serviceIdOf = (n: Node): string =>
  n.type === 'users' ? 'users' : ((n.data as { serviceId?: string }).serviceId ?? 'users')

const toLiteEdges = (edges: Edge[]): LiteEdge[] =>
  edges.map((e) => ({ id: e.id, source: e.source, target: e.target }))

export const useGameStore = create<GameStore>()((set, get) => ({
  screen: 'menu',
  tutorialStep: null,
  scenarioId: savedGraphOk ? SAVED.scenarioId! : 'static-site',
  phase: 'edit',
  nodes: savedGraphOk ? SAVED.nodes! : [USERS_NODE],
  edges: savedGraphOk ? (SAVED.edges ?? []) : [],
  nodeStats: {},
  edgeFlows: {},
  runPhase: 'baseline',
  currentRps: 0,
  monthlyCost: 0,
  liveSuccess: 1,
  results: null,
  runHistory: [],
  struckAz: null,
  deadNodeIds: [],
  breachedNodeIds: [],
  bestStars: SAVED.bestStars ?? {},
  tutorialDone: SAVED.tutorialDone === true,
  briefingOpen: false,
  briefingSeen: Array.isArray(SAVED.briefingSeen) ? SAVED.briefingSeen : [],
  sandboxRps: 200,
  sandboxNeed: 'app',
  sandboxHint: null,
  sandboxDeadAzs: [],
  sandboxProbeCount: 0,
  sandboxTutorialStep: null,
  sandboxTutorialDone: SAVED.sandboxTutorialDone === true,
  customScenarios: initialCustomScenarios,
  editingScenarioId: null,

  scenario: () => getScenario(get().scenarioId),

  startGame: (withTutorial) => {
    get().selectScenario('static-site')
    set({
      screen: 'game',
      tutorialStep: withTutorial ? 0 : null,
      briefingOpen: withTutorial ? false : get().briefingOpen,
    })
  },

  continueGame: () => set({ screen: 'game' }),

  openSelect: () => set({ screen: 'select' }),

  playScenario: (id) => {
    if (get().scenarioId !== id) get().selectScenario(id)
    set({
      screen: 'game',
      briefingOpen: get().tutorialStep === null && !get().briefingSeen.includes(id),
    })
  },

  openBriefing: () => set({ briefingOpen: true }),

  closeBriefing: () => {
    const { scenarioId, briefingSeen } = get()
    set({
      briefingOpen: false,
      briefingSeen: briefingSeen.includes(scenarioId) ? briefingSeen : [...briefingSeen, scenarioId],
    })
  },

  openSandbox: () => {
    if (get().scenarioId !== SANDBOX_ID) get().selectScenario(SANDBOX_ID)
    set({ screen: 'game', briefingOpen: false, sandboxDeadAzs: [], breachedNodeIds: [] })
    // First visit: run the guided tour rather than dropping the player into a
    // blank region with a panel of controls and no explanation.
    if (!get().sandboxTutorialDone) get().startSandboxTutorial()
  },

  startSandboxTutorial: () => {
    get().stopRun()
    set({
      screen: 'game',
      // The tour builds a specific design from scratch, so it starts clean.
      nodes: initialNodesFor(getScenario(SANDBOX_ID)),
      edges: [],
      nodeStats: {},
      edgeFlows: {},
      phase: 'edit',
      results: null,
      deadNodeIds: [],
      breachedNodeIds: [],
      sandboxTutorialStep: 0,
      sandboxRps: 200,
      sandboxNeed: 'app',
      sandboxDeadAzs: [],
      sandboxProbeCount: 0,
      sandboxHint: null,
      tutorialStep: null,
    })
  },

  sandboxTutorialNext: () => {
    const step = get().sandboxTutorialStep
    if (step === null) return
    if (step + 1 >= SANDBOX_TUTORIAL_STEPS.length) {
      set({ sandboxTutorialStep: null, sandboxTutorialDone: true })
    } else {
      set({ sandboxTutorialStep: step + 1 })
    }
  },

  sandboxTutorialSkip: () => set({ sandboxTutorialStep: null, sandboxTutorialDone: true }),

  setSandboxRps: (rps) => set({ sandboxRps: Math.max(10, Math.min(20000, Math.round(rps))) }),

  setSandboxNeed: (need) => set({ sandboxNeed: need }),

  toggleSandboxAz: (az) => {
    const dead = get().sandboxDeadAzs
    set({ sandboxDeadAzs: dead.includes(az) ? dead.filter((a) => a !== az) : [...dead, az] })
  },

  runSandboxProbe: () => {
    const { nodes, edges } = get()
    const lite: LiteNode[] = nodes
      .filter((n) => !isZoneNode(n))
      .map((n) => ({
        id: n.id,
        serviceId: serviceIdOf(n),
        az: ((n.data as { az?: AzId }).az ?? null) as AzId | null,
        dead: false,
        unplaced: false,
      }))
    set({
      breachedNodeIds: securityAudit(lite, toLiteEdges(edges)).map((f) => f.nodeId),
      sandboxProbeCount: get().sandboxProbeCount + 1,
    })
  },

  openEditor: (id) => set({ screen: 'editor', editingScenarioId: id }),

  closeEditor: () => set({ screen: 'select', editingScenarioId: null }),

  saveCustomScenario: (scenario, play, markSeen) => {
    const list = get().customScenarios
    const exists = list.some((s) => s.id === scenario.id)
    // New scenarios go to the end of the track; edits keep their slot.
    const order = exists ? scenario.order : list.reduce((m, s) => Math.max(m, s.order), 0) + 1
    const stamped = { ...scenario, order }
    const next = exists ? list.map((s) => (s.id === stamped.id ? stamped : s)) : [...list, stamped]
    setCustomScenarios(next)
    const { briefingSeen } = get()
    set({
      customScenarios: next,
      editingScenarioId: null,
      // Authors wrote the briefing — don't auto-open it on them. Imported
      // scenarios stay unseen so the recipient gets the first-time open.
      briefingSeen:
        markSeen && !briefingSeen.includes(stamped.id) ? [...briefingSeen, stamped.id] : briefingSeen,
    })
    // Rebuild the canvas if the edited scenario is the one on the board
    // (its VPC boxes or bans may have changed under the existing graph).
    if (play || get().scenarioId === stamped.id) get().selectScenario(stamped.id)
    set({ screen: play ? 'game' : 'select' })
  },

  deleteCustomScenario: (id) => {
    const next = get().customScenarios.filter((s) => s.id !== id)
    setCustomScenarios(next)
    const { [id]: _gone, ...bestStars } = get().bestStars
    set({
      customScenarios: next,
      bestStars,
      briefingSeen: get().briefingSeen.filter((b) => b !== id),
    })
    if (get().scenarioId === id) get().selectScenario('static-site')
  },

  importCustomScenarios: (incoming) => {
    const existing = get().customScenarios
    const have = new Set(existing.map((s) => s.id))
    const fresh = incoming.filter((s) => !have.has(s.id))
    let order = existing.reduce((m, s) => Math.max(m, s.order), 0)
    const added = fresh.map((s) => ({ ...s, order: ++order }))
    const next = [...existing, ...added]
    setCustomScenarios(next)
    set({ customScenarios: next })
    return { added: added.length, skipped: incoming.length - added.length }
  },

  returnToMenu: () => {
    get().stopRun()
    set({ screen: 'menu' })
  },

  tutorialNext: () => {
    const step = get().tutorialStep
    if (step === null) return
    if (step + 1 >= TUTORIAL_STEP_COUNT) {
      set({ tutorialStep: null, tutorialDone: true })
    } else {
      set({ tutorialStep: step + 1 })
    }
  },

  tutorialSkip: () => set({ tutorialStep: null }),

  selectScenario: (id) => {
    get().stopRun()
    if (get().scenarioId !== id) set({ tutorialStep: null })
    set({
      scenarioId: id,
      briefingOpen: get().tutorialStep === null && !get().briefingSeen.includes(id),
      phase: 'edit',
      nodes: initialNodesFor(getScenario(id)),
      edges: [],
      nodeStats: {},
      edgeFlows: {},
      results: null,
      currentRps: 0,
      monthlyCost: 0,
      liveSuccess: 1,
      struckAz: null,
      deadNodeIds: [],
      breachedNodeIds: [],
    })
  },

  onNodesChange: (changes) => set({ nodes: applyNodeChanges(changes, get().nodes) }),
  onEdgesChange: (changes) => set({ edges: applyEdgeChanges(changes, get().edges) }),

  onConnect: (conn) => {
    const { edges } = get()
    if (conn.source === conn.target) return
    if (edges.some((e) => e.source === conn.source && e.target === conn.target)) return
    set({ edges: addEdge({ ...conn, type: 'traffic' }, edges) })
  },

  addServiceNode: (serviceId, position, exact = false) => {
    const scenario = get().scenario()
    if (scenario.banned?.includes(serviceId)) return
    const def = SERVICES[serviceId]
    idCounter += 1

    const node: Node = {
      id: `${serviceId}-${idCounter}`,
      type: 'service',
      position,
      data: { serviceId },
    }

    // Click-to-add in VPC levels places nodes sensibly: zonal services spawn
    // inside the emptier AZ, everything else spawns clear of the zone boxes.
    // Drag-and-drop (exact=true) always honors the drop point.
    if (!exact && scenario.hasVpc) {
      if (def.zonal) {
        const counts: Record<AzId, number> = { a: 0, b: 0 }
        for (const n of get().nodes) {
          const az = (n.data as { az?: AzId }).az
          if (n.type === 'service' && az) counts[az] += 1
        }
        const az: AzId = counts.a <= counts.b ? 'a' : 'b'
        node.parentId = `az-${az}`
        node.data = { serviceId, az }
        node.position = { x: 30 + (counts[az] % 2) * 20, y: 44 + counts[az] * 92 }
      } else {
        node.position = { x: 130 + Math.random() * 120, y: 90 + Math.random() * 130 }
      }
    }

    set({ nodes: [...get().nodes, node] })
  },

  assignZone: (nodeId, az, position) => {
    set({
      nodes: get().nodes.map((n) => {
        if (n.id !== nodeId) return n
        const data = { ...(n.data as { serviceId?: string }), az: az ?? undefined }
        return {
          ...n,
          parentId: az ? `az-${az}` : undefined,
          position,
          data,
        }
      }),
    })
  },

  startRun: () => {
    const state = get()
    if (state.phase === 'run') return
    const scenario = state.scenario()

    // ---- sandbox: an endless run driven by the live traffic dial ----
    // Same tick engine, but no phases, no scoring, no end. Traffic, AZ
    // failures, and the probe are all under the player's hand instead of a
    // script's, which is what makes it usable as a whiteboard in front of an
    // audience.
    if (scenario.id === SANDBOX_ID) {
      const asgCounts: Record<string, number> = {}
      for (const n of state.nodes) {
        if (n.type === 'service' && serviceIdOf(n) === 'asg') asgCounts[n.id] = ASG_MIN
      }
      let backlogs: Record<string, number> = {}
      set({
        phase: 'run',
        results: null,
        runHistory: [],
        runPhase: 'baseline',
        liveSuccess: 1,
        struckAz: null,
        deadNodeIds: [],
      })

      timer = setInterval(() => {
        const { nodes, edges, sandboxRps, sandboxDeadAzs, sandboxNeed } = get()
        // Read the workload toggle live, so switching static/app mid-run applies.
        const live = { ...scenario, need: sandboxNeed }
        const lite: LiteNode[] = []
        const deadIds: string[] = []
        for (const n of nodes) {
          if (isZoneNode(n)) continue
          const serviceId = serviceIdOf(n)
          const def = SERVICES[serviceId]
          const az = ((n.data as { az?: AzId }).az ?? null) as AzId | null
          const dead = def.zonal && az !== null && sandboxDeadAzs.includes(az)
          if (dead) deadIds.push(n.id)
          lite.push({ id: n.id, serviceId, az, dead, unplaced: def.zonal && az === null })
        }

        const prevStats = get().nodeStats
        for (const id of Object.keys(asgCounts)) {
          asgCounts[id] = nextAsgCount(asgCounts[id], prevStats[id]?.inRps ?? 0)
        }

        const stats = simulateTick(lite, toLiteEdges(edges), sandboxRps, live, asgCounts, backlogs)
        backlogs = stats.queueBacklogs
        set({
          nodeStats: stats.nodeLoads,
          edgeFlows: stats.edgeFlows,
          currentRps: sandboxRps,
          monthlyCost: estimateMonthlyCost(lite, stats.nodeLoads),
          liveSuccess: stats.total > 0 ? stats.served / stats.total : 1,
          deadNodeIds: deadIds,
          sandboxHint: tipsForIssues([...stats.issues])[0] ?? null,
        })
      }, TICK_MS)
      return
    }

    const probePhase: { name: RunPhaseName; rps: number; ticks: number }[] = scenario.hasProbe
      ? [{ name: 'probe', rps: scenario.baselineRps, ticks: 12 }]
      : []
    const phases: { name: RunPhaseName; rps: number; ticks: number }[] = scenario.hasOutage
      ? [
          { name: 'baseline', rps: scenario.baselineRps, ticks: 22 },
          { name: 'spike', rps: scenario.spikeRps, ticks: 24 },
          { name: 'recovery', rps: scenario.baselineRps, ticks: 6 },
          ...probePhase,
          { name: 'outage', rps: scenario.baselineRps, ticks: 22 },
          { name: 'recovery', rps: scenario.baselineRps, ticks: 6 },
        ]
      : [
          { name: 'baseline', rps: scenario.baselineRps, ticks: 24 },
          { name: 'spike', rps: scenario.spikeRps, ticks: 26 },
          { name: 'recovery', rps: scenario.baselineRps, ticks: 6 },
          ...probePhase,
          { name: 'recovery', rps: scenario.baselineRps, ticks: 6 },
        ]

    // The outage strikes the AZ holding the most zonal nodes — the worst case.
    let struckAz: AzId | null = null
    if (scenario.hasOutage) {
      const counts: Record<AzId, number> = { a: 0, b: 0 }
      for (const n of state.nodes) {
        const az = (n.data as { az?: AzId }).az
        if (n.type === 'service' && az && SERVICES[serviceIdOf(n)].zonal) counts[az] += 1
      }
      struckAz = counts.a >= counts.b ? 'a' : 'b'
    }

    const agg: Record<RunPhaseName, PhaseAgg> = {
      baseline: { served: 0, total: 0 },
      spike: { served: 0, total: 0 },
      recovery: { served: 0, total: 0 },
      outage: { served: 0, total: 0 },
      probe: { served: 0, total: 0 },
    }
    const allIssues = new Set<string>()
    let costAtBaseline = 0
    let phaseIdx = 0
    let tickInPhase = 0
    let prevRps = 0
    let ticksDone = 0
    const startedAt = performance.now()

    // Auto Scaling groups start at minimum size and react to observed load.
    const asgCounts: Record<string, number> = {}
    for (const n of state.nodes) {
      if (n.type === 'service' && serviceIdOf(n) === 'asg') asgCounts[n.id] = ASG_MIN
    }

    let probeFindings: SecurityFinding[] | null = null

    // Queue backlogs carry between ticks; async scoring is run-wide.
    let backlogState: Record<string, number> = {}
    let runServed = 0
    let runTotal = 0
    let runDropped = 0
    // One sample per tick; published to the store once, when the run ends.
    const history: TickPoint[] = []
    let blueprintMiss: string[] | null = scenario.requiredServices ? scenario.requiredServices.slice() : null

    set({
      phase: 'run',
      results: null,
      runHistory: [],
      runPhase: 'baseline',
      liveSuccess: 1,
      struckAz,
      deadNodeIds: [],
      breachedNodeIds: [],
    })

    const doTick = () => {
      const { nodes, edges } = get()
      const ph = phases[phaseIdx]
      const ramp = Math.min(1, (tickInPhase + 1) / RAMP_TICKS)
      const rps = Math.round(prevRps + (ph.rps - prevRps) * ramp)

      const outageNow = ph.name === 'outage'
      const lite: LiteNode[] = []
      const deadIds: string[] = []
      for (const n of nodes) {
        if (isZoneNode(n)) continue
        const serviceId = serviceIdOf(n)
        const def = SERVICES[serviceId]
        const az = ((n.data as { az?: AzId }).az ?? null) as AzId | null
        const unplaced = scenario.hasVpc === true && def.zonal && az === null
        const dead = outageNow && struckAz !== null && def.zonal && az === struckAz
        if (dead) deadIds.push(n.id)
        lite.push({ id: n.id, serviceId, az, dead, unplaced })
      }

      // ASGs scale toward last tick's observed load — spin-up takes time.
      const prevStats = get().nodeStats
      for (const id of Object.keys(asgCounts)) {
        asgCounts[id] = nextAsgCount(asgCounts[id], prevStats[id]?.inRps ?? 0)
      }

      // The probe audits the design once, the moment the phase begins.
      if (ph.name === 'probe' && probeFindings === null) {
        probeFindings = securityAudit(lite, toLiteEdges(edges))
        set({ breachedNodeIds: probeFindings.map((f) => f.nodeId) })
      }

      const stats = simulateTick(lite, toLiteEdges(edges), rps, scenario, asgCounts, backlogState)
      backlogState = stats.queueBacklogs
      const cost = estimateMonthlyCost(lite, stats.nodeLoads)
      history.push({
        rps,
        served: stats.served,
        total: stats.total,
        backlog: Object.values(backlogState).reduce((a, b) => a + b, 0),
        cost,
        phase: ph.name,
      })
      stats.issues.forEach((i) => allIssues.add(i))
      runServed += stats.served
      runDropped += stats.dropped
      runTotal += stats.total

      if (tickInPhase >= SCORE_AFTER) {
        agg[ph.name].served += stats.served
        agg[ph.name].total += stats.total
      }
      if (ph.name === 'baseline' && tickInPhase === ph.ticks - 1) {
        costAtBaseline = cost
        if (scenario.requiredServices) {
          blueprintMiss = blueprintMissing(scenario.requiredServices, lite, stats.nodeLoads)
        }
      }

      const phaseAgg = agg[ph.name]
      const liveSuccess = scenario.async
        ? runTotal > 0
          ? runServed / runTotal
          : 1
        : phaseAgg.total > 0
          ? phaseAgg.served / phaseAgg.total
          : stats.total > 0
            ? stats.served / stats.total
            : 1

      set({
        nodeStats: stats.nodeLoads,
        edgeFlows: stats.edgeFlows,
        currentRps: rps,
        monthlyCost: cost,
        runPhase: ph.name,
        liveSuccess,
        deadNodeIds: deadIds,
      })

      tickInPhase += 1
      ticksDone += 1
      if (tickInPhase >= ph.ticks) {
        prevRps = ph.rps
        phaseIdx += 1
        tickInPhase = 0
        if (phaseIdx >= phases.length) {
          if (timer) clearInterval(timer)
          timer = null

          const baselineSuccess = agg.baseline.total > 0 ? agg.baseline.served / agg.baseline.total : 0
          const spikeSuccess = agg.spike.total > 0 ? agg.spike.served / agg.spike.total : 0
          const outageSuccess = scenario.hasOutage
            ? agg.outage.total > 0
              ? agg.outage.served / agg.outage.total
              : 0
            : null
          const findings = scenario.hasProbe ? (probeFindings ?? []) : null
          const secure = findings === null || findings.length === 0
          const blueprintOk = blueprintMiss === null || blueprintMiss.length === 0

          const isAsync = scenario.async === true
          const delivery = isAsync ? (runTotal > 0 ? runServed / runTotal : 0) : null
          const lostFraction = isAsync ? (runTotal > 0 ? runDropped / runTotal : 0) : null
          const finalBacklog = isAsync
            ? Math.round(Object.values(backlogState).reduce((a, b) => a + b, 0))
            : null

          let star1: boolean
          let star2: boolean
          if (isAsync) {
            star1 = (delivery ?? 0) >= 0.98
            star2 =
              star1 &&
              (lostFraction ?? 1) <= 0.01 &&
              (finalBacklog ?? 1) <= 1 &&
              secure &&
              blueprintOk
          } else {
            star1 = baselineSuccess >= 0.98
            star2 =
              star1 &&
              spikeSuccess >= 0.95 &&
              (outageSuccess === null || outageSuccess >= 0.95) &&
              secure &&
              blueprintOk
          }
          const star3 = star2 && costAtBaseline <= scenario.budget
          const stars = (star1 ? 1 : 0) + (star2 ? 1 : 0) + (star3 ? 1 : 0)

          const tips = tipsForIssues([...allIssues])
          if (findings) tips.push(...findings.map((f) => f.tip))
          if (blueprintMiss && blueprintMiss.length > 0) {
            const names = blueprintMiss.map((id) => SERVICES[id]?.name ?? id).join(', ')
            tips.push(`Blueprint: this scenario requires ${names} in the serving path.`)
          }
          if (star2 && costAtBaseline > scenario.budget) {
            tips.push(
              `Solid architecture, but $${costAtBaseline}/mo blows the $${scenario.budget} budget. Serverless services cost near-zero at low traffic.`,
            )
          }

          set({
            phase: 'results',
            runHistory: history,
            bestStars: {
              ...get().bestStars,
              [scenario.id]: Math.max(get().bestStars[scenario.id] ?? 0, stars),
            },
            results: {
              stars,
              mode: isAsync ? ('async' as const) : ('sync' as const),
              baselineSuccess,
              spikeSuccess,
              outageSuccess,
              delivery,
              lostFraction,
              finalBacklog,
              securityFindings: findings === null ? null : findings.length,
              blueprintMissing: blueprintMiss,
              costAtBaseline,
              budget: scenario.budget,
              tips,
            },
            deadNodeIds: [],
          })
        }
      }
    }

    // Time-based scheduling: browsers throttle setInterval in hidden tabs, so on
    // each fire we process however many ticks wall-clock time says are owed
    // (capped per fire to avoid jank after a long throttle).
    const totalTicks = phases.reduce((sum, p) => sum + p.ticks, 0)
    timer = setInterval(() => {
      const owed = Math.min(totalTicks, Math.floor((performance.now() - startedAt) / TICK_MS))
      let burst = 0
      while (ticksDone < owed && burst < 20 && timer !== null) {
        doTick()
        burst += 1
      }
    }, TICK_MS)
  },

  stopRun: () => {
    if (timer) clearInterval(timer)
    timer = null
    if (get().phase === 'run') {
      set({
        phase: 'edit',
        edgeFlows: {},
        nodeStats: {},
        currentRps: 0,
        deadNodeIds: [],
        struckAz: null,
        breachedNodeIds: [],
      })
    }
  },

  backToEdit: () => {
    get().stopRun()
    set({
      phase: 'edit',
      edgeFlows: {},
      nodeStats: {},
      currentRps: 0,
      results: null,
      deadNodeIds: [],
      struckAz: null,
      breachedNodeIds: [],
    })
  },

  clearCanvas: () => {
    get().stopRun()
    set({
      nodes: initialNodesFor(get().scenario()),
      edges: [],
      nodeStats: {},
      edgeFlows: {},
      results: null,
      phase: 'edit',
      deadNodeIds: [],
      struckAz: null,
      breachedNodeIds: [],
    })
  },
}))

// Persist progress on every store change, throttled. The graph is tiny, so a
// JSON serialize every ~800ms during runs is negligible.
let persistTimer: ReturnType<typeof setTimeout> | null = null
useGameStore.subscribe(() => {
  if (persistTimer) return
  persistTimer = setTimeout(() => {
    persistTimer = null
    const s = useGameStore.getState()
    try {
      localStorage.setItem(
        SAVE_KEY,
        JSON.stringify({
          scenarioId: s.scenarioId,
          nodes: s.nodes,
          edges: s.edges,
          bestStars: s.bestStars,
          tutorialDone: s.tutorialDone,
          sandboxTutorialDone: s.sandboxTutorialDone,
          briefingSeen: s.briefingSeen,
        }),
      )
    } catch {
      // Storage full or blocked — losing autosave is not fatal.
    }
  }, 800)
})
