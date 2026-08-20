// Reference answers, one per built-in scenario, offered to a player who has
// failed the same level twice.
//
// These are DATA, not prose: `solutions.test.ts` builds every one of them and
// runs it through the real engine, asserting all three stars. So a future
// rebalance of services.ts or scenarios.ts cannot quietly leave the game
// handing out a wrong answer — it breaks the test gate first.
//
// Positions are in the same coordinate space the store uses: absolute for
// top-level nodes, relative to the AZ / Region box for anything placed inside
// one. The store owns the React Flow node shape; this file only says what goes
// where and why it works.

/** Structurally identical to the store's AzId / RegionId; kept local so this
 *  module stays dependency-free and the store can import it without a cycle. */
type Az = 'a' | 'b'
type Region = 'use1' | 'apne2'

export interface SolutionNode {
  /** Local handle, referenced by `edges` — not the final React Flow node id. */
  key: string
  serviceId: string
  x: number
  y: number
  /** VPC scenarios: which Availability Zone box this sits in */
  az?: Az
  /** Multi-region scenarios: which Region box this sits in */
  region?: Region
}

export interface Solution {
  nodes: SolutionNode[]
  /** [sourceKey, targetKey] — 'users' is always available as a source. */
  edges: [string, string][]
  /** Why this design works, shown after the reveal. Keep to three. */
  notes: string[]
}

// Chain layout for the levels with no containers: Users sits at x=40, so the
// design runs left to right from x=280 in 200px steps.
const chain = (...ids: string[]): SolutionNode[] =>
  ids.map((serviceId, i) => ({ key: serviceId, serviceId, x: 280 + i * 200, y: 250 }))

const link = (...keys: string[]): [string, string][] =>
  keys.slice(0, -1).map((k, i) => [k, keys[i + 1]] as [string, string])

// In VPC levels the AZ boxes own the middle of the canvas, so regional-but-not-
// zonal services stack in the column between Users and the VPC.
const COL_X = 148

export const SOLUTIONS: Record<string, Solution> = {
  'static-site': {
    nodes: chain('cloudfront', 's3'),
    edges: link('users', 'cloudfront', 's3'),
    notes: [
      'S3 stores and serves the files. CloudFront caches them at the edge, so ~80% of the launch-night spike never reaches your bucket.',
      'The bucket is never wired to Users directly — that is exactly the public-bucket finding the security probe hunts for.',
      '$15/mo, half the budget, because neither service charges you for sitting still.',
    ],
  },

  'photo-app': {
    nodes: chain('apigw', 'lambda', 'dynamodb'),
    edges: link('users', 'apigw', 'lambda', 'dynamodb'),
    notes: [
      'A dynamic request needs compute AND a data store behind it: API Gateway → Lambda → DynamoDB.',
      'Every piece here scales itself and bills per request, so the 1,200-rps evening rush costs money only while it is happening.',
      'ALB → Auto Scaling → DynamoDB also earns three stars, at $108 instead of $73. Both are right; they just bill differently.',
    ],
  },

  migration: {
    nodes: [
      { key: 'alb', serviceId: 'alb', x: 280, y: 250 },
      { key: 'ec2-1', serviceId: 'ec2', x: 500, y: 60 },
      { key: 'ec2-2', serviceId: 'ec2', x: 500, y: 180 },
      { key: 'ec2-3', serviceId: 'ec2', x: 500, y: 300 },
      { key: 'ec2-4', serviceId: 'ec2', x: 500, y: 420 },
      { key: 'dynamodb', serviceId: 'dynamodb', x: 730, y: 250 },
    ],
    edges: [
      ['users', 'alb'],
      ['alb', 'ec2-1'],
      ['alb', 'ec2-2'],
      ['alb', 'ec2-3'],
      ['alb', 'ec2-4'],
      ['ec2-1', 'dynamodb'],
      ['ec2-2', 'dynamodb'],
      ['ec2-3', 'dynamodb'],
      ['ec2-4', 'dynamodb'],
    ],
    notes: [
      'One EC2 instance handles 150 rps, so the 550-rps cutover needs four. A fifth costs $213 and blows the budget.',
      'The ALB health-checks each instance and spreads traffic evenly, so all four carry the same share.',
      'You pay for all four around the clock, even at 200 rps overnight. That waste is the whole argument for auto scaling.',
    ],
  },

  'flash-sale': {
    nodes: [
      { key: 'apigw', serviceId: 'apigw', x: COL_X, y: 90 },
      { key: 'lambda', serviceId: 'lambda', x: COL_X, y: 400 },
      { key: 'cache-a', serviceId: 'elasticache', x: 60, y: 55, az: 'a' },
      { key: 'rds-a', serviceId: 'rds', x: 60, y: 190, az: 'a' },
      { key: 'cache-b', serviceId: 'elasticache', x: 60, y: 55, az: 'b' },
      { key: 'rds-b', serviceId: 'rds', x: 60, y: 190, az: 'b' },
    ],
    edges: [
      ['users', 'apigw'],
      ['apigw', 'lambda'],
      ['lambda', 'cache-a'],
      ['lambda', 'cache-b'],
      ['cache-a', 'rds-a'],
      ['cache-b', 'rds-b'],
    ],
    notes: [
      'One of everything zonal in EACH Availability Zone. When one goes dark the other carries the sale alone — that is what redundancy costs and what it buys.',
      'ElastiCache absorbs ~70% of reads, which is the only reason RDS stays under its 250-rps ceiling during a 1,500-rps sale.',
      'Lambda fans out to both caches, so it keeps serving whichever zone survives. Wire it to only one and you have built a single point of failure with extra steps.',
    ],
  },

  'ipo-day': {
    nodes: [
      { key: 'cloudfront', serviceId: 'cloudfront', x: COL_X, y: 70 },
      { key: 'alb', serviceId: 'alb', x: COL_X, y: 230 },
      { key: 'asg', serviceId: 'asg', x: COL_X, y: 390 },
      { key: 'cache-a', serviceId: 'elasticache', x: 60, y: 55, az: 'a' },
      { key: 'rds-a', serviceId: 'rds', x: 60, y: 190, az: 'a' },
      { key: 'cache-b', serviceId: 'elasticache', x: 60, y: 55, az: 'b' },
      { key: 'rds-b', serviceId: 'rds', x: 60, y: 190, az: 'b' },
    ],
    edges: [
      ['users', 'cloudfront'],
      ['cloudfront', 'alb'],
      ['alb', 'asg'],
      ['asg', 'cache-a'],
      ['asg', 'cache-b'],
      ['cache-a', 'rds-a'],
      ['cache-b', 'rds-b'],
    ],
    notes: [
      'CloudFront caches ~30% of even dynamic traffic. Without it the 2,000-rps open beats a fully maxed-out Auto Scaling group — the CDN is not optional here.',
      'The ASG idles at 3 instances and grows to 10 for the spike, so you pay $305 at baseline instead of peak prices all month.',
      'Cache and database duplicated across both zones means the mid-trading AZ failure costs you nothing.',
    ],
  },

  replatform: {
    nodes: chain('alb', 'fargate', 'dynamodb'),
    edges: link('users', 'alb', 'fargate', 'dynamodb'),
    notes: [
      '800 rps needs 8 Fargate tasks at $8 each. The fleet doubles to 16 for the Friday rush and shrinks back after — $132/mo at baseline.',
      'An ALB is a flat $20 whatever the volume. API Gateway does the same job here for $197, because it bills every single request.',
      'Lambda serves this perfectly well and costs $188. Per-request pricing wins on spiky traffic and loses on sustained traffic; this is sustained.',
    ],
  },

  'prompt-rush': {
    nodes: chain('apigw', 'lambda', 'elasticache', 'bedrock'),
    edges: link('users', 'apigw', 'lambda', 'elasticache', 'bedrock'),
    notes: [
      'ElastiCache in front of the model is a semantic cache: users ask the same things, so ~70% of prompts are answered without an LLM call at all.',
      'That turns a 400-rps spike into ~120 rps at Bedrock — under the 150-rps on-demand quota — so the throttling simply stops happening.',
      'The same 70% never spends a token. One cache fixes the quota and the bill together, at $83 of a $150 budget.',
    ],
  },

  'rag-grounded': {
    nodes: chain('apigw', 'lambda', 'elasticache', 'opensearch', 'bedrock'),
    edges: link('users', 'apigw', 'lambda', 'elasticache', 'opensearch', 'bedrock'),
    notes: [
      'Retrieve, then generate: OpenSearch grounds the request in your documents and forwards all of it to Bedrock. It never answers by itself — a chain that stops at the vector store serves 0%.',
      'Every request that reaches the model costs tokens and quota, and the spike is 450 against a 150-rps ceiling.',
      'So the cache goes in FRONT of the chain, not inside it. Repeats are answered outright; only the misses pay to retrieve and generate.',
    ],
  },

  'the-feed': {
    nodes: [
      { key: 'alb', serviceId: 'alb', x: 270, y: 250 },
      { key: 'app', serviceId: 'fargate', x: 460, y: 250 },
      { key: 'rds', serviceId: 'rds', x: 680, y: 40 },
      { key: 'rr-1', serviceId: 'rds-replica', x: 680, y: 150 },
      { key: 'rr-2', serviceId: 'rds-replica', x: 680, y: 260 },
      { key: 'rr-3', serviceId: 'rds-replica', x: 680, y: 370 },
      { key: 'rr-4', serviceId: 'rds-replica', x: 680, y: 480 },
    ],
    edges: [
      ['users', 'alb'],
      ['alb', 'app'],
      ['app', 'rds'],
      ['app', 'rr-1'],
      ['app', 'rr-2'],
      ['app', 'rr-3'],
      ['app', 'rr-4'],
    ],
    notes: [
      'At the spike, 1,000 rps splits into ~100 writes and ~900 reads. The writes fit on one primary with room to spare; the reads need 900 ÷ 250 = four replicas.',
      'Three replicas serve 750 reads and drop the rest — 85%, short of the 95% bar. Replicas do not auto-scale, so you size them for the peak and pay for them at the trough.',
      'The primary stays in the design because writes have nowhere else to go, and because a replica is a copy — with no primary to stream from, replicas serve nothing at all.',
    ],
  },

  'order-storm': {
    nodes: chain('apigw', 'sns', 'sqs', 'lambda', 'dynamodb'),
    edges: link('users', 'apigw', 'sns', 'sqs', 'lambda', 'dynamodb'),
    notes: [
      'Stop thinking in requests. SNS publishes the order, SQS buffers it, and the 12,000-rps burst becomes a backlog instead of thousands of lost tickets.',
      'Lambda drains the queue at its own pace. Late is fine here; lost is not — and a synchronous design has no choice but to drop, because Lambda tops out at 10,000 rps.',
      'The backlog must reach zero by the end of the run. That is the Drain pillar: buffering is only a solution if you can catch up.',
    ],
  },

  'click-stream': {
    nodes: chain('kinesis', 'lambda', 'sagemaker'),
    edges: link('users', 'kinesis', 'lambda', 'sagemaker'),
    notes: [
      'Kinesis is a flat-price, IAM-authenticated ingest edge — the one queue the security probe lets producers write to directly.',
      'API Gateway in the same slot would add ~$50/mo at 500 rps sustained, before a single event is scored.',
      'Lambda consumers read the stream and call the SageMaker endpoint, whose 2,000 predictions/s covers the prime-time flood.',
    ],
  },

  blackout: {
    nodes: [
      { key: 'route53', serviceId: 'route53', x: 165, y: 245 },
      { key: 'alb-1', serviceId: 'alb', x: 30, y: 50, region: 'use1' },
      { key: 'fargate-1', serviceId: 'fargate', x: 225, y: 50, region: 'use1' },
      { key: 'dynamodb-1', serviceId: 'dynamodb', x: 420, y: 50, region: 'use1' },
      { key: 'alb-2', serviceId: 'alb', x: 30, y: 50, region: 'apne2' },
      { key: 'fargate-2', serviceId: 'fargate', x: 225, y: 50, region: 'apne2' },
      { key: 'dynamodb-2', serviceId: 'dynamodb', x: 420, y: 50, region: 'apne2' },
    ],
    edges: [
      ['users', 'route53'],
      ['route53', 'alb-1'],
      ['alb-1', 'fargate-1'],
      ['fargate-1', 'dynamodb-1'],
      ['route53', 'alb-2'],
      ['alb-2', 'fargate-2'],
      ['fargate-2', 'dynamodb-2'],
    ],
    notes: [
      'A complete stack in each Region — router, compute, and data. A standby Region cannot borrow the dead one’s database.',
      'Route 53 health-checks its targets and stops handing out the dead Region. Wire Users to both Regions instead and half of every request keeps walking into the corpse: 50%, one star.',
      'The survivor absorbs 100% of the load, so both Regions must be sized for all of it. Two fixed-size EC2 + RDS stacks would cost $305; this one is $113.',
    ],
  },
}

/** Levels with an authored reference answer (excludes custom scenarios and the sandbox). */
export const hasSolution = (scenarioId: string): boolean => scenarioId in SOLUTIONS

/** Failed completed runs on one scenario before the reveal is offered. */
export const REVEAL_AFTER_FAILURES = 2
