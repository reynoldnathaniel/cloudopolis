// Smoke suite: walks the journeys a player actually clicks through, against the
// production build. This is a tripwire for "the app is broken", not a test of
// every branch — the engine's balance is pinned by the vitest suite instead.
//
// Each test gets a fresh browser context, so localStorage is empty and
// first-visit behaviour (briefings, the sandbox tour) is exercised for real.

import { test, expect, type Page } from '@playwright/test'

/** Palette buttons carry the service's full name in `title` — a stable handle. */
const palette = (page: Page, fullNamePrefix: string) =>
  page.locator(`button[title^="${fullNamePrefix}"]`)

const node = (page: Page, serviceIdPrefix: string) =>
  page.locator(`.react-flow__node[data-id^="${serviceIdPrefix}"]`).first()

/** Bring every node into view — click-to-add drops them at scattered positions. */
async function fitView(page: Page) {
  await page.locator('.react-flow__controls-fitview').click()
  await page.waitForTimeout(600) // fitView is animated
}

/** Drag from one node's right handle to another's left handle to draw an edge. */
async function connect(page: Page, fromSelector: string, toSelector: string) {
  const source = page.locator(`${fromSelector} .react-flow__handle-right`).first()
  const target = page.locator(`${toSelector} .react-flow__handle-left`).first()
  const a = await source.boundingBox()
  const b = await target.boundingBox()
  if (!a || !b) throw new Error(`no handle box for ${fromSelector} -> ${toSelector}`)
  const ax = a.x + a.width / 2
  const ay = a.y + a.height / 2
  const bx = b.x + b.width / 2
  const by = b.y + b.height / 2

  await page.mouse.move(ax, ay)
  await page.mouse.down()
  // React Flow starts a connection only after the pointer actually moves, and
  // wants intermediate moves before it will latch onto the target handle.
  await page.mouse.move(ax + 10, ay + 10)
  await page.mouse.move(bx, by, { steps: 20 })
  await page.mouse.move(bx, by)
  await page.mouse.up()
}

const edgeCount = (page: Page) => page.locator('.react-flow__edge').count()

test.describe('SimCloud smoke', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
  })

  test('main menu renders, with no Continue on a fresh profile', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'SimCloud' })).toBeVisible()
    await expect(page.getByRole('button', { name: /Learn to play/ })).toBeVisible()
    await expect(page.getByRole('button', { name: /Choose a scenario/ })).toBeVisible()
    await expect(page.getByRole('button', { name: /Sandbox/ })).toBeVisible()
    await expect(page.getByRole('button', { name: /Continue building/ })).toHaveCount(0)
  })

  test('the tutorial coach opens and actually leaves when skipped', async ({ page }) => {
    await page.getByRole('button', { name: /Learn to play/ }).click()
    const coach = page.getByText(/^Tutorial · \d+\/\d+$/)
    await expect(coach).toBeVisible()
    await expect(page.getByText('Welcome, architect!')).toBeVisible()

    await page.getByRole('button', { name: 'skip tutorial ✕' }).click()
    // Regression guard: the card must leave the screen, not freeze mid-fade.
    await expect(coach).toBeHidden()
  })

  test('scenario select lists every track, plus sandbox and the editor entry', async ({ page }) => {
    await page.getByRole('button', { name: /Choose a scenario/ }).click()
    await expect(page.getByRole('heading', { name: 'Choose your scenario' })).toBeVisible()

    for (const track of ['Foundations', 'Scaling Up', 'Event-Driven', 'GenAI', 'Day 2', 'My Scenarios']) {
      await expect(page.getByRole('heading', { name: new RegExp(track) })).toBeVisible()
    }
    for (const title of ['Launch Day', 'PhotoShare', 'IPO Day', 'Prompt Rush', 'Grounded', 'Order Storm', 'Click Stream']) {
      await expect(page.getByText(title, { exact: false }).first()).toBeVisible()
    }
    await expect(page.getByRole('button', { name: /New scenario/ })).toBeVisible()
  })

  test('Launch Day: briefing, build, simulate, three stars', async ({ page }) => {
    await page.getByRole('button', { name: /Choose a scenario/ }).click()
    await page.getByRole('button', { name: /Launch Day/ }).click()

    // First visit auto-opens the mission briefing.
    await expect(page.getByRole('heading', { level: 2, name: 'Launch Day' })).toBeVisible()
    await page.getByRole('button', { name: /Let's build/ }).click()

    await palette(page, 'Amazon CloudFront').click()
    await palette(page, 'Amazon S3').click()
    await expect(node(page, 'cloudfront')).toBeVisible()
    await expect(node(page, 's3')).toBeVisible()
    await fitView(page)

    await connect(page, '.react-flow__node[data-id="users"]', '.react-flow__node[data-id^="cloudfront"]')
    await connect(page, '.react-flow__node[data-id^="cloudfront"]', '.react-flow__node[data-id^="s3"]')
    expect(await edgeCount(page)).toBe(2)

    await page.getByRole('button', { name: /Simulate/ }).click()

    // The run is a real ~15s simulation: baseline, spike, recovery, probe.
    await expect(page.getByText('Well-Architected!')).toBeVisible({ timeout: 45_000 })
    await expect(page.getByText('✓ 100%').first()).toBeVisible()
    await expect(page.getByText('clean')).toBeVisible()
    await expect(page.getByText('✓ $15/mo')).toBeVisible()
  })

  test('The Blackout: Route 53 fails over when a whole Region goes dark', async ({ page }) => {
    await page.getByRole('button', { name: /Choose a scenario/ }).click()
    await page.getByRole('button', { name: /The Blackout/ }).click()

    await expect(page.getByRole('heading', { level: 2, name: 'The Blackout' })).toBeVisible()
    await expect(page.getByText(/Survive the loss of an entire/)).toBeVisible()
    await page.getByRole('button', { name: /Let's build/ }).click()

    // The canvas is Regions, not AZs.
    await expect(page.getByText('Region · us-east-1')).toBeVisible()
    await expect(page.getByText('Region · ap-northeast-2')).toBeVisible()

    // Click order decides auto-placement: regional services alternate between
    // the two Region boxes, global ones (Route 53) stay outside both.
    await palette(page, 'Amazon Route 53').click()
    await palette(page, 'Application Load Balancer').click()
    await palette(page, 'Amazon ECS on AWS Fargate').click()
    await palette(page, 'Amazon DynamoDB').click()
    await palette(page, 'Application Load Balancer').click()
    await palette(page, 'Amazon ECS on AWS Fargate').click()
    await palette(page, 'Amazon DynamoDB').click()

    // us-east-1 gets alb-2 / fargate-6 / dynamodb-4; ap-northeast-2 the rest.
    // Nothing should be begging for a home.
    await expect(page.getByText(/needs Region/)).toHaveCount(0)
    await fitView(page)

    const n = (id: string) => `.react-flow__node[data-id="${id}"]`
    await connect(page, n('users'), n('route53-1'))
    await connect(page, n('route53-1'), n('alb-2'))
    await connect(page, n('alb-2'), n('fargate-6'))
    await connect(page, n('fargate-6'), n('dynamodb-4'))
    await connect(page, n('route53-1'), n('alb-5'))
    await connect(page, n('alb-5'), n('fargate-3'))
    await connect(page, n('fargate-3'), n('dynamodb-7'))
    expect(await edgeCount(page)).toBe(7)

    await page.getByRole('button', { name: /Simulate/ }).click()

    // The outage phase kills an entire Region — the HUD and the Region box must
    // both say so. Poll for them together: the phase lasts about four seconds,
    // so asserting one after the other races the simulation.
    await Promise.all([
      expect(page.getByText('REGION OUTAGE')).toBeVisible({ timeout: 45_000 }),
      expect(page.getByText(/— DARK/)).toBeVisible({ timeout: 45_000 }),
    ])

    await expect(page.getByText('Well-Architected!')).toBeVisible({ timeout: 45_000 })
    await expect(page.getByText('survive the Region failure (≥95%)')).toBeVisible()
    await expect(page.getByText('✓ $113/mo')).toBeVisible()
  })

  test('Game Day: an incident freezes the run, and buying capacity shows on the bill', async ({
    page,
  }) => {
    await page.getByRole('button', { name: /Choose a scenario/ }).click()
    await page.getByRole('button', { name: /Game Day/ }).click()
    await page.getByRole('button', { name: /Let's build/ }).click()

    // An elastic fleet: this design does not need anything the incidents offer.
    await palette(page, 'Application Load Balancer').click()
    await palette(page, 'Amazon ECS on AWS Fargate').click()
    await palette(page, 'Amazon DynamoDB').click()
    await fitView(page)
    const n = (id: string) => `.react-flow__node[data-id="${id}"]`
    await connect(page, n('users'), n('alb-1'))
    await connect(page, n('alb-1'), n('fargate-2'))
    await connect(page, n('fargate-2'), n('dynamodb-3'))
    expect(await edgeCount(page)).toBe(3)

    await page.getByRole('button', { name: /Simulate/ }).click()

    // First incident: the run must actually stop and wait.
    await expect(page.getByText('Traffic is past forecast')).toBeVisible({ timeout: 30_000 })
    const rpsAt = async () =>
      page.evaluate(() => /(\d[\d,]*)\s*REQ\/S/i.exec(document.body.innerText)?.[1] ?? null)
    const before = await rpsAt()
    expect(before).not.toBeNull()
    await page.waitForTimeout(2_500) // ~14 ticks would have elapsed if it were running
    expect(await rpsAt()).toBe(before)

    // Take the expensive way out.
    await page.getByRole('button', { name: /Buy capacity/ }).click()
    await expect(page.getByText('Traffic is past forecast')).toHaveCount(0)

    // Second incident: take the runbook default explicitly.
    await expect(page.getByText('The 4pm deploy is leaking')).toBeVisible({ timeout: 30_000 })
    await page.getByRole('button', { name: /Roll back now/ }).click()

    await expect(page.getByRole('button', { name: 'Running…' })).toHaveCount(0, { timeout: 60_000 })

    // The design held; the surcharge is what costs the third star.
    await expect(page.getByText('survive the spike (≥95%)')).toBeVisible()
    await expect(page.getByText(/incl\. \$80 bought mid-incident/)).toBeVisible()
    await expect(page.getByText('✗ $147/mo')).toBeVisible()
    await expect(page.getByText('🚨 Calls you made')).toBeVisible()
  })

  test('The Shakedown: WAF scrubs the flood at the edge, and the bill stays clean', async ({
    page,
  }) => {
    await page.getByRole('button', { name: /Choose a scenario/ }).click()
    await page.getByRole('button', { name: /The Shakedown/ }).click()
    await page.getByRole('button', { name: /Let's build/ }).click()

    // WAF first, in front of everything that has a ceiling or a meter.
    await palette(page, 'AWS WAF').click()
    await palette(page, 'Application Load Balancer').click()
    await palette(page, 'Amazon ECS on AWS Fargate').click()
    await palette(page, 'Amazon DynamoDB').click()
    await fitView(page)
    const n = (id: string) => `.react-flow__node[data-id="${id}"]`
    await connect(page, n('users'), n('waf-1'))
    await connect(page, n('waf-1'), n('alb-2'))
    await connect(page, n('alb-2'), n('fargate-3'))
    await connect(page, n('fargate-3'), n('dynamodb-4'))
    expect(await edgeCount(page)).toBe(4)

    await page.getByRole('button', { name: /Simulate/ }).click()

    // The first incident freezes the run three ticks into the attack, which is
    // the one moment the attack readouts are guaranteed to hold still — assert
    // them here rather than racing a phase that lasts a few seconds.
    await expect(page.getByText('Everything is saturating')).toBeVisible({ timeout: 30_000 })
    await expect(page.getByText('👾 UNDER ATTACK')).toBeVisible()
    await expect(page.getByText('junk/s')).toBeVisible()
    // Six thousand arriving, six thousand dying at the edge.
    const hud = await page.evaluate(() => document.body.innerText)
    expect(hud).toContain('+6,000')
    expect(hud).toContain('🛡 6,000')

    // Neither offer is worth taking when the junk is already gone.
    await page.getByRole('button', { name: /this is not a capacity problem/ }).click()
    await expect(page.getByText('They have emailed again')).toBeVisible({ timeout: 30_000 })
    await page.getByRole('button', { name: /Do not pay/ }).click()

    await expect(page.getByRole('button', { name: 'Running…' })).toHaveCount(0, { timeout: 60_000 })

    await expect(page.getByText('Well-Architected!')).toBeVisible()
    await expect(page.getByText('drop the flood before it costs you anything')).toBeVisible()
    await expect(page.getByText('✓ 6,000 blocked')).toBeVisible()
    await expect(page.getByText('✓ $90/mo')).toBeVisible()
  })

  test('Trivia Night: plain Lambda cold-starts on every burst, PC does not', async ({ page }) => {
    // One failure already banked, so this run's failure unlocks the reveal.
    await page.addInitScript(() => {
      localStorage.setItem(
        'simcloud-save-v1',
        JSON.stringify({ failedRuns: { 'trivia-night': 1 }, tutorialDone: true }),
      )
    })
    await page.goto('/')

    await page.getByRole('button', { name: /Choose a scenario/ }).click()
    await page.getByRole('button', { name: /Trivia Night/ }).click()
    await expect(page.getByText(/only serves what it has/)).toBeVisible()
    await page.getByRole('button', { name: /Let's build/ }).click()
    await expect(page.getByText('⚡ bursts')).toBeVisible()

    // "AWS Lambda (" is the plain one; the other is "...with provisioned concurrency".
    await palette(page, 'Amazon API Gateway').click()
    await palette(page, 'AWS Lambda (').click()
    await palette(page, 'Amazon DynamoDB').click()
    await fitView(page)

    const n = (id: string) => `.react-flow__node[data-id="${id}"]`
    await connect(page, n('users'), n('apigw-1'))
    await connect(page, n('apigw-1'), n('lambda-2'))
    await connect(page, n('lambda-2'), n('dynamodb-3'))
    expect(await edgeCount(page)).toBe(3)

    await page.getByRole('button', { name: /Simulate/ }).click()
    await expect(page.getByRole('button', { name: 'Running…' })).toHaveCount(0, { timeout: 60_000 })

    // Fine at baseline, fine on cost — and it still loses the spike, every burst.
    await expect(page.getByText('✓ 100%').first()).toBeVisible()
    await expect(page.getByText('✗ 86%')).toBeVisible()
    await expect(page.getByText(/had containers warm/)).toBeVisible()

    // Provisioned concurrency is the fix, and it earns the stars.
    await page.getByRole('button', { name: /Stuck\? Reveal/ }).click()
    await page.getByRole('button', { name: 'Show me' }).click()
    await expect(page.locator(n('sol-lambda-pc'))).toBeVisible()
    await page.getByRole('button', { name: /Run the reference design/ }).click()
    await expect(page.getByRole('button', { name: 'Running…' })).toHaveCount(0, { timeout: 60_000 })
    await expect(page.getByText('Well-Architected!')).toBeVisible()
    await expect(page.getByText('✓ $103/mo')).toBeVisible()
  })

  test('The Feed: reads go to the replicas, writes to the one primary', async ({ page }) => {
    // Arrive with the reveal already earned — the unlock rule has its own test.
    await page.addInitScript(() => {
      localStorage.setItem(
        'simcloud-save-v1',
        JSON.stringify({ failedRuns: { 'the-feed': 2 }, tutorialDone: true }),
      )
    })
    await page.goto('/')

    await page.getByRole('button', { name: /Choose a scenario/ }).click()
    await page.getByRole('button', { name: /The Feed/ }).click()

    await expect(page.getByRole('heading', { level: 2, name: 'The Feed' })).toBeVisible()
    await expect(page.getByText(/of that traffic is writes/)).toBeVisible()
    await page.getByRole('button', { name: /Let's build/ }).click()

    // The new service is reachable from the palette. "Amazon RDS (" is what
    // separates the primary from "Amazon RDS read replica".
    await expect(palette(page, 'Amazon RDS read replica')).toBeVisible()
    await palette(page, 'Amazon RDS (').click()
    await palette(page, 'Amazon RDS read replica').click()
    await expect(node(page, 'rds-replica')).toBeVisible()

    // Hand-wiring five data nodes is a coin flip in a headless browser — they
    // auto-place at random points and overlap — so take the reference design,
    // whose positions are fixed, and check the mechanic on it instead.
    await page.getByRole('button', { name: /Reveal a 3-star answer/ }).click()
    await page.getByRole('button', { name: 'Show me' }).click()
    await page.getByRole('button', { name: /Run the reference design/ }).click()
    await expect(page.getByRole('button', { name: 'Running…' })).toHaveCount(0, { timeout: 60_000 })

    await expect(page.getByText('Well-Architected!')).toBeVisible()
    await expect(page.getByText('✓ $280/mo')).toBeVisible()
    await expect(page.getByText('✓ complete')).toBeVisible()

    // The split itself, read off the canvas at the last baseline tick: 10% of
    // 500 rps lands on the primary, and the other 450 spread over 4 replicas.
    const rpsIn = async (id: string) => {
      const text = await page.locator(`.react-flow__node[data-id="${id}"]`).innerText()
      return Number(/(\d+) rps in/.exec(text)?.[1] ?? -1)
    }
    expect(await rpsIn('sol-rds')).toBe(50)
    expect(await rpsIn('sol-rr-1')).toBe(113)
  })

  test('Paper Trail: the bus routes by rule and Firehose archives the lot', async ({ page }) => {
    await page.getByRole('button', { name: /Choose a scenario/ }).click()
    await page.getByRole('button', { name: /Paper Trail/ }).click()
    await page.getByRole('button', { name: /Let's build/ }).click()

    await palette(page, 'Amazon EventBridge').click()
    await palette(page, 'Amazon SQS').click()
    await palette(page, 'AWS Lambda (serverless').click()
    await palette(page, 'AWS Lambda (serverless').click()
    await palette(page, 'Amazon DynamoDB').click()
    await palette(page, 'Amazon Data Firehose').click()
    await palette(page, 'Amazon S3').click()
    await fitView(page)

    const n = (id: string) => `.react-flow__node[data-id="${id}"]`
    await connect(page, n('users'), n('eventbridge-1'))
    // Orders: 70% of the stream, buffered.
    await connect(page, n('eventbridge-1'), n('sqs-2'))
    await connect(page, n('sqs-2'), n('lambda-3'))
    await connect(page, n('lambda-3'), n('dynamodb-5'))
    // Fraud: the 5% rule, straight off the bus.
    await connect(page, n('eventbridge-1'), n('lambda-4'))
    await connect(page, n('lambda-4'), n('dynamodb-5'))
    // Archive: everything, with no function in the path.
    await connect(page, n('eventbridge-1'), n('firehose-6'))
    await connect(page, n('firehose-6'), n('s3-7'))
    expect(await edgeCount(page)).toBe(8)

    await page.getByRole('button', { name: /Simulate/ }).click()
    await expect(page.getByRole('button', { name: 'Running…' })).toHaveCount(0, { timeout: 90_000 })

    await expect(page.getByText('Well-Architected!')).toBeVisible()
    // Async scoring: nothing lost, nothing left in a queue.
    await expect(page.getByText('≥98% of events processed by run end')).toBeVisible()
    await expect(page.getByText('✓ $175/mo')).toBeVisible()
  })

  test('two failed runs unlock the reference answer, which then three-stars', async ({ page }) => {
    await page.getByRole('button', { name: /Choose a scenario/ }).click()
    await page.getByRole('button', { name: /Launch Day/ }).click()
    await page.getByRole('button', { name: /Let's build/ }).click()

    // A bare public bucket: fails the spike and the probe, every time.
    await palette(page, 'Amazon S3').click()
    await fitView(page)
    await connect(page, '.react-flow__node[data-id="users"]', '.react-flow__node[data-id^="s3"]')

    // A dismissed results modal lingers in the DOM at opacity 0, and Playwright
    // counts that as visible — so "the run finished" has to be anchored on the
    // sidebar button, not on anything inside the modal.
    const runToCompletion = async () => {
      await page.getByRole('button', { name: /Simulate/ }).click()
      await expect(page.getByRole('button', { name: 'Running…' })).toHaveCount(0, { timeout: 45_000 })
    }

    // Run 1: short of three stars, but one failure leaves the offer locked.
    await runToCompletion()
    await expect(page.getByRole('button', { name: /Stuck\? Reveal/ })).toHaveCount(0)
    await page.getByRole('button', { name: 'Refine design' }).last().click()
    await expect(page.getByRole('button', { name: /Reveal a 3-star answer/ })).toHaveCount(0)

    // Run 2: the second failure unlocks it.
    await runToCompletion()
    const offer = page.getByRole('button', { name: /Stuck\? Reveal/ })
    await expect(offer).toBeVisible()

    // It asks before destroying your canvas.
    await offer.click()
    await expect(page.getByText(/Your current layout will be gone/)).toBeVisible()
    await page.getByRole('button', { name: 'Show me' }).click()

    // The reference design replaces the canvas, and explains itself.
    await expect(page.getByText(/Reference answer · Launch Day/i)).toBeVisible()
    await expect(page.locator('.react-flow__node[data-id="sol-cloudfront"]')).toBeVisible()
    await expect(page.locator('.react-flow__node[data-id="sol-s3"]')).toBeVisible()

    // And it actually earns the three stars it promises.
    await page.getByRole('button', { name: /Run the reference design/ }).click()
    await expect(page.getByRole('button', { name: 'Running…' })).toHaveCount(0, { timeout: 45_000 })
    await expect(page.getByText('Well-Architected!')).toBeVisible()
    await expect(page.getByText('✓ $15/mo')).toBeVisible()
  })

  test('the run timeline expands and closes', async ({ page }) => {
    await page.getByRole('button', { name: /Choose a scenario/ }).click()
    await page.getByRole('button', { name: /Launch Day/ }).click()
    await page.getByRole('button', { name: /Let's build/ }).click()
    await palette(page, 'Amazon CloudFront').click()
    await palette(page, 'Amazon S3').click()
    await fitView(page)
    await connect(page, '.react-flow__node[data-id="users"]', '.react-flow__node[data-id^="cloudfront"]')
    await connect(page, '.react-flow__node[data-id^="cloudfront"]', '.react-flow__node[data-id^="s3"]')
    await page.getByRole('button', { name: /Simulate/ }).click()
    await expect(page.getByText('Well-Architected!')).toBeVisible({ timeout: 45_000 })

    // Inline sparkline is there; expanding gives the full dual-axis chart.
    await expect(page.locator('svg[viewBox="0 0 372 112"]')).toBeVisible()
    await page.getByRole('button', { name: /bigger/ }).click()
    const expanded = page.locator('svg[viewBox="0 0 780 430"]')
    await expect(expanded).toBeVisible()
    await expect(page.getByText(/Run timeline — Launch Day/)).toBeVisible()

    await page.keyboard.press('Escape')
    await expect(expanded).toBeHidden()
    // The results modal is still underneath.
    await expect(page.getByText('Well-Architected!')).toBeVisible()
  })

  test('presenter controls freeze the run and step it forward', async ({ page }) => {
    await page.getByRole('button', { name: /Choose a scenario/ }).click()
    await page.getByRole('button', { name: /Launch Day/ }).click()
    await page.getByRole('button', { name: /Let's build/ }).click()
    await palette(page, 'Amazon CloudFront').click()
    await palette(page, 'Amazon S3').click()
    await fitView(page)
    await connect(page, '.react-flow__node[data-id="users"]', '.react-flow__node[data-id^="cloudfront"]')
    await connect(page, '.react-flow__node[data-id^="cloudfront"]', '.react-flow__node[data-id^="s3"]')
    await page.getByRole('button', { name: /Simulate/ }).click()

    const step = page.getByRole('button', { name: 'Step one tick' })
    await expect(step).toBeDisabled() // only meaningful while frozen

    await page.getByRole('button', { name: 'Pause' }).click()
    await expect(page.getByText('⏸ PAUSED')).toBeVisible()
    await expect(step).toBeEnabled()

    // Hold the freeze past the whole baseline phase; a broken pause would burst
    // through every missed tick on resume instead of shifting its clock.
    await page.waitForTimeout(5_000)
    await expect(page.getByText('⏸ PAUSED')).toBeVisible()
    await step.click()

    await page.getByRole('button', { name: 'Resume' }).click()
    await expect(page.getByText('BASELINE')).toBeVisible()
    await expect(page.getByText('Well-Architected!')).toBeVisible({ timeout: 45_000 })
  })

  test('the canvas exports a PNG of the architecture', async ({ page }) => {
    await page.getByRole('button', { name: /Choose a scenario/ }).click()
    await page.getByRole('button', { name: /Launch Day/ }).click()
    await page.getByRole('button', { name: /Let's build/ }).click()
    await palette(page, 'Amazon CloudFront').click()
    await palette(page, 'Amazon S3').click()
    await fitView(page)

    // Capture the generated data URL rather than writing a file to disk.
    await page.evaluate(() => {
      ;(window as unknown as { __png?: string }).__png = undefined
      HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
        if (this.download) (window as unknown as { __png?: string }).__png = this.href
      }
    })
    await page.getByRole('button', { name: 'Export architecture as PNG' }).click()

    await expect
      .poll(async () => page.evaluate(() => (window as unknown as { __png?: string }).__png?.length ?? 0), {
        timeout: 20_000,
      })
      .toBeGreaterThan(10_000) // a real render, not a blank or truncated image

    const href = await page.evaluate(() => (window as unknown as { __png?: string }).__png ?? '')
    expect(href.startsWith('data:image/png;base64,')).toBe(true)
  })

  test('the results modal exports a share card', async ({ page }) => {
    await page.getByRole('button', { name: /Choose a scenario/ }).click()
    await page.getByRole('button', { name: /Launch Day/ }).click()
    await page.getByRole('button', { name: /Let's build/ }).click()
    await palette(page, 'Amazon CloudFront').click()
    await palette(page, 'Amazon S3').click()
    await fitView(page)
    await connect(page, '.react-flow__node[data-id="users"]', '.react-flow__node[data-id^="cloudfront"]')
    await connect(page, '.react-flow__node[data-id^="cloudfront"]', '.react-flow__node[data-id^="s3"]')
    await page.getByRole('button', { name: /Simulate/ }).click()
    await expect(page.getByText('Well-Architected!')).toBeVisible({ timeout: 45_000 })

    await page.evaluate(() => {
      ;(window as unknown as { __png?: string }).__png = undefined
      HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
        if (this.download) (window as unknown as { __png?: string }).__png = this.href
      }
    })
    await page.getByRole('button', { name: /Share card/ }).click()

    await expect
      .poll(async () => page.evaluate(() => (window as unknown as { __png?: string }).__png?.length ?? 0), {
        timeout: 25_000,
      })
      .toBeGreaterThan(10_000)
  })

  test('the scenario editor saves a custom scenario', async ({ page }) => {
    await page.getByRole('button', { name: /Choose a scenario/ }).click()
    await page.getByRole('button', { name: /New scenario/ }).click()
    await expect(page.getByRole('heading', { name: 'New scenario' })).toBeVisible()

    await page.getByPlaceholder('e.g. Black Friday at MegaMart').fill('Smoke Test Mission')
    await page.getByRole('button', { name: /^💾 Save$/ }).click()

    // Back on select, the authored scenario now has a card.
    await expect(page.getByRole('heading', { name: 'Choose your scenario' })).toBeVisible()
    await expect(page.getByText('Smoke Test Mission')).toBeVisible()
  })

  test('a malformed share code is rejected without side effects', async ({ page }) => {
    await page.getByRole('button', { name: /Choose a scenario/ }).click()
    await page.getByRole('button', { name: /New scenario/ }).click()
    await page.getByRole('button', { name: /Have a share code/ }).click()
    await page.getByPlaceholder(/Paste a share code/).fill('definitely-not-a-share-code')
    await page.getByRole('button', { name: /^Import$/ }).click()
    await expect(page.getByText(/valid share code/)).toBeVisible()
  })

  test('sandbox: tour opens, run drives live traffic, stop returns to edit', async ({ page }) => {
    await page.getByRole('button', { name: /Sandbox/ }).click()

    // First visit runs the guided tour.
    await expect(page.getByText(/^Sandbox tour · \d+\/\d+$/)).toBeVisible()
    await page.getByRole('button', { name: 'skip tutorial ✕' }).click()

    await expect(page.getByText('No budget · no scoring · endless run')).toBeVisible()
    await expect(page.getByRole('button', { name: /^▶ Run$/ })).toBeDisabled()

    await palette(page, 'Application Load Balancer').click()
    await fitView(page)
    await connect(page, '.react-flow__node[data-id="users"]', '.react-flow__node[data-id^="alb"]')

    const run = page.getByRole('button', { name: /^▶ Run$/ })
    await expect(run).toBeEnabled()
    await run.click()

    // The endless run shows the live HUD and never produces a results modal.
    await expect(page.getByRole('button', { name: /^■ Stop$/ })).toBeVisible()
    await expect(page.getByText('BASELINE')).toBeVisible()
    await page.waitForTimeout(2_000)
    await expect(page.getByText('Refine design')).toHaveCount(0)

    await page.getByRole('button', { name: /^■ Stop$/ }).click()
    await expect(page.getByRole('button', { name: /^▶ Run$/ })).toBeVisible()
  })

  test('work survives a reload via Continue', async ({ page }) => {
    await page.getByRole('button', { name: /Choose a scenario/ }).click()
    await page.getByRole('button', { name: /Launch Day/ }).click()
    await page.getByRole('button', { name: /Let's build/ }).click()
    await palette(page, 'Amazon CloudFront').click()
    await expect(node(page, 'cloudfront')).toBeVisible()

    // Autosave is throttled to ~800ms.
    await page.waitForTimeout(1_500)
    await page.reload()

    await page.getByRole('button', { name: /Continue building/ }).click()
    await expect(node(page, 'cloudfront')).toBeVisible()
  })
})
