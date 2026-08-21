// Undo/redo, against the real store.
//
// The interesting assertions are about what does NOT become a history entry.
// React Flow reports a drag as a stream of per-frame position changes, so the
// naive implementation gives you an undo stack that walks a node back across
// the canvas one press at a time — which is worse than having no undo at all.

import { describe, it, expect, beforeEach } from 'vitest'
import { useGameStore, HISTORY_LIMIT } from './store'

const store = () => useGameStore.getState()

/** Node ids currently on the canvas, services only. */
const services = () =>
  store()
    .nodes.filter((n) => n.type === 'service')
    .map((n) => n.id)

const moveFirstService = (dx: number) => {
  useGameStore.setState({
    nodes: store().nodes.map((n) =>
      n.type === 'service' ? { ...n, position: { x: n.position.x + dx, y: n.position.y } } : n,
    ),
  })
}

beforeEach(() => {
  // A scenario switch is the documented way to get a clean canvas and an empty
  // history, so the reset is itself exercising one of the rules.
  store().selectScenario('photo-app')
  store().selectScenario('static-site')
})

describe('history basics', () => {
  it('starts empty and refuses to undo nothing', () => {
    expect(store().past).toHaveLength(0)
    expect(store().future).toHaveLength(0)
    store().undo()
    expect(services()).toHaveLength(0)
  })

  it('undoes and redoes an added service', () => {
    store().addServiceNode('cloudfront', { x: 0, y: 0 })
    expect(services()).toHaveLength(1)

    store().undo()
    expect(services()).toHaveLength(0)

    store().redo()
    expect(services()).toHaveLength(1)
  })

  it('walks back through several edits in order', () => {
    store().addServiceNode('cloudfront', { x: 0, y: 0 })
    store().addServiceNode('s3', { x: 0, y: 0 })
    store().addServiceNode('alb', { x: 0, y: 0 })
    expect(services()).toHaveLength(3)

    store().undo()
    store().undo()
    expect(services()).toHaveLength(1)
    expect(services()[0]).toContain('cloudfront')

    store().redo()
    expect(services()).toHaveLength(2)
  })

  it('drops the redo branch as soon as you edit again', () => {
    store().addServiceNode('cloudfront', { x: 0, y: 0 })
    store().addServiceNode('s3', { x: 0, y: 0 })
    store().undo()
    expect(store().future).toHaveLength(1)

    store().addServiceNode('alb', { x: 0, y: 0 })
    expect(store().future).toHaveLength(0)
    // ...and redo cannot resurrect the abandoned branch.
    store().redo()
    expect(services().some((id) => id.includes('s3'))).toBe(false)
  })

  it('caps the stack instead of growing without bound', () => {
    for (let i = 0; i < HISTORY_LIMIT + 15; i++) {
      store().addServiceNode('cloudfront', { x: 0, y: 0 })
    }
    expect(store().past).toHaveLength(HISTORY_LIMIT)
  })
})

describe('what counts as one step', () => {
  it('records a drag once, however many frames it took', () => {
    store().addServiceNode('cloudfront', { x: 0, y: 0 })
    const depth = store().past.length

    store().beginDrag()
    // Every frame React Flow would have reported on the way across the canvas.
    for (let i = 0; i < 40; i++) moveFirstService(5)
    store().endDrag()

    expect(store().past).toHaveLength(depth + 1)
    // And one undo puts it all the way back, not one frame back.
    const moved = store().nodes.find((n) => n.type === 'service')!.position.x
    store().undo()
    expect(store().nodes.find((n) => n.type === 'service')!.position.x).toBe(moved - 200)
  })

  it('spends no history on a drag that did not move anything', () => {
    store().addServiceNode('cloudfront', { x: 0, y: 0 })
    const depth = store().past.length

    // A plain click is a zero-distance drag. Undo after one should not sit
    // there doing nothing.
    store().beginDrag()
    store().endDrag()

    expect(store().past).toHaveLength(depth)
    expect(store().dragSnapshot).toBeNull()
  })

  it('clears the drag snapshot even when the drag is discarded', () => {
    store().beginDrag()
    expect(store().dragSnapshot).not.toBeNull()
    store().endDrag()
    expect(store().dragSnapshot).toBeNull()
  })
})

describe('guards', () => {
  it('leaves the canvas alone while a simulation is running', () => {
    store().addServiceNode('cloudfront', { x: 0, y: 0 })
    useGameStore.setState({ phase: 'run' })

    store().undo()
    expect(services()).toHaveLength(1)

    useGameStore.setState({ phase: 'edit' })
    store().undo()
    expect(services()).toHaveLength(0)
  })

  it('will not redo into a canvas mid-run either', () => {
    store().addServiceNode('cloudfront', { x: 0, y: 0 })
    store().undo()
    useGameStore.setState({ phase: 'run' })
    store().redo()
    expect(services()).toHaveLength(0)
    useGameStore.setState({ phase: 'edit' })
  })

  it('throws the history away when you switch scenarios', () => {
    store().addServiceNode('cloudfront', { x: 0, y: 0 })
    store().addServiceNode('s3', { x: 0, y: 0 })
    expect(store().past.length).toBeGreaterThan(0)

    store().selectScenario('flash-sale')
    expect(store().past).toHaveLength(0)
    expect(store().future).toHaveLength(0)

    // Undo must not be able to paste one level's design onto another.
    store().undo()
    expect(services()).toHaveLength(0)
  })
})

describe('destructive actions are undoable', () => {
  it('puts back a canvas that was cleared', () => {
    store().addServiceNode('cloudfront', { x: 0, y: 0 })
    store().addServiceNode('s3', { x: 0, y: 0 })
    store().clearCanvas()
    expect(services()).toHaveLength(0)

    store().undo()
    expect(services()).toHaveLength(2)
  })

  it('puts back a canvas that a revealed answer overwrote', () => {
    store().addServiceNode('alb', { x: 0, y: 0 })
    const mine = services()

    store().revealSolution()
    expect(services().every((id) => id.startsWith('sol-'))).toBe(true)

    store().undo()
    expect(services()).toEqual(mine)
  })
})
