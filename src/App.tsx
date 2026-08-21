// Route-level code splitting.
//
// The menu is what everyone sees first, so it ships in the initial chunk and
// paints immediately. Everything behind it loads on demand — and the game
// screen is the one that matters, because React Flow, the node components and
// every AWS icon ride along with it and together they were most of a 731 KB
// bundle that the main menu had no use for.
//
// The menu then prefetches those chunks while the player is reading it, so the
// split costs nothing in practice: by the time anyone clicks through, the code
// is already in memory and Suspense never even shows its fallback.

import { lazy, Suspense, useEffect } from 'react'
import { useGameStore } from './store'
import { MenuScreen } from './components/MenuScreen'

const GameScreen = () => import('./components/GameScreen')
const ScenarioSelect = () => import('./components/ScenarioSelect')
const ScenarioEditor = () => import('./components/ScenarioEditor')

const LazyGameScreen = lazy(GameScreen)
const LazyScenarioSelect = lazy(() =>
  ScenarioSelect().then((m) => ({ default: m.ScenarioSelect })),
)
const LazyScenarioEditor = lazy(() =>
  ScenarioEditor().then((m) => ({ default: m.ScenarioEditor })),
)

/**
 * Deliberately just the page background. These chunks are served from the same
 * origin and are usually already prefetched, so anything more elaborate would
 * be a spinner that flashes for one frame and reads as jank.
 */
const Loading = () => <div className="h-screen w-screen bg-slate-950" />

export default function App() {
  const screen = useGameStore((s) => s.screen)

  // Warm the next screens while the player is still on the menu. Failures are
  // ignored on purpose: this is an optimisation, and if a prefetch cannot
  // complete then the real navigation will simply load it again.
  useEffect(() => {
    if (screen !== 'menu') return
    const warm = () => {
      void GameScreen().catch(() => {})
      void ScenarioSelect().catch(() => {})
    }
    // Safari only shipped requestIdleCallback recently; a short timer is a fine
    // stand-in for "once the menu has settled".
    const idle = window.requestIdleCallback
    if (typeof idle === 'function') {
      const id = idle(warm)
      return () => window.cancelIdleCallback(id)
    }
    const id = window.setTimeout(warm, 200)
    return () => window.clearTimeout(id)
  }, [screen])

  if (screen === 'menu') return <MenuScreen />

  return (
    <Suspense fallback={<Loading />}>
      {screen === 'select' ? (
        <LazyScenarioSelect />
      ) : screen === 'editor' ? (
        <LazyScenarioEditor />
      ) : (
        <LazyGameScreen />
      )}
    </Suspense>
  )
}
