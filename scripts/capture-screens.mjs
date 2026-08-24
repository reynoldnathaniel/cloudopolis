// Regenerate the README screenshots against the production build.
//
//   npm run build && npx vite preview --port 4173 &   (or reuse the e2e server)
//   node scripts/capture-screens.mjs
//
// Deterministic on purpose: the same seeded profile, the same level, the same
// moments. After a UI change, rerun it and the README pictures match reality.

import { chromium } from '@playwright/test'

const BASE = 'http://localhost:4173'
const OUT = 'docs/screens'

// A profile that makes the scenario map look lived-in: a mix of records, not
// a fresh install and not a completed game.
const PROFILE = {
  tutorialDone: true,
  sandboxTutorialDone: true,
  briefingSeen: ['static-site', 'photo-app', 'migration', 'flash-sale', 'ipo-day', 'replatform', 'order-storm'],
  bestStars: {
    'static-site': 3, 'photo-app': 3, 'migration': 2,
    'ipo-day': 2, 'replatform': 3, 'order-storm': 3, 'trivia-night': 1,
  },
  bestCost: { 'static-site': 15, 'photo-app': 73, 'replatform': 132, 'order-storm': 77 },
  achievements: ['first-blood', 'track:foundations', 'penny-pincher', 'nailed-it', 'minimalist', 'redemption'],
  failedRuns: { 'flash-sale': 2 },
  scenarioId: 'static-site',
}

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 860 }, deviceScaleFactor: 2 })

const shoot = async (name) => {
  await page.waitForTimeout(700) // let framer-motion springs settle
  await page.screenshot({ path: `${OUT}/${name}.png` })
  console.log(`captured ${name}`)
}

await page.goto(BASE)
await page.evaluate((profile) => {
  localStorage.setItem('simcloud-save-v1', JSON.stringify(profile))
}, PROFILE)
await page.goto(BASE)

// 1. The scenario map, with stars and personal bests on the cards.
await page.getByRole('button', { name: /Choose a scenario/ }).click()
await page.getByRole('heading', { name: 'Choose your scenario' }).waitFor()
await shoot('scenario-select')

// 2. The mission briefing — The Shakedown's is the most dramatic brief.
await page.getByRole('button', { name: /The Shakedown/ }).click()
await page.getByRole('heading', { level: 2, name: 'The Shakedown' }).waitFor()
await shoot('briefing')

// Build the reference answer: Users -> WAF -> ALB -> Fargate -> DynamoDB.
await page.getByRole('button', { name: /Let's build/ }).click()
for (const svc of ['AWS WAF', 'Application Load Balancer', 'Amazon ECS on AWS Fargate', 'Amazon DynamoDB']) {
  await page.locator(`button[title^="${svc}"]`).click()
}
await page.locator('.react-flow__controls-fitview').click()
await page.waitForTimeout(700)

const connect = async (from, to) => {
  const src = page.locator(`.react-flow__node[data-id${from === 'users' ? '="users"' : `^="${from}"`}] .react-flow__handle-right`).first()
  const tgt = page.locator(`.react-flow__node[data-id^="${to}"] .react-flow__handle-left`).first()
  const a = await src.boundingBox()
  const b = await tgt.boundingBox()
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2)
  await page.mouse.down()
  await page.mouse.move(a.x + a.width / 2 + 10, a.y + a.height / 2 + 10)
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 20 })
  await page.mouse.up()
}
await connect('users', 'waf')
await connect('waf', 'alb')
await connect('alb', 'fargate')
await connect('fargate', 'dynamodb')

await page.getByRole('button', { name: /Simulate/ }).click()

// The first incident (a capacity offer) interrupts the spike — answer it,
// then catch the canvas clean while the botnet is still firing.
await page.getByText(/INCIDENT/i).waitFor({ timeout: 30_000 })
await page.getByRole('button', { name: /Hold/i }).click()

// 3. The pager: the ransom note is the dramatic one.
await page.getByText(/INCIDENT/i).waitFor({ timeout: 30_000 })
await shoot('incident')
await page.getByRole('button', { name: /Do not pay/i }).click()

// 4. Mid-attack, both incidents answered: junk on the HUD, WAF scrubbing.
await page.waitForTimeout(900)
await shoot('under-attack')

// 5. Three stars, the pillars, the run timeline, par.
await page.getByText('Well-Architected!').waitFor({ timeout: 60_000 })
await shoot('results')

// 6. The achievements gallery, part-filled — a fresh profile would be a wall
// of locks, a complete one a wall of gold; neither says "progress".
await page.goto(BASE)
await page.getByRole('button', { name: /Choose a scenario/ }).click()
await page.getByRole('button', { name: /🏆 \d+ \/ \d+/ }).click()
await page.getByText(/Achievements/i).first().waitFor()
await shoot('achievements')

// FlashSale, via the reveal: the reference design is Multi-AZ everything,
// which makes it the one canvas worth photographing during an AZ outage.
await page.goto(BASE)
await page.getByRole('button', { name: /Choose a scenario/ }).click()
await page.getByRole('button', { name: /FlashSale/ }).click()
await page.getByRole('button', { name: /Reveal a 3-star answer/ }).click()
await page.getByRole('button', { name: 'Show me' }).click()
await page.getByRole('button', { name: /Run the reference design/ }).click()

// 7. Mid-outage: one Availability Zone dark, the survivor carrying the sale.
// Regex, not string: string matching is case-insensitive, and the sidebar's
// "AZ outage" chip is on screen from tick one. Only the HUD shouts it.
await page.getByText(/AZ OUTAGE/).waitFor({ timeout: 60_000 })
await page.waitForTimeout(1000)
await shoot('outage')

// 8. The expanded run timeline, phase bands and all.
await page.getByText('Well-Architected!').waitFor({ timeout: 60_000 })
await page.getByRole('button', { name: /bigger/ }).click()
await page.getByText(/Run timeline — FlashSale/).waitFor()
await shoot('timeline')
await page.keyboard.press('Escape')

// 9. The scenario editor, blank and ready.
await page.goto(BASE)
await page.getByRole('button', { name: /Choose a scenario/ }).click()
await page.getByRole('button', { name: /New scenario/ }).click()
await page.getByRole('heading', { name: 'New scenario' }).waitFor()
await shoot('editor')

// 10. The sandbox: a two-instance fleet meeting a 2,000 rps dial.
await page.goto(BASE)
await page.getByRole('button', { name: /Sandbox/ }).click()
await page.locator('button[title^="Application Load Balancer"]').click()
await page.locator('button[title^="Amazon EC2 (virtual server)"]').click()
await page.locator('button[title^="Amazon EC2 (virtual server)"]').click()
await page.locator('.react-flow__controls-fitview').click()
await page.waitForTimeout(700)
await connect('users', 'alb')
await connect('alb', 'ec2')
{
  // Two EC2s, one per AZ — wire the ALB to the second one as well.
  const second = page.locator('.react-flow__node[data-id^="ec2"]').nth(1)
  const src = page.locator('.react-flow__node[data-id^="alb"] .react-flow__handle-right').first()
  const a = await src.boundingBox()
  const b = await second.locator('.react-flow__handle-left').boundingBox()
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2)
  await page.mouse.down()
  await page.mouse.move(a.x + a.width / 2 + 10, a.y + a.height / 2 + 10)
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 20 })
  await page.mouse.up()
}
await page.getByRole('button', { name: /^▶ Run$/ }).click()
await page.getByText('BASELINE').waitFor()
await page.getByRole('button', { name: '2k' }).click()
await page.waitForTimeout(2200)
await shoot('sandbox')

await browser.close()
console.log('done')
