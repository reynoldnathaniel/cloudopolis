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

    for (const track of ['Foundations', 'Containers', 'GenAI', 'Event-Driven', 'Streaming', 'Going Global', 'My Scenarios']) {
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
