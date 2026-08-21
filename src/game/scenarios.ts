export type TrackId =
  | 'foundations'
  | 'containers'
  | 'genai'
  | 'data'
  | 'event-driven'
  | 'streaming'
  | 'global'
  | 'day2'
  | 'custom'

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
    id: 'containers',
    name: 'Containers',
    emoji: '🐳',
    description: 'The middle path: fleets that scale in seconds and bill by the task.',
  },
  {
    id: 'genai',
    name: 'GenAI',
    emoji: '🤖',
    description: 'LLM apps on Bedrock: quotas, token costs, and semantic caching.',
  },
  {
    id: 'data',
    name: 'Data',
    emoji: '🗄️',
    description: 'Relational data at scale: read/write splits, replicas, and the one primary every write must reach.',
  },
  {
    id: 'event-driven',
    name: 'Event-Driven',
    emoji: '📨',
    description:
      'Queues and pub/sub: lose no event when bursts dwarf your compute — and what to do when you are not allowed to buffer at all.',
  },
  {
    id: 'streaming',
    name: 'Streaming',
    emoji: '🌊',
    description: 'High-volume ingest and real-time AI scoring on the stream.',
  },
  {
    id: 'global',
    name: 'Going Global',
    emoji: '🌍',
    description: 'The last exam: an entire Region goes dark and the app stays up.',
  },
  {
    id: 'day2',
    name: 'Day 2',
    emoji: '🚨',
    description: 'You are on call. The design is already shipped — now something is happening to it.',
  },
  {
    id: 'custom',
    name: 'My Scenarios',
    emoji: '🛠️',
    description: 'Author your own missions — for workshops, your team, or torture tests.',
  },
]

/** Phases a decision can be scheduled in. Mirrors the store's RunPhaseName —
 *  declared here so this module stays free of store imports. */
export type DecisionPhase = 'baseline' | 'spike' | 'recovery' | 'outage' | 'probe'

export interface DecisionOption {
  label: string
  /** One line, shown in the results breakdown once the run is over */
  outcome: string
  /** Flat dollars added to the scored monthly bill — emergency capacity is not free */
  surcharge?: number
  /** Multiply every compute tier's capacity for a while */
  computeFactor?: { factor: number; ticks: number }
  /** Multiply incoming traffic for a while */
  rpsFactor?: { factor: number; ticks: number }
  /** Multiply the attack for a while — 0 stops it dead, until it comes back */
  attackFactor?: { factor: number; ticks: number }
}

/**
 * An incident raised mid-run. The simulation freezes, the player picks, and the
 * run carries on changed. Options are written so the tempting one costs money
 * and the free one only works if the design was already right — a decision
 * should punish the architecture that needed it, not hand out a power-up.
 */
export interface Decision {
  id: string
  phase: DecisionPhase
  /** Tick within that phase */
  tick: number
  emoji: string
  title: string
  prompt: string
  options: [DecisionOption, DecisionOption]
  /** Applied automatically when the timer runs out — always the benign one, so
   *  an unattended run still reflects the design rather than the inattention. */
  defaultIndex: 0 | 1
  seconds: number
}

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
  /**
   * Fraction of app-tier traffic that is writes (0.1 = 10%). Setting this turns
   * on the read/write split: writes only reach services that accept them, reads
   * fan out over read replicas when any are wired.
   */
  writeFraction?: number
  /**
   * Serverless functions pay a cold-start penalty for traffic above what they
   * have warm. Off by default so the levels built before this mechanic keep
   * behaving exactly as they did.
   */
  coldStarts?: boolean
  /**
   * Replaces the ramped spike with a square wave: `onTicks` at spikeRps, then
   * `offTicks` back at baseline, repeating. No ramp — the instantaneous jump is
   * the entire point, since it is what catches a function cold.
   */
  bursts?: { onTicks: number; offTicks: number }
  /** Incidents that interrupt the run and ask the player to decide, live. */
  decisions?: Decision[]
  /**
   * A flood of malicious requests arrives during the spike phase, on top of the
   * real traffic and indistinguishable from it. Flat, not ramped — botnets do
   * not ease into it. Off everywhere else, so no existing level changes.
   */
  attack?: {
    /** Junk requests per second */
    rps: number
    /** Shown on the HUD while it is happening */
    label: string
  }
  baselineRps: number
  spikeRps: number
  spikeLabel: string
  budget: number
  /** Show the VPC + Availability Zone boxes; zonal services must be placed in an AZ. */
  hasVpc?: boolean
  /**
   * Zoom out one level: the canvas shows two Region boxes instead of AZs, every
   * service except DNS and the CDN must be placed inside one, and the outage
   * takes a whole Region — zonal or not. Mutually exclusive with hasVpc.
   */
  multiRegion?: boolean
  /** After the spike, one Availability Zone (or, with multiRegion, one Region) fails. */
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
  // ---------------------------------------------------------- Containers
  {
    id: 'replatform',
    track: 'containers',
    order: 1,
    difficulty: 2,
    title: 'The Replatform',
    emoji: '🐳',
    hook: 'Sustained load all evening. Pay-per-request will eat you alive.',
    brief:
      'Your food-delivery client runs a dinner rush that never really stops: 800 requests a second every evening, half again as much at peak. Their VM bill is eating the margin, and when they priced the same thing on pay-per-request the CFO laughed out loud. The board has mandated containers. Size the fleet, pick the right front door, and make the economics work.',
    need: 'app',
    baselineRps: 800,
    spikeRps: 1600,
    spikeLabel: '🐳 Friday night — the whole city orders at once!',
    budget: 150,
    hasProbe: true,
    requiredServices: ['fargate'],
    goalHints: [
      'A Fargate task handles ~100 rps and costs $8/mo. Do the arithmetic for 800.',
      'Pay-per-request pricing is unbeatable when traffic is spiky and near-zero when idle — and ruinous when it is sustained. This traffic is sustained.',
      'API Gateway bills per request too. An ALB does the same job here for a flat $20.',
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
  {
    id: 'rag-grounded',
    track: 'genai',
    order: 2,
    difficulty: 3,
    title: 'Grounded',
    emoji: '📚',
    hook: 'Your chatbot cited a case that does not exist.',
    brief:
      'Your legal-tech client just found a citation in your bot’s answer to a court case that was never filed. New rule from their counsel: every answer must be grounded in their own document corpus. That means retrieve first, then generate — every single request now makes two hops before anyone gets an answer.',
    need: 'app',
    baselineRps: 150,
    spikeRps: 450,
    spikeLabel: '📚 Monday morning — the whole firm logs on!',
    budget: 175,
    hasProbe: true,
    requiredServices: ['opensearch', 'bedrock'],
    goalHints: [
      'Retrieval grounds a request; it never answers one. OpenSearch must hand off to the model behind it.',
      'Every request that reaches the model costs tokens and eats the 150 RPS quota — and the spike is 450.',
      'A semantic cache in front of the chain answers repeats outright. Only the misses need retrieving and generating.',
    ],
  },
  // ---------------------------------------------------------------- Data
  {
    id: 'the-feed',
    track: 'data',
    order: 1,
    difficulty: 2,
    title: 'The Feed',
    emoji: '📰',
    hook: 'Ninety percent reads, one primary. Do the arithmetic.',
    brief:
      'Your news app is a firehose of reading and a trickle of writing: for every post someone publishes, nine hundred people scroll past it. Compliance keeps the data relational, and after the stale-timeline incident last quarter the CTO has banned caching outright — "there are only two hard things in computer science, and we have done one of them to ourselves already". Scale the reads the other way.',
    need: 'app',
    baselineRps: 500,
    spikeRps: 1000,
    spikeLabel: '📰 Breaking news — everyone refreshes at once!',
    budget: 320,
    hasProbe: true,
    // 10% writes: the whole level lives in the gap between this and the reads.
    writeFraction: 0.1,
    banned: ['dynamodb', 'elasticache'],
    bannedReason:
      'Compliance keeps this relational, and the CTO banned the cache layer after the stale-timeline incident.',
    requiredServices: ['rds-replica'],
    goalHints: [
      'One RDS instance handles 250 rps of anything. At the spike you have ~900 reads a second — that is not a primary-sized problem.',
      'Each read replica takes 250 rps of reads and costs $40. Size them for the peak, not the average: replicas do not auto-scale.',
      'Replicas answer reads and refuse writes, and they need a primary to copy from. Keep the RDS instance in the design — it is where every write still lands.',
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
  {
    id: 'trivia-night',
    track: 'event-driven',
    order: 2,
    difficulty: 2,
    title: 'Trivia Night',
    emoji: '⚡',
    hook: 'Dead quiet, then 2,500 answers in the same second. Ten times a night.',
    brief:
      'Your live quiz app has a very particular shape: nothing happens for thirty seconds, the host reads a question, and then every player in the country taps an answer inside the same second. Then nothing again. Ten rounds a night. You cannot queue the answers and process them later — an answer scored after the reveal is void — so the compute has to be ready the instant the question closes, and it has to be worth paying for during the thirty seconds it does nothing.',
    need: 'app',
    baselineRps: 100,
    spikeRps: 2500,
    spikeLabel: '⚡ Question closes — every player answers at once!',
    budget: 120,
    hasProbe: true,
    coldStarts: true,
    // Ten rounds a night, in miniature: slam on, slam off, repeat.
    bursts: { onTicks: 4, offTicks: 4 },
    banned: ['sqs', 'sns', 'kinesis'],
    bannedReason:
      'An answer scored after the reveal is void — every submission has to be handled the moment it lands, not drained from a backlog.',
    requiredServices: ['lambda-pc'],
    goalHints: [
      'Serverless scales fast, not instantly. A function keeps only so much capacity warm, and a jump from 100 to 2,500 rps has to start containers for the difference — the requests waiting on them time out.',
      'Warmth drains away while you are idle, so every single round starts cold again. This is the workload provisioned concurrency exists for.',
      'Fixed fleets cannot help here: an Auto Scaling group tops out at 1,500 rps and Fargate at 2,000, and anything sized for 2,500 sits idle for the other thirty seconds of every round.',
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
  // ---------------------------------------------------------------- Day 2
  {
    id: 'game-day',
    track: 'day2',
    order: 1,
    difficulty: 3,
    title: 'Game Day',
    emoji: '🚨',
    hook: 'You are on call during the final. Two calls to make, live.',
    brief:
      'The tournament final streams tonight and you are holding the pager. The architecture is already deployed — that part is over. What is left is the part nobody puts in the design doc: two incidents will land mid-run, the clock will be running, and you will have to answer them while the traffic is still arriving. Both offers will be tempting. Neither is free.',
    need: 'app',
    baselineRps: 300,
    spikeRps: 1500,
    spikeLabel: '🚨 Kickoff — the whole tournament tunes in!',
    budget: 120,
    hasProbe: true,
    goalHints: [
      'Every incident is answerable with money. The question each one really asks is whether you needed to spend it.',
      'Emergency capacity is billed to the same budget you are scored against — buying your way out of the spike does not buy your way out of the bill.',
      'A fleet that scales on its own makes both decisions cheap. That call was made at design time, before the pager went off.',
    ],
    decisions: [
      {
        id: 'gd-capacity',
        phase: 'spike',
        tick: 3,
        emoji: '📈',
        title: 'Traffic is past forecast',
        prompt:
          'Viewership is running well above what anyone modelled, and it is still climbing. Your account manager can push emergency capacity through in seconds — at a premium that lands on this month’s bill.',
        options: [
          {
            label: 'Trust the design',
            outcome: 'Declined emergency capacity — the architecture carried the spike on its own.',
          },
          {
            label: 'Buy capacity · +$80/mo',
            outcome: 'Bought emergency capacity: 6× compute for the spike, and $80/mo on the bill.',
            surcharge: 80,
            computeFactor: { factor: 6, ticks: 24 },
          },
        ],
        defaultIndex: 0,
        seconds: 15,
      },
      {
        id: 'gd-deploy',
        phase: 'spike',
        tick: 13,
        emoji: '🐛',
        title: 'The 4pm deploy is leaking',
        prompt:
          'The build that shipped this afternoon is leaking memory. Throughput is decaying and it will not stop on its own. Rolling back costs you a couple of minutes of churn while instances cycle; riding it out means running degraded through the rest of the final.',
        options: [
          {
            label: 'Roll back now',
            outcome: 'Rolled back: two ticks of churn while the fleet cycled, then healthy again.',
            computeFactor: { factor: 0.75, ticks: 2 },
          },
          {
            label: 'Ride it out',
            outcome: 'Rode out the leak: capacity stayed degraded for the rest of the spike.',
            computeFactor: { factor: 0.6, ticks: 14 },
          },
        ],
        defaultIndex: 0,
        seconds: 15,
      },
    ],
  },
  {
    id: 'shakedown',
    track: 'day2',
    order: 2,
    difficulty: 3,
    title: 'The Shakedown',
    emoji: '👾',
    hook: 'Six thousand fake requests a second, and an email asking for money.',
    brief:
      'The email arrived first: pay, or we take you down tonight. Nobody paid, and at 8pm a botnet started throwing six thousand requests a second at your API — perfectly ordinary-looking requests, from thousands of addresses, indistinguishable from your actual customers once they are through the door. There are two ways this ends badly. Your capacity fills up with junk and real users get nothing; or you scale to absorb all of it, serve the botnet flawlessly, and open next month’s invoice. Filter it before it costs you anything.',
    need: 'app',
    baselineRps: 400,
    spikeRps: 600,
    spikeLabel: '👾 The botnet opens up — 6,000 junk req/s!',
    budget: 120,
    hasProbe: true,
    attack: { rps: 6000, label: '👾 UNDER ATTACK' },
    banned: ['sqs', 'sns', 'kinesis'],
    bannedReason:
      'Buffering an attack is paying to store it. Every request has to be answered or refused the moment it lands.',
    requiredServices: ['waf'],
    goalHints: [
      'Nothing behind your front door can tell a botnet from a customer. Whatever filtering you do has to happen before the request reaches anything you pay for.',
      'Absorbing the flood is not surviving it. A service elastic enough to serve 6,600 rps will bill you for all 6,600 — per-request pricing charges the same for junk.',
      'WAF is a flat $10 whether you are attacked or not, and it belongs first in the chain. Blocked after API Gateway is blocked after the meter has already run.',
    ],
    decisions: [
      {
        id: 'sd-scale',
        phase: 'spike',
        tick: 3,
        emoji: '📊',
        title: 'Everything is saturating',
        prompt:
          'Dashboards are solid red and the on-call channel wants to know why. You can take the fleet straight to its ceiling right now — triple the capacity, billed at emergency rates for the month.',
        options: [
          {
            label: 'Hold — this is not a capacity problem',
            outcome: 'Held the fleet. Whatever happened next, it was the architecture that did it.',
          },
          {
            label: 'Scale to the ceiling · +$60/mo',
            outcome: 'Tripled the fleet mid-attack: more capacity, most of it spent serving the botnet.',
            surcharge: 60,
            computeFactor: { factor: 3, ticks: 22 },
          },
        ],
        defaultIndex: 0,
        seconds: 15,
      },
      {
        id: 'sd-ransom',
        phase: 'spike',
        tick: 12,
        emoji: '💰',
        title: 'They have emailed again',
        prompt:
          'Same address, shorter message: $100 and it stops tonight. Legal is asleep, the CFO is not, and someone on the call has already said out loud that it is cheaper than the outage.',
        options: [
          {
            label: 'Do not pay',
            outcome: 'Refused to pay. The attack ran its course and the invoice stayed yours to explain.',
          },
          {
            label: 'Pay them · +$100/mo',
            outcome:
              'Paid $100. The flood stopped — and then it started again, because paying an attacker buys a pause, never an ending.',
            surcharge: 100,
            // Long enough to watch it happen and feel like it worked, short
            // enough that it never rescues a design. Measured: it moves a
            // saturating architecture from 30% to 59%, nowhere near the 95% bar.
            attackFactor: { factor: 0, ticks: 8 },
          },
        ],
        defaultIndex: 0,
        seconds: 15,
      },
    ],
  },
  // ---------------------------------------------------------- Going Global
  {
    id: 'blackout',
    track: 'global',
    order: 1,
    difficulty: 3,
    title: 'The Blackout',
    emoji: '🌑',
    hook: 'us-east-1 goes dark. Your app does not.',
    brief:
      'Your product is global now, and the board spent last month’s outage watching half the internet fall over with us-east-1 — including you. The new mandate is blunt: survive the loss of an entire Region, live, in front of them. Zoom out. One Region is no longer an architecture; it is a single point of failure with a lot of Availability Zones in it.',
    need: 'app',
    baselineRps: 400,
    spikeRps: 1200,
    spikeLabel: '🌍 Every timezone awake at once!',
    budget: 160,
    hasProbe: true,
    multiRegion: true,
    hasOutage: true,
    outageLabel: '🌑 An entire Region has gone dark!',
    requiredServices: ['route53'],
    goalHints: [
      'Everything except DNS and the CDN edge lives inside one Region — and dies with it. Each Region needs its own complete stack.',
      'Pointing Users straight at both Regions does not work: DNS clients do not health-check, so half your traffic keeps walking into the dead one. Route 53 does health-check.',
      'The survivor absorbs 100% of the load, so both Regions must be sized for the whole thing. Two idle fixed-size stacks will double your bill — this is what elasticity is actually for.',
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
