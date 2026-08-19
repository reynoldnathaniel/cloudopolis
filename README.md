# SimCloud ☁️

**An interactive browser game for learning AWS architecture.**

Drag AWS services onto a canvas, wire them together, then hit **Simulate** — animated traffic
flows through your design, a spike tries to knock it over, an Availability Zone dies, a security
probe scans your edge — and you're scored on Well-Architected-style pillars.

It's a design tool with consequences: build it wrong and you *watch* it fall over.

**▶ Play it: <https://d7i4bs34j2edg.cloudfront.net>**

```
Users ──▶ CloudFront ──▶ S3          ★★★  $15/mo
Users ──▶ S3                         ★☆☆  saturated at 2,000 rps + public bucket flagged
```

---

## Quick start

```bash
npm install
npm run dev
```

Open <http://localhost:5173>.

Other scripts:

| Command | What it does |
| --- | --- |
| `npm run dev` | Vite dev server on port 5173 |
| `npm run build` | Type-check (`tsc -b`) + production bundle into `dist/` |
| `npm test` | Vitest — 36 balance tests that pin every level's solution to its star rating |
| `npm run preview` | Serve the production build locally |

---

## How to play

1. **Pick a scenario** from the mission-select screen. A briefing opens the first time you enter
   one: the story, the traffic profile, the budget, and the explicit win conditions.
2. **Drag (or click) services** from the palette onto the canvas.
3. **Connect them** — drag from a node's right dot to another node's left dot. Traffic always
   starts at the **Users** node.
4. **Press ▶ Simulate.** Watch the baseline phase, then the spike, then whatever chaos the
   scenario has in store. Green dots are served requests; red means something is saturated.
5. **Earn three stars**: serve the baseline (≥98%), survive every event (≥95%), stay under budget —
   plus Blueprint and Security pillars where the scenario calls for them.

New here? The main menu has an **11-step guided tutorial** that walks you through Level 1 —
build it, fail the spike, get flagged by the security probe, fix both with a CDN, three stars.

---

## What's in it

### 4 tracks, 8 scenarios

Tracks are independent **categories**, not a difficulty ladder — pick whichever architecture
style you want to learn.

| Track | Scenarios | The lesson |
| --- | --- | --- |
| ☁️ **Foundations** | Launch Day · PhotoShare · The Migration · FlashSale · IPO Day | CDN caching, load balancing, managed data stores, Multi-AZ redundancy, auto scaling |
| 🤖 **GenAI** | Prompt Rush | Bedrock's throughput quota and token costs — beaten by a semantic cache in front of the model |
| 📨 **Event-Driven** | Order Storm | A 12,000 rps burst a synchronous design *must* drop; API GW → SNS → SQS → Lambda buffers it and loses nothing |
| 🌊 **Streaming** | Click Stream | Kinesis as the cheap durable ingest edge vs API Gateway's per-request bill, with Lambda consumers scoring on SageMaker |

### Simulation mechanics

- **Tick-based flow model** — traffic is routed through the graph every tick, with per-node
  capacity, overflow, and drop accounting.
- **Health-aware routing** — load balancers, compute, and caches route around dead nodes.
  The **Users** node does not: DNS is dumb, which is exactly why you need a load balancer.
- **AZ outage** — mid-run an entire Availability Zone dies. Everything zonal inside it goes with
  it. Real redundancy means one of everything zonal in *each* zone.
- **Security probe** — attackers scan for resources wired straight to Users. Public S3 buckets,
  exposed databases and caches, and naked compute all fail the Security pillar. Only CloudFront,
  ALB, and API Gateway belong on the internet edge.
- **EC2 Auto Scaling groups** — an elastic 2–10 instance fleet that scales with observed load,
  *with realistic boot lag*, so sharp spikes hurt before capacity catches up.
- **Async pipelines** — SQS/Kinesis nodes hold a live backlog that drains at consumer capacity;
  SNS fans out a copy per subscriber. Async scenarios are scored on **Delivery / Durability /
  Drain** instead of instant service.
- **VPC and Availability Zone containers** — React Flow subflows with drag re-parenting.

### Quality of life

- Progress persistence in `localStorage` — best stars per scenario, tutorial completion, and the
  canvas itself, so **Continue** survives a reload.
- Official **AWS Architecture Icons** in nodes and palette.
- Architect's Notes after every run: targeted diagnosis of what broke and why.

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
    tutorial.ts     # the guided tutorial as data
  components/
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

### Extending it

Scenarios and services are **pure data**. To add a level, append to `SCENARIOS` in
`src/game/scenarios.ts`; to add a service, append to `SERVICES` in `src/game/services.ts`.
The engine is deterministic, so after any tuning run `npm test` (~130 ms) rather than
replaying the level by hand.

---

## Roadmap

- Custom scenario editor — define traffic/budget/constraints in-app for workshops
- Sandbox mode (no budget, traffic sliders) — a whiteboard that runs
- Post-run timeline chart: served %, cost, and backlog over the run
- A retrieve-then-generate chain mechanic, unlocking a RAG scenario for the GenAI track
- Containers track (ECS/Fargate) as a third compute model
- Multi-region DR finale · WAF + DDoS event · EventBridge · Firehose → S3
- Export architecture as PNG · Korean localization · sound effects

---

## License

[MIT](LICENSE) © 2026 Reynold Nathaniel

## Notes

Costs and capacities are **simplified for gameplay** — directionally true, not a pricing
calculator. Don't size a real workload with this.

AWS service icons are the official AWS Architecture Icons, used under the
[AWS Architecture Icons terms](https://aws.amazon.com/architecture/icons/). AWS and the AWS
service names are trademarks of Amazon.com, Inc. or its affiliates. This project is not
affiliated with or endorsed by AWS.
