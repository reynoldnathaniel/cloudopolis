export type TrackId = 'foundations' | 'genai' | 'event-driven' | 'streaming' | 'custom'

export interface Track {
  id: TrackId
  name: string
  emoji: string
  description: string
}

export const TRACKS: Track[] = [
  {
    id: 'foundations',
    name: 'Foundations',
    emoji: '☁️',
    description: 'The core loop: traffic, budgets, spikes, and zone failures. Start here.',
  },
  {
    id: 'genai',
    name: 'GenAI',
    emoji: '🤖',
    description: 'LLM apps on Bedrock: quotas, token costs, and semantic caching.',
  },
  {
    id: 'event-driven',
    name: 'Event-Driven',
    emoji: '📨',
    description: 'Queues and pub/sub: lose no event, even when bursts dwarf your compute.',
  },
  {
    id: 'streaming',
    name: 'Streaming',
    emoji: '🌊',
    description: 'High-volume ingest and real-time AI scoring on the stream.',
  },
  {
    id: 'custom',
    name: 'My Scenarios',
    emoji: '🛠️',
    description: 'Author your own missions — for workshops, your team, or torture tests.',
  },
]

export interface Scenario {
  id: string
  track: TrackId
  /** Position within its track (1-based) */
  order: number
  /** 1–3 difficulty dots shown on the scenario card */
  difficulty: 1 | 2 | 3
  title: string
  emoji: string
  /** One-line card hook */
  hook: string
  brief: string
  /** 'static': S3/CDN can serve everything. 'app': requests need compute + a database/model. */
  need: 'static' | 'app'
  /** Async pipeline: scored on eventual delivery + durability + drain instead of instant service. */
  async?: boolean
  baselineRps: number
  spikeRps: number
  spikeLabel: string
  budget: number
  /** Show the VPC + Availability Zone boxes; zonal services must be placed in an AZ. */
  hasVpc?: boolean
  /** After the spike, one Availability Zone fails. */
  hasOutage?: boolean
  /** Attackers scan the design for internet-exposed resources mid-run. */
  hasProbe?: boolean
  outageLabel?: string
  /** Service ids not allowed in this scenario (greyed out in the palette). */
  banned?: string[]
  bannedReason?: string
  /** Service ids the design must include and route traffic through (Blueprint pillar). */
  requiredServices?: string[]
  goalHints: string[]
}

export const SCENARIOS: Scenario[] = [
  // ---------------------------------------------------------- Foundations
  {
    id: 'static-site',
    track: 'foundations',
    order: 1,
    difficulty: 1,
    title: 'Launch Day',
    emoji: '🚀',
    hook: 'Ship a static site that survives launch night.',
    brief:
      'Your indie game studio ships its marketing site tonight. It is a static site — HTML, images, a trailer. Serve it cheaply, and survive the launch-night rush.',
    need: 'static',
    baselineRps: 100,
    spikeRps: 2000,
    spikeLabel: '🔥 Front page of Reddit!',
    budget: 30,
    hasProbe: true,
    goalHints: [
      'Static content needs storage, not servers.',
      'A CDN absorbs most of a traffic spike before it reaches your origin.',
    ],
  },
  {
    id: 'photo-app',
    track: 'foundations',
    order: 2,
    difficulty: 1,
    title: 'PhotoShare',
    emoji: '📸',
    hook: 'Your first real app: compute, a database, and a hard budget.',
    brief:
      'Your photo-sharing app has real users now. Every request runs application logic and reads or writes the database. Traffic is spiky in the evenings — and the CFO gave you a hard budget.',
    need: 'app',
    baselineRps: 200,
    spikeRps: 1200,
    spikeLabel: '⚡ Evening rush hour!',
    budget: 120,
    hasProbe: true,
    goalHints: [
      'Dynamic requests need a compute tier connected to a database.',
      'Fixed-size instances die in spikes. Auto Scaling groups and serverless services do not.',
      'Watch the database — it is usually the first thing to saturate.',
    ],
  },
  {
    id: 'migration',
    track: 'foundations',
    order: 3,
    difficulty: 2,
    title: 'The Migration',
    emoji: '🏗️',
    hook: 'VMs only. Size the fleet exactly right.',
    brief:
      "Your company acquired a startup running a creaky VM-based app. Ops hasn't approved auto scaling, and the code can't be rewritten as functions. Migrate it as-is — and size the fleet right.",
    need: 'app',
    baselineRps: 200,
    spikeRps: 550,
    spikeLabel: '📦 Cutover day — all traffic shifts over!',
    budget: 195,
    hasProbe: true,
    banned: ['lambda', 'asg'],
    bannedReason: "Ops hasn't approved auto scaling, and the legacy code can't run as functions — VMs only.",
    goalHints: [
      'One EC2 instance handles 150 RPS. Do the math for the spike.',
      'An ALB spreads traffic evenly across every instance behind it.',
      'With fixed capacity you pay for peak even when traffic is quiet. Feel that pain — it is why auto scaling exists.',
    ],
  },
  {
    id: 'flash-sale',
    track: 'foundations',
    order: 4,
    difficulty: 2,
    title: 'FlashSale',
    emoji: '🛒',
    hook: 'Multi-AZ or bust: an Availability Zone will fail mid-sale.',
    brief:
      'Your e-commerce startup runs its first nationwide flash sale. The catalog must stay in a relational database (compliance). And mid-sale, an entire Availability Zone will go dark. Design for failure — everything zonal dies with its AZ.',
    need: 'app',
    baselineRps: 300,
    spikeRps: 1500,
    spikeLabel: '🛒 The sale is live!',
    budget: 260,
    hasProbe: true,
    hasVpc: true,
    hasOutage: true,
    outageLabel: '💥 Availability Zone failure!',
    banned: ['dynamodb'],
    bannedReason: 'Compliance: this catalog must stay relational — use RDS.',
    goalHints: [
      'Zonal services (EC2, RDS, ElastiCache) must sit inside an Availability Zone — and one AZ will fail.',
      'RDS caps at 250 RPS. A cache in front absorbs ~70% of reads.',
      'Real redundancy means one of everything zonal in EACH zone.',
    ],
  },
  {
    id: 'ipo-day',
    track: 'foundations',
    order: 5,
    difficulty: 3,
    title: 'IPO Day',
    emoji: '📈',
    hook: 'The capstone: everything you know, under one brutal day.',
    brief:
      "Tomorrow the company goes public. Brutal traffic, auditors watching — and mid-day, an Availability Zone will fail. After last month's bill shock, the CFO has banned every pay-per-request service. Ship something Well-Architected.",
    need: 'app',
    baselineRps: 500,
    spikeRps: 2000,
    spikeLabel: '📈 Markets open — traffic explodes!',
    budget: 340,
    hasProbe: true,
    hasVpc: true,
    hasOutage: true,
    outageLabel: '💥 AZ failure — mid-trading!',
    banned: ['lambda', 'dynamodb'],
    bannedReason: 'CFO decree: no pay-per-request pricing after last month’s bill shock.',
    goalHints: [
      'A CDN caches ~30% of even dynamic traffic. Sometimes that is the whole difference.',
      'A maxed-out Auto Scaling group serves 1,500 RPS. Do the spike math with and without a CDN.',
      'One of everything zonal in each AZ — or the outage ends your IPO.',
    ],
  },
  // ---------------------------------------------------------- GenAI
  {
    id: 'prompt-rush',
    track: 'genai',
    order: 1,
    difficulty: 2,
    title: 'Prompt Rush',
    emoji: '🤖',
    hook: 'Your chatbot went viral. Bedrock’s quota did not.',
    brief:
      'Your AI support chatbot just went viral. Every request calls an LLM on Amazon Bedrock — which throttles at its 150 RPS on-demand quota and bills for every token. Survive the rush without melting the model or the budget.',
    need: 'app',
    baselineRps: 100,
    spikeRps: 400,
    spikeLabel: '🤖 Your bot is all over social media!',
    budget: 150,
    hasProbe: true,
    requiredServices: ['bedrock'],
    goalHints: [
      'Bedrock throttles at 150 RPS on-demand — the spike is far bigger than that.',
      'Users ask the same questions over and over. A cache in front of the model serves ~70% of prompts without an LLM call.',
      'Cached answers also cost zero tokens. One cache fixes the quota AND the bill.',
    ],
  },
  // ---------------------------------------------------------- Event-Driven
  {
    id: 'order-storm',
    track: 'event-driven',
    order: 1,
    difficulty: 2,
    title: 'Order Storm',
    emoji: '🎫',
    hook: 'Losing an order is unforgivable. Processing it late is fine.',
    brief:
      'Concert tickets go on sale at noon: a 12,000 RPS burst that dwarfs your compute. Here is the twist — orders may take a minute to process, but losing even one is unforgivable. Stop thinking in requests. Start thinking in events.',
    need: 'app',
    async: true,
    baselineRps: 200,
    spikeRps: 12000,
    spikeLabel: '🎫 Tickets on sale NOW!',
    budget: 130,
    hasProbe: true,
    requiredServices: ['sns', 'sqs'],
    goalHints: [
      'Lambda tops out at 10,000 RPS. The burst is 12,000. A synchronous design MUST drop orders.',
      'A queue turns a burst into a backlog. Backlogs drain; dropped requests are gone forever.',
      'The pattern: API Gateway → SNS → SQS → Lambda → database. Publish, buffer, then process at your own pace.',
    ],
  },
  // ---------------------------------------------------------- Streaming
  {
    id: 'click-stream',
    track: 'streaming',
    order: 1,
    difficulty: 2,
    title: 'Click Stream',
    emoji: '🌊',
    hook: 'Half a million clicks an hour, scored by AI in real time.',
    brief:
      'Your retail site wants real-time fraud scoring on every click — 500 events per second, four times that in prime time, each one scored by a SageMaker model. Careful with the front door: at this volume, per-request pricing will eat you alive.',
    need: 'app',
    async: true,
    baselineRps: 500,
    spikeRps: 2000,
    spikeLabel: '🌊 Prime-time click flood!',
    budget: 200,
    hasProbe: true,
    requiredServices: ['kinesis', 'sagemaker'],
    goalHints: [
      'API Gateway charges per request. At 500 RPS sustained, that alone is $50/mo — do the math against your budget.',
      'Kinesis is a durable, IAM-authenticated front door built exactly for this: high-volume ingest at a flat price.',
      'The pipeline: Kinesis → Lambda consumers → SageMaker endpoint for scoring.',
    ],
  },
]

/**
 * Sandbox: not a mission and never listed in a track. It borrows the Scenario
 * shape so the canvas, palette, engine, and HUD all work unchanged — but the
 * run loop treats it specially (endless run, live traffic slider, chaos on
 * demand) and nothing here is ever scored.
 */
export const SANDBOX_ID = 'sandbox'

export const SANDBOX: Scenario = {
  id: SANDBOX_ID,
  track: 'foundations',
  order: 0,
  difficulty: 1,
  title: 'Sandbox',
  emoji: '🧪',
  hook: 'No budget, no stars — just you, the canvas, and a traffic dial.',
  brief:
    'A blank region. Every service unlocked, no budget, no scoring. Drive the traffic yourself, kill an Availability Zone whenever you like, and run the security probe on demand. Build whatever you want and watch it behave.',
  need: 'app',
  baselineRps: 200,
  spikeRps: 200,
  spikeLabel: '',
  // Cost is displayed but never scored; this ceiling just keeps the chart's
  // budget reference line off the plot.
  budget: Number.MAX_SAFE_INTEGER,
  hasVpc: true,
  goalHints: [],
}

// ---- custom scenarios (player-authored, registered at startup and on save) ----
// The registry keeps this module pure data: customScenarios.ts owns persistence
// and validation, and pushes the current list in here so every lookup below —
// and therefore every component and the engine — sees custom scenarios as
// ordinary rows.

let CUSTOM: Scenario[] = []

export const registerCustomScenarios = (list: Scenario[]): void => {
  CUSTOM = list
}

const allScenarios = (): Scenario[] => (CUSTOM.length ? [...SCENARIOS, ...CUSTOM] : SCENARIOS)

export const getScenario = (id: string): Scenario =>
  id === SANDBOX_ID ? SANDBOX : (allScenarios().find((s) => s.id === id) ?? SCENARIOS[0])

export const scenariosInTrack = (track: TrackId): Scenario[] =>
  allScenarios()
    .filter((s) => s.track === track)
    .sort((a, b) => a.order - b.order)

/** The next scenario within the same track, or null if this one is the last. */
export const nextScenario = (id: string): Scenario | null => {
  const current = getScenario(id)
  return (
    allScenarios().find((s) => s.track === current.track && s.order === current.order + 1) ?? null
  )
}
