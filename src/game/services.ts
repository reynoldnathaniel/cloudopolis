// The service catalog. Numbers are "gamey but directionally true":
// fixed-cost services have hard capacity ceilings, serverless services
// auto-scale but bill per request.

export type Category =
  | 'client'
  | 'compute'
  | 'storage'
  | 'database'
  | 'network'
  | 'integration'
  | 'analytics'
  | 'ai'

export type Role =
  | 'client'
  | 'compute'
  | 'db'
  | 'router'
  | 'cdn'
  | 'origin-static'
  | 'cache'
  | 'queue'
  | 'fanout'
  /** A mid-chain grounding stage: serves nothing itself, forwards everything
   *  to the model behind it (retrieve-then-generate). */
  | 'retriever'

export interface ServiceDef {
  id: string
  name: string
  fullName: string
  abbr: string
  category: Category
  role: Role
  /** Fixed monthly cost in dollars */
  monthlyCost: number
  /** Usage cost: dollars per sustained RPS per month (serverless pricing) */
  costPerRps: number
  /** Requests per second one instance can handle (queues: ingest cap) */
  capacity: number
  autoScales: boolean
  /** Zonal services live in one Availability Zone and die with it (EC2, RDS, ElastiCache) */
  zonal: boolean
  /**
   * Global services live outside any one Region — DNS and the CDN edge network.
   * In multi-region scenarios everything else must be placed inside a Region box
   * and dies when that Region does; these survive.
   */
  global?: boolean
  /**
   * Elastic fleets (Auto Scaling groups, Fargate services): capacity is
   * `units × perUnit`, and the fleet steps toward demand at `rate` units per
   * tick rather than arriving instantly. The rate is the whole personality —
   * VMs boot slowly, containers start in seconds.
   */
  scaling?: {
    /** rps one unit (instance / task) handles */
    perUnit: number
    min: number
    max: number
    costPerUnit: number
    /** units addable per tick; removal is always 1 per tick */
    rate: number
    /** what one unit is called, for the node tile and palette */
    unitLabel: string
  }
  /** Queues only: how many events the backlog can hold before overflowing */
  bufferSize?: number
  /** May sit directly on the internet edge without failing the security probe */
  edgeSafe?: boolean
  blurb: string
}

export const CATEGORY_COLORS: Record<Category, string> = {
  client: '#64748b',
  compute: '#ED7100',
  storage: '#7AA116',
  database: '#C925D1',
  network: '#8C4FFF',
  integration: '#E7157B',
  analytics: '#8C4FFF',
  ai: '#01A88D',
}

export const SERVICES: Record<string, ServiceDef> = {
  users: {
    id: 'users',
    name: 'Users',
    fullName: 'Your users (the internet)',
    abbr: '👥',
    category: 'client',
    role: 'client',
    monthlyCost: 0,
    costPerRps: 0,
    capacity: Infinity,
    autoScales: true,
    zonal: false,
    global: true,
    blurb: 'Traffic starts here. Connect Users to your entry point.',
  },
  route53: {
    id: 'route53',
    name: 'Route 53',
    fullName: 'Amazon Route 53 (DNS + health checks)',
    abbr: 'R53',
    category: 'network',
    role: 'router',
    monthlyCost: 5,
    costPerRps: 0,
    capacity: 1000000,
    autoScales: true,
    zonal: false,
    global: true,
    edgeSafe: true,
    blurb:
      'Global DNS with health checks. It watches every endpoint behind it and stops answering with the ones that are down — so a whole Region can fail and users still land somewhere alive.',
  },
  cloudfront: {
    id: 'cloudfront',
    name: 'CloudFront',
    fullName: 'Amazon CloudFront (CDN)',
    abbr: 'CF',
    category: 'network',
    role: 'cdn',
    monthlyCost: 10,
    costPerRps: 0,
    capacity: 100000,
    autoScales: true,
    zonal: false,
    global: true,
    edgeSafe: true,
    blurb: 'Caches content at the edge. Serves ~80% of static traffic without touching your origin.',
  },
  s3: {
    id: 's3',
    name: 'S3',
    fullName: 'Amazon S3 (object storage)',
    abbr: 'S3',
    category: 'storage',
    role: 'origin-static',
    monthlyCost: 5,
    costPerRps: 0,
    capacity: 1000,
    autoScales: false,
    zonal: false,
    blurb: 'Stores and serves static files: HTML, images, video. Cannot run application code.',
  },
  alb: {
    id: 'alb',
    name: 'ALB',
    fullName: 'Application Load Balancer',
    abbr: 'ALB',
    category: 'network',
    role: 'router',
    monthlyCost: 20,
    costPerRps: 0,
    capacity: 20000,
    autoScales: true,
    zonal: false,
    edgeSafe: true,
    blurb: 'Spreads traffic across the compute instances behind it. Add more EC2 to scale out.',
  },
  ec2: {
    id: 'ec2',
    name: 'EC2',
    fullName: 'Amazon EC2 (virtual server)',
    abbr: 'EC2',
    category: 'compute',
    role: 'compute',
    monthlyCost: 35,
    costPerRps: 0,
    capacity: 150,
    autoScales: false,
    zonal: true,
    blurb: 'A virtual server. Fixed price, fixed capacity — one instance handles ~150 RPS, then it burns.',
  },
  asg: {
    id: 'asg',
    name: 'Auto Scaling',
    fullName: 'Amazon EC2 Auto Scaling group',
    abbr: 'ASG',
    category: 'compute',
    role: 'compute',
    monthlyCost: 0, // dynamic: see `scaling` below
    costPerRps: 0,
    capacity: 300, // display only — real capacity is instances × 150
    autoScales: true,
    zonal: false,
    scaling: { perUnit: 150, min: 2, max: 10, costPerUnit: 35, rate: 2, unitLabel: 'instances' },
    blurb:
      'A fleet of EC2 (2–10 instances, $35/mo each) that grows and shrinks with load. Spreads across AZs, so it survives zone failures — but booting instances takes time.',
  },
  fargate: {
    id: 'fargate',
    name: 'Fargate',
    fullName: 'Amazon ECS on AWS Fargate (containers)',
    abbr: 'ECS',
    category: 'compute',
    role: 'compute',
    monthlyCost: 0, // dynamic: see `scaling` below
    costPerRps: 0,
    capacity: 200, // display only — real capacity is tasks × 100
    autoScales: true,
    zonal: false,
    // 6 tasks/tick = +600 rps of capacity per tick, exactly twice what an ASG
    // adds (2 × 150). Containers start in seconds; VMs boot in minutes.
    scaling: { perUnit: 100, min: 2, max: 20, costPerUnit: 8, rate: 6, unitLabel: 'tasks' },
    blurb:
      'Containers without servers to manage. Tasks are small ($8/mo each) and start in seconds, so the fleet tracks load far more closely than VMs — and costs far less than per-request pricing at sustained traffic.',
  },
  lambda: {
    id: 'lambda',
    name: 'Lambda',
    fullName: 'AWS Lambda (serverless functions)',
    abbr: 'λ',
    category: 'compute',
    role: 'compute',
    monthlyCost: 0,
    costPerRps: 0.15,
    capacity: 10000,
    autoScales: true,
    zonal: false,
    blurb: 'Runs code without servers. Auto-scales with traffic; you pay per request, $0 when idle.',
  },
  apigw: {
    id: 'apigw',
    name: 'API Gateway',
    fullName: 'Amazon API Gateway',
    abbr: 'API',
    category: 'integration',
    role: 'router',
    monthlyCost: 5,
    costPerRps: 0.1,
    capacity: 50000,
    autoScales: true,
    zonal: false,
    edgeSafe: true,
    blurb: 'The front door for serverless APIs. Elastic and secure — but it bills for every request.',
  },
  rds: {
    id: 'rds',
    name: 'RDS',
    fullName: 'Amazon RDS (managed SQL database)',
    abbr: 'RDS',
    category: 'database',
    role: 'db',
    monthlyCost: 60,
    costPerRps: 0,
    capacity: 250,
    autoScales: false,
    zonal: true,
    blurb: 'Managed PostgreSQL/MySQL. Powerful but a fixed-size instance — saturates around 250 RPS.',
  },
  dynamodb: {
    id: 'dynamodb',
    name: 'DynamoDB',
    fullName: 'Amazon DynamoDB (serverless NoSQL)',
    abbr: 'DDB',
    category: 'database',
    role: 'db',
    monthlyCost: 8,
    costPerRps: 0.05,
    capacity: 10000,
    autoScales: true,
    zonal: false,
    blurb: 'Serverless key-value database. Auto-scales to almost any load; pay per request.',
  },
  elasticache: {
    id: 'elasticache',
    name: 'ElastiCache',
    fullName: 'Amazon ElastiCache (in-memory cache)',
    abbr: 'EC',
    category: 'database',
    role: 'cache',
    monthlyCost: 25,
    costPerRps: 0,
    capacity: 2000,
    autoScales: false,
    zonal: true,
    blurb:
      'In-memory cache in front of your database — or your LLM. Serves ~70% of repeat requests; forwards the rest. Zonal — dies with its AZ.',
  },
  sqs: {
    id: 'sqs',
    name: 'SQS',
    fullName: 'Amazon SQS (message queue)',
    abbr: 'SQS',
    category: 'integration',
    role: 'queue',
    monthlyCost: 2,
    costPerRps: 0,
    capacity: 1000000,
    autoScales: true,
    zonal: false,
    bufferSize: 500000,
    blurb:
      'A message queue: bursts become backlog, not loss. Consumers drain it at their own pace. Effectively unlimited buffer.',
  },
  sns: {
    id: 'sns',
    name: 'SNS',
    fullName: 'Amazon SNS (pub/sub fan-out)',
    abbr: 'SNS',
    category: 'integration',
    role: 'fanout',
    monthlyCost: 2,
    costPerRps: 0,
    capacity: 1000000,
    autoScales: true,
    zonal: false,
    blurb: 'Publish once, deliver everywhere: every subscriber gets its own copy of each event.',
  },
  kinesis: {
    id: 'kinesis',
    name: 'Kinesis',
    fullName: 'Amazon Kinesis Data Streams',
    abbr: 'KDS',
    category: 'analytics',
    role: 'queue',
    monthlyCost: 25,
    costPerRps: 0,
    capacity: 5000,
    autoScales: false,
    zonal: false,
    bufferSize: 100000,
    edgeSafe: true,
    blurb:
      'Durable high-volume ingest at a flat price. IAM-authenticated, so producers can write straight to it. Throttles writes above 5,000 rec/s.',
  },
  opensearch: {
    id: 'opensearch',
    name: 'OpenSearch',
    fullName: 'Amazon OpenSearch Serverless (vector store)',
    abbr: 'VEC',
    category: 'ai',
    role: 'retriever',
    monthlyCost: 60,
    costPerRps: 0,
    capacity: 1000,
    autoScales: false,
    zonal: false,
    blurb:
      'A vector store for retrieval-augmented generation. It grounds a request in your own documents, then passes it on to the model — it never answers by itself.',
  },
  bedrock: {
    id: 'bedrock',
    name: 'Bedrock',
    fullName: 'Amazon Bedrock (managed LLMs)',
    abbr: 'AI',
    category: 'ai',
    role: 'db',
    monthlyCost: 10,
    costPerRps: 0.6,
    capacity: 150,
    autoScales: false,
    zonal: false,
    blurb:
      'Managed foundation models. Pay per token — expensive — and throttled at a 150 RPS on-demand quota. Cache repeated prompts.',
  },
  sagemaker: {
    id: 'sagemaker',
    name: 'SageMaker',
    fullName: 'Amazon SageMaker (real-time inference)',
    abbr: 'SM',
    category: 'ai',
    role: 'db',
    monthlyCost: 90,
    costPerRps: 0,
    capacity: 2000,
    autoScales: false,
    zonal: false,
    blurb:
      'A provisioned ML inference endpoint: flat price, fixed capacity (2,000 predictions/s). Your own model, your own hardware.',
  },
}

export interface PaletteGroup {
  label: string
  items: ServiceDef[]
}

/** Palette, grouped for display (everything except the Users node) */
export const PALETTE_GROUPS: PaletteGroup[] = [
  { label: 'Edge & Network', items: [SERVICES.route53, SERVICES.cloudfront, SERVICES.alb, SERVICES.apigw] },
  { label: 'Compute', items: [SERVICES.ec2, SERVICES.asg, SERVICES.fargate, SERVICES.lambda] },
  { label: 'Data', items: [SERVICES.s3, SERVICES.rds, SERVICES.dynamodb, SERVICES.elasticache] },
  { label: 'Messaging & Streaming', items: [SERVICES.sqs, SERVICES.sns, SERVICES.kinesis] },
  { label: 'AI', items: [SERVICES.opensearch, SERVICES.bedrock, SERVICES.sagemaker] },
]

/** Flat palette list (used by tests and drag-drop lookups) */
export const PALETTE: ServiceDef[] = PALETTE_GROUPS.flatMap((g) => g.items)
