// The game itself: the React Flow canvas, the sidebar, and every overlay that
// can appear over a run. Split out of App so that none of it — React Flow most
// of all, which is the single biggest dependency in the project — is in the
// chunk that paints the main menu.

import { useCallback, useEffect, useState } from 'react'
import {
  applyNodeChanges,
  applyEdgeChanges,
  addEdge,
  ReactFlow,
  ReactFlowProvider,
  Background,
  BackgroundVariant,
  Controls,
  ControlButton,
  MiniMap,
  useReactFlow,
  type Node,
  type IsValidConnection,
  type OnConnectEnd,
  type OnNodeDrag,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import {
  useGameStore,
  provideFlowHelpers,
  AZ_RECTS,
  REGIONS,
  REGION_RECTS,
  type AzId,
  type RegionId,
} from '../store'
import { ServiceNode, UsersNode } from './ServiceNode'
import { VpcNode, AzNode, RegionNode } from './ZoneNode'
import { TrafficEdge } from './TrafficEdge'
import { Palette } from './Palette'
import { ScenarioPanel } from './ScenarioPanel'
import { SandboxPanel } from './SandboxPanel'
import { HUD } from './HUD'
import { ResultsModal } from './ResultsModal'
import { MissionBriefing } from './MissionBriefing'
import { TutorialCoach, SandboxCoach } from './TutorialCoach'
import { SolutionNotes } from './SolutionNotes'
import { DecisionModal } from './DecisionModal'
import { CATEGORY_COLORS, SERVICES } from '../game/services'
import { canConnect, connectionError } from '../game/connections'
import { exportCanvasPng } from '../game/exportImage'
import { SANDBOX_ID } from '../game/scenarios'

// The store keeps its React Flow dependency at arm's length so the main menu
// does not have to download a graph library. This is where it gets handed over,
// and this module is the only place a canvas can exist.
provideFlowHelpers({ applyNodeChanges, applyEdgeChanges, addEdge })

const nodeTypes = { service: ServiceNode, users: UsersNode, vpc: VpcNode, az: AzNode, region: RegionNode }
const edgeTypes = { traffic: TrafficEdge }

const NODE_W = 150
const NODE_H = 70

/** Which AZ box contains this absolute canvas point (node center)? */
function azAtPoint(x: number, y: number): AzId | null {
  for (const az of ['a', 'b'] as AzId[]) {
    const r = AZ_RECTS[az]
    if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return az
  }
  return null
}

/** Which Region box contains this absolute canvas point (node center)? */
function regionAtPoint(x: number, y: number): RegionId | null {
  for (const { id } of REGIONS) {
    const r = REGION_RECTS[id]
    if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return id
  }
  return null
}

const serviceIdOfNode = (n: { type?: string; data: unknown }): string =>
  n.type === 'users' ? 'users' : ((n.data as { serviceId?: string }).serviceId ?? 'users')

function minimapColor(node: Node): string {
  if (node.type === 'users') return CATEGORY_COLORS.client
  if (node.type === 'vpc' || node.type === 'az') return 'rgba(56, 116, 203, 0.15)'
  const serviceId = (node.data as { serviceId?: string }).serviceId
  const def = serviceId ? SERVICES[serviceId] : undefined
  return def ? CATEGORY_COLORS[def.category] : '#475569'
}

function Canvas() {
  const nodes = useGameStore((s) => s.nodes)
  const edges = useGameStore((s) => s.edges)
  const onNodesChange = useGameStore((s) => s.onNodesChange)
  const onEdgesChange = useGameStore((s) => s.onEdgesChange)
  const onConnect = useGameStore((s) => s.onConnect)
  const addServiceNode = useGameStore((s) => s.addServiceNode)
  const assignZone = useGameStore((s) => s.assignZone)
  const assignRegion = useGameStore((s) => s.assignRegion)
  const editing = useGameStore((s) => s.phase === 'edit')
  const hasVpc = useGameStore((s) => s.scenario().hasVpc === true)
  const multiRegion = useGameStore((s) => s.scenario().multiRegion === true)
  const scenarioTitle = useGameStore((s) => s.scenario().title)
  const tutorialActive = useGameStore((s) => s.tutorialStep !== null)
  const sandboxTourActive = useGameStore((s) => s.sandboxTutorialStep !== null)
  // The reference-answer card takes the same bottom-center slot as the hint line.
  const notesOpen = useGameStore((s) => s.solutionNotes !== null)
  const beginDrag = useGameStore((s) => s.beginDrag)
  const endDrag = useGameStore((s) => s.endDrag)
  const undo = useGameStore((s) => s.undo)
  const redo = useGameStore((s) => s.redo)
  const canUndo = useGameStore((s) => s.past.length > 0)
  const canRedo = useGameStore((s) => s.future.length > 0)
  const { screenToFlowPosition, getInternalNode, getNodesBounds } = useReactFlow()
  const [rejected, setRejected] = useState<{ message: string; at: number } | null>(null)

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      const serviceId = e.dataTransfer.getData('application/simcloud')
      if (!serviceId) return
      const pos = screenToFlowPosition({ x: e.clientX, y: e.clientY })
      addServiceNode(serviceId, { x: pos.x - NODE_W / 2, y: pos.y - NODE_H / 2 }, true)
      const latest = useGameStore.getState().nodes
      const added = latest[latest.length - 1]
      if (!added) return
      // addServiceNode auto-places into a box; if the user dropped at a specific
      // point, honor that point when it lands inside one.
      if (multiRegion && SERVICES[serviceId]?.global !== true) {
        const region = regionAtPoint(pos.x, pos.y)
        if (region) {
          assignRegion(added.id, region, {
            x: pos.x - REGION_RECTS[region].x - NODE_W / 2,
            y: pos.y - REGION_RECTS[region].y - NODE_H / 2,
          })
        }
      } else if (hasVpc && SERVICES[serviceId]?.zonal) {
        const az = azAtPoint(pos.x, pos.y)
        if (az) {
          assignZone(added.id, az, {
            x: pos.x - AZ_RECTS[az].x - NODE_W / 2,
            y: pos.y - AZ_RECTS[az].y - NODE_H / 2,
          })
        }
      }
    },
    [screenToFlowPosition, addServiceNode, assignZone, assignRegion, hasVpc, multiRegion],
  )

  // Re-parent services into/out of their container box when dragging ends —
  // AZ boxes in VPC levels, Region boxes in the multi-region finale.
  const onNodeDragStop: OnNodeDrag = useCallback(
    (_e, node) => {
      if (node.type !== 'service') return
      const def = SERVICES[(node.data as { serviceId?: string }).serviceId ?? '']
      if (!def) return
      const internal = getInternalNode(node.id)
      const abs = internal?.internals.positionAbsolute ?? node.position
      const cx = abs.x + NODE_W / 2
      const cy = abs.y + NODE_H / 2

      if (multiRegion) {
        if (def.global === true) return
        const region = regionAtPoint(cx, cy)
        const current = ((node.data as { region?: RegionId }).region ?? null) as RegionId | null
        if (region === current) return
        assignRegion(
          node.id,
          region,
          region
            ? { x: abs.x - REGION_RECTS[region].x, y: abs.y - REGION_RECTS[region].y }
            : { x: abs.x, y: abs.y },
        )
        return
      }

      if (!hasVpc || !def.zonal) return
      const az = azAtPoint(cx, cy)
      const currentAz = ((node.data as { az?: AzId }).az ?? null) as AzId | null
      if (az === currentAz) return
      const position = az
        ? { x: abs.x - AZ_RECTS[az].x, y: abs.y - AZ_RECTS[az].y }
        : { x: abs.x, y: abs.y }
      assignZone(node.id, az, position)
    },
    [hasVpc, multiRegion, getInternalNode, assignZone, assignRegion],
  )

  // React Flow fires onNodesChange for every frame of a drag, plus for pure-UI
  // changes like selection. Committing history there would give you an undo
  // stack that walks a node back across the canvas one pixel at a time, so the
  // drag boundary is what gets recorded instead — once, and only if it moved.
  const onNodeDragStart = useCallback(() => beginDrag(), [beginDrag])
  const onNodeDragStopCommit: OnNodeDrag = useCallback(
    (e, node, nodes) => {
      onNodeDragStop(e, node, nodes)
      endDrag()
    },
    [onNodeDragStop, endDrag],
  )

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return
      // The scenario editor has real text fields; leave their own undo alone.
      const el = e.target as HTMLElement | null
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return
      const key = e.key.toLowerCase()
      if (key === 'z' && !e.shiftKey) {
        e.preventDefault()
        undo()
      } else if ((key === 'z' && e.shiftKey) || key === 'y') {
        e.preventDefault()
        redo()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [undo, redo])

  // Invalid wires never snap: React Flow keeps the handle unlit and drops the
  // connection on release, which is the same affordance a self-loop already had.
  const isValidConnection: IsValidConnection = useCallback(
    (conn) => {
      if (conn.source === conn.target) return false
      const source = nodes.find((n) => n.id === conn.source)
      const target = nodes.find((n) => n.id === conn.target)
      if (!source || !target) return false
      return canConnect(serviceIdOfNode(source), serviceIdOfNode(target))
    },
    [nodes],
  )

  // A wire that silently refuses to attach is only half an answer — the player
  // still has to guess why. This says it, and says what to build instead.
  const onConnectEnd: OnConnectEnd = useCallback((_event, state) => {
    if (state.isValid) return
    const { fromNode, toNode } = state
    if (!fromNode || !toNode || fromNode.id === toNode.id) return
    const message = connectionError(serviceIdOfNode(fromNode), serviceIdOfNode(toNode))
    if (message) setRejected({ message, at: Date.now() })
  }, [])

  // Auto-dismiss, keyed on `at` so a second rejection restarts the clock.
  useEffect(() => {
    if (!rejected) return
    const t = setTimeout(() => setRejected(null), 6000)
    return () => clearTimeout(t)
  }, [rejected])

  return (
    <div className="relative h-full flex-1" onDrop={onDrop} onDragOver={(e) => e.preventDefault()}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onConnectEnd={onConnectEnd}
        onNodeDragStart={onNodeDragStart}
        onNodeDragStop={onNodeDragStopCommit}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        isValidConnection={isValidConnection}
        defaultEdgeOptions={{ type: 'traffic' }}
        deleteKeyCode={editing ? ['Backspace', 'Delete'] : []}
        nodesConnectable={editing}
        elementsSelectable
        fitView
        fitViewOptions={{ padding: 0.25, maxZoom: 1 }}
        colorMode="dark"
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} gap={22} size={1.5} color="#1e293b" />
        <Controls position="bottom-left" showInteractive={false}>
          <ControlButton
            onClick={undo}
            disabled={!canUndo}
            title="Undo (⌘Z / Ctrl+Z)"
            aria-label="Undo"
          >
            ↶
          </ControlButton>
          <ControlButton
            onClick={redo}
            disabled={!canRedo}
            title="Redo (⌘⇧Z / Ctrl+Y)"
            aria-label="Redo"
          >
            ↷
          </ControlButton>
          <ControlButton
            onClick={() =>
              void exportCanvasPng(getNodesBounds(nodes), scenarioTitle).then(
                (ok) => ok && useGameStore.getState().unlockAchievement('show-and-tell'),
              )
            }
            title="Download this architecture as a PNG"
            aria-label="Export architecture as PNG"
          >
            📸
          </ControlButton>
        </Controls>
        <MiniMap
          position="bottom-right"
          nodeColor={minimapColor}
          maskColor="rgba(2, 6, 23, 0.75)"
          bgColor="#0f172a"
          pannable
        />
      </ReactFlow>
      <HUD />
      <ResultsModal />
      <MissionBriefing />
      <TutorialCoach />
      <SandboxCoach />
      <SolutionNotes />
      <DecisionModal />
      {/* Same slot as the hint line below: while this is up it IS the hint. */}
      {rejected && !notesOpen && (
        <div
          key={rejected.at}
          role="status"
          className="pointer-events-none absolute bottom-4 left-1/2 z-30 max-w-[92%] -translate-x-1/2 rounded-2xl border border-amber-500/40 bg-amber-950/80 px-5 py-2 text-center text-[12.5px] leading-relaxed text-amber-200 backdrop-blur"
        >
          <span className="mr-1.5">🚫</span>
          {rejected.message}
        </div>
      )}
      {editing && !tutorialActive && !sandboxTourActive && !notesOpen && !rejected && (
        <div className="pointer-events-none absolute bottom-4 left-1/2 z-30 max-w-[92%] -translate-x-1/2 rounded-2xl border border-slate-800 bg-slate-900/80 px-5 py-2 text-center text-[12.5px] leading-relaxed text-slate-400 backdrop-blur">
          Drag services in · drag from a node&apos;s right dot to another&apos;s left dot to connect · select + ⌫ to delete
          {hasVpc ? ' · zonal services live inside an AZ box' : ''}
          {multiRegion ? ' · everything but DNS and the CDN lives inside a Region box' : ''}
        </div>
      )}
    </div>
  )
}

export default function GameScreen() {
  const returnToMenu = useGameStore((s) => s.returnToMenu)
  const soundOn = useGameStore((s) => s.soundOn)
  const toggleSound = useGameStore((s) => s.toggleSound)
  const isSandbox = useGameStore((s) => s.scenarioId === SANDBOX_ID)

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-slate-950 text-slate-100">
      <aside className="flex w-[300px] shrink-0 flex-col gap-4 overflow-y-auto border-r border-slate-800 bg-slate-900/50 p-4">
        <header className="flex items-start justify-between">
          <div>
            <h1 className="bg-gradient-to-r from-cyan-400 to-indigo-400 bg-clip-text text-xl font-black tracking-tight text-transparent">
              SimCloud
            </h1>
            <p className="text-[11px] text-slate-500">Build the architecture. Survive the traffic.</p>
          </div>
          <div className="flex gap-1">
            <button
              onClick={toggleSound}
              title={soundOn ? 'Mute sound effects' : 'Unmute sound effects'}
              aria-label={soundOn ? 'Mute sound' : 'Unmute sound'}
              className="rounded-lg border border-slate-700 px-2 py-1 text-[11px] text-slate-400 transition hover:border-slate-500 hover:text-slate-200"
            >
              {soundOn ? '🔊' : '🔇'}
            </button>
            <button
              onClick={returnToMenu}
              title="Back to the main menu"
              className="rounded-lg border border-slate-700 px-2 py-1 text-[11px] text-slate-400 transition hover:border-slate-500 hover:text-slate-200"
            >
              ⌂
            </button>
          </div>
        </header>
        {isSandbox ? <SandboxPanel /> : <ScenarioPanel />}
        <div className="border-t border-slate-800 pt-3">
          <Palette />
        </div>
        <footer className="mt-auto pt-3 text-[9px] leading-relaxed text-slate-600">
          Costs and capacities are simplified for gameplay — directionally true, not a pricing calculator.
          AWS service icons are the official AWS Architecture Icons. Canvas built with React Flow.
        </footer>
      </aside>
      <ReactFlowProvider>
        <Canvas />
      </ReactFlowProvider>
    </div>
  )
}
