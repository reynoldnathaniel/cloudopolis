import { useCallback } from 'react'
import {
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
  type OnNodeDrag,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { useGameStore, AZ_RECTS, type AzId } from './store'
import { ServiceNode, UsersNode } from './components/ServiceNode'
import { VpcNode, AzNode } from './components/ZoneNode'
import { TrafficEdge } from './components/TrafficEdge'
import { Palette } from './components/Palette'
import { ScenarioPanel } from './components/ScenarioPanel'
import { SandboxPanel } from './components/SandboxPanel'
import { HUD } from './components/HUD'
import { ResultsModal } from './components/ResultsModal'
import { MenuScreen } from './components/MenuScreen'
import { MissionBriefing } from './components/MissionBriefing'
import { ScenarioSelect } from './components/ScenarioSelect'
import { ScenarioEditor } from './components/ScenarioEditor'
import { TutorialCoach, SandboxCoach } from './components/TutorialCoach'
import { CATEGORY_COLORS, SERVICES } from './game/services'
import { exportCanvasPng } from './game/exportImage'
import { SANDBOX_ID } from './game/scenarios'

const nodeTypes = { service: ServiceNode, users: UsersNode, vpc: VpcNode, az: AzNode }
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
  const editing = useGameStore((s) => s.phase === 'edit')
  const hasVpc = useGameStore((s) => s.scenario().hasVpc === true)
  const scenarioTitle = useGameStore((s) => s.scenario().title)
  const tutorialActive = useGameStore((s) => s.tutorialStep !== null)
  const sandboxTourActive = useGameStore((s) => s.sandboxTutorialStep !== null)
  const { screenToFlowPosition, getInternalNode, getNodesBounds } = useReactFlow()

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      const serviceId = e.dataTransfer.getData('application/simcloud')
      if (!serviceId) return
      const pos = screenToFlowPosition({ x: e.clientX, y: e.clientY })
      addServiceNode(serviceId, { x: pos.x - NODE_W / 2, y: pos.y - NODE_H / 2 }, true)
      // addServiceNode auto-places zonal services into an AZ in VPC levels; if the
      // user dropped one at a specific point, honor that point when it lands in a box.
      if (hasVpc && SERVICES[serviceId]?.zonal) {
        const az = azAtPoint(pos.x, pos.y)
        const latest = useGameStore.getState().nodes
        const added = latest[latest.length - 1]
        if (added && az) {
          assignZone(added.id, az, {
            x: pos.x - AZ_RECTS[az].x - NODE_W / 2,
            y: pos.y - AZ_RECTS[az].y - NODE_H / 2,
          })
        }
      }
    },
    [screenToFlowPosition, addServiceNode, assignZone, hasVpc],
  )

  // Re-parent zonal services into/out of AZ boxes when dragging ends.
  const onNodeDragStop: OnNodeDrag = useCallback(
    (_e, node) => {
      if (!hasVpc || node.type !== 'service') return
      const def = SERVICES[(node.data as { serviceId?: string }).serviceId ?? '']
      if (!def?.zonal) return
      const internal = getInternalNode(node.id)
      const abs = internal?.internals.positionAbsolute ?? node.position
      const cx = abs.x + NODE_W / 2
      const cy = abs.y + NODE_H / 2
      const az = azAtPoint(cx, cy)
      const currentAz = ((node.data as { az?: AzId }).az ?? null) as AzId | null
      if (az === currentAz) return
      const position = az
        ? { x: abs.x - AZ_RECTS[az].x, y: abs.y - AZ_RECTS[az].y }
        : { x: abs.x, y: abs.y }
      assignZone(node.id, az, position)
    },
    [hasVpc, getInternalNode, assignZone],
  )

  const isValidConnection: IsValidConnection = useCallback(
    (conn) => conn.source !== conn.target,
    [],
  )

  return (
    <div className="relative h-full flex-1" onDrop={onDrop} onDragOver={(e) => e.preventDefault()}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onNodeDragStop={onNodeDragStop}
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
        proOptions={{ hideAttribution: false }}
      >
        <Background variant={BackgroundVariant.Dots} gap={22} size={1.5} color="#1e293b" />
        <Controls position="bottom-left" showInteractive={false}>
          <ControlButton
            onClick={() => void exportCanvasPng(getNodesBounds(nodes), scenarioTitle)}
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
      {editing && !tutorialActive && !sandboxTourActive && (
        <div className="pointer-events-none absolute bottom-4 left-1/2 z-30 -translate-x-1/2 rounded-full border border-slate-800 bg-slate-900/80 px-4 py-1.5 text-[10px] text-slate-500 backdrop-blur">
          Drag services in · drag from a node&apos;s right dot to another&apos;s left dot to connect · select + ⌫ to delete
          {hasVpc ? ' · zonal services live inside an AZ box' : ''}
        </div>
      )}
    </div>
  )
}

export default function App() {
  const screen = useGameStore((s) => s.screen)
  const returnToMenu = useGameStore((s) => s.returnToMenu)
  const isSandbox = useGameStore((s) => s.scenarioId === SANDBOX_ID)

  if (screen === 'menu') return <MenuScreen />
  if (screen === 'select') return <ScenarioSelect />
  if (screen === 'editor') return <ScenarioEditor />

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
          <button
            onClick={returnToMenu}
            title="Back to the main menu"
            className="rounded-lg border border-slate-700 px-2 py-1 text-[11px] text-slate-400 transition hover:border-slate-500 hover:text-slate-200"
          >
            ⌂
          </button>
        </header>
        {isSandbox ? <SandboxPanel /> : <ScenarioPanel />}
        <div className="border-t border-slate-800 pt-3">
          <Palette />
        </div>
        <footer className="mt-auto pt-3 text-[9px] leading-relaxed text-slate-600">
          Costs and capacities are simplified for gameplay — directionally true, not a pricing calculator.
          AWS service icons are the official AWS Architecture Icons.
        </footer>
      </aside>
      <ReactFlowProvider>
        <Canvas />
      </ReactFlowProvider>
    </div>
  )
}
