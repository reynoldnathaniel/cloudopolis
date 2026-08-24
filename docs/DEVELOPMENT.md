# Developing Cloudopolis

Everything that matters to someone changing the code, not playing the game.
The [README](../README.md) covers what the game is; this covers how it is built,
tested, and shipped.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Vite dev server on port 5173 |
| `npm run build` | Type-check (`tsc -b`) + production bundle into `dist/` |
| `npm test` | Vitest — engine balance tests (every level's solution pinned to its stars) plus import-validation tests |
| `npm run test:e2e` | Playwright smoke suite against a production build |
| `npm run preview` | Serve the production build locally |
| `node scripts/capture-screens.mjs` | Regenerate the README screenshots against a running preview |

## Loading

The app is split by route. The main menu ships in the initial chunk and paints on its own;
everything behind it loads on demand, and the menu prefetches those chunks on an idle callback
while you are reading it — so by the time you click through, the code is already there and the
Suspense fallback never actually appears.

| Chunk | Size | When it loads |
| --- | --- | --- |
| initial | 449 KB (144 KB gzip) | immediately — React, framer-motion, the store, the engine, the menu |
| `GameScreen` | 249 KB (79 KB gzip) | prefetched on idle — React Flow, the canvas, every overlay |
| `ScenarioSelect` | 6 KB | prefetched on idle |
| `ScenarioEditor` | 15 KB | only if you open the editor |
| `html-to-image` | 13 KB | only when you export a PNG or a share card |

Before the split it was one 731 KB chunk (233 KB gzip) that the main menu had no use for.
`store.ts` deliberately does **not** import React Flow: it is pulled in by the menu, and a static
import would drag a whole graph library into the first chunk to serve three change-reducers that
cannot run before a canvas exists. `GameScreen` hands them over via `provideFlowHelpers()` instead.

---

## Testing

Two layers, deliberately split:

- **`npm test`** — Vitest over the pure engine. Every level's intended solution is pinned to
  its star rating and its exact monthly cost, and every classic wrong design is pinned to the
  failure it's supposed to teach. Every shipped reference answer is replayed through the full
  phase script and must score three stars. Runs in ~150 ms, so it's the fast feedback loop for
  any tuning change in `services.ts`, `scenarios.ts`, or `engine.ts`.
- **`npm run test:e2e`** — Playwright drives a real Chromium through the journeys a player
  actually clicks: menu → tutorial → build a design by dragging edges between node handles →
  run the full ~15 s simulation → three stars → expand the timeline → author a scenario →
  the sandbox's endless run → a Region going dark behind Route 53 → failing a level twice and
  taking the reference answer, and a botnet being scrubbed at the edge. It runs against a
  **production build** on `vite preview`, so it
  tests exactly what deploys. ~3 minutes.

First time only, fetch the browser binary:

```bash
npx playwright install chromium
```

`scripts/deploy.sh` runs both before it uploads anything. To bypass the slow layer in a
pinch: `SKIP_E2E=1 ./scripts/deploy.sh`.

---

## Deploying to S3 + CloudFront

The game is a static SPA, so it deploys as… the Level 1 architecture from the game itself:
a private S3 bucket behind a CloudFront distribution with Origin Access Control.

`scripts/deploy.sh` builds, uploads, and invalidates in one shot:

```bash
./scripts/deploy.sh
```

Point it at your own account by overriding the defaults:

```bash
BUCKET=my-bucket DISTRIBUTION_ID=E123ABC AWS_PROFILE=my-profile ./scripts/deploy.sh
```

It splits the upload deliberately: `/assets/*` is content-hashed by Vite, so it ships with
`max-age=31536000, immutable`, while `index.html` ships `no-cache` — the mutable pointer to
the immutable assets. Then it invalidates `/*`.

The distribution behind it: default root object `index.html`, `403`/`404` custom error
responses rewriting to `/index.html` with a `200` (so client-side routes survive a refresh),
Redirect HTTP to HTTPS, HTTP/2 + HTTP/3, compression on, and the managed **CachingOptimized**
policy. The bucket has all public access blocked; only the distribution can read it, via an
Origin Access Control condition on the bucket policy.

---

## Tech stack

- **Vite 7 + React 19 + TypeScript** (strict)
- **[React Flow](https://reactflow.dev) (`@xyflow/react`)** — the drag-and-drop architecture canvas
- **Zustand** — game state and the run loop
- **Tailwind CSS 4 + Framer Motion** — styling and animation
- **Vitest** — engine balance tests
- Simulation engine: **pure TypeScript, zero dependencies** (`src/game/engine.ts`)

### Project layout

```
src/
  game/
    services.ts     # service catalog: costs, capacities, roles, zonality
    scenarios.ts    # tracks + scenario definitions (pure data)
    engine.ts       # tick-based simulation, scoring, security audit
    engine.test.ts  # balance tests: every intended solution pinned to its stars
    solutions.ts    # the reference 3-star answer for each scenario, as data
    solutions.test.ts # replays every one of them and asserts three stars
    tutorial.ts     # the guided tutorial as data
  components/
    GameScreen.tsx     # the canvas + sidebar, lazy-loaded (React Flow lives here)
    ServiceNode.tsx    # canvas nodes (+ the Users node)
    ZoneNode.tsx       # VPC / AZ container boxes
    TrafficEdge.tsx    # edges with animated traffic dots
    Palette.tsx        # drag/click service palette
    ScenarioPanel.tsx  # objectives-first mission card
    MissionBriefing.tsx# full-screen briefing overlay
    HUD.tsx            # live run stats bar
    ResultsModal.tsx   # stars + pillar scores + Architect's Notes
    MenuScreen.tsx · ScenarioSelect.tsx · TutorialCoach.tsx
  store.ts          # Zustand store, run loop, persistence
  App.tsx
```
### Par cost

Every built-in scenario's reference answer carries a `parCost` — what that design
costs when it runs, including decision surcharges and any per-request bill an attack
ran up. The results screen shows it next to your own bill, and the scenario cards
show your cheapest **three-star** run. Par is pinned by hand and re-derived by
`solutions.test.ts` on every run, so a rebalance that moves a reference design's cost
fails the suite rather than quietly showing players a stale number.

Par is the published answer's cost, not a target tuned to be beatable — on the tight
levels, matching it is the win.


### Which wires you can draw

`src/game/connections.ts` holds a **role-level** compatibility matrix, read straight off
the engine's own target filters. It blocks only edges the engine would silently ignore —
CloudFront → SNS, S3 → anything, a function publishing to a queue. Wires that are *wrong
but instructive* stay drawable, because the engine already punishes them by name and
explains itself afterwards: Users → RDS, a bus wired at a bucket, WAF placed behind the
meter. Refusals appear as a hint that says what to build instead.

Some blocked pairs are real AWS that this game simply doesn't model (DynamoDB Streams,
S3 event notifications, EventBridge → SNS). Their copy says "not simulated here" rather
than claiming the architecture is impossible.

### Extending it

Scenarios and services are **pure data**. To add a level, append to `SCENARIOS` in
`src/game/scenarios.ts`; to add a service, append to `SERVICES` in `src/game/services.ts`
— it inherits its wiring rules from its `role`, so no matrix edit is usually needed.
The engine is deterministic, so after any tuning run `npm test` (~130 ms) rather than
replaying the level by hand.
