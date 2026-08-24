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
    'static-site': 3, 'photo-app': 3, 'migration': 2, 'flash-sale': 3,
    'ipo-day': 2, 'replatform': 3, 'order-storm': 3, 'trivia-night': 1,
  },
  bestCost: { 'static-site': 15, 'photo-app': 73, 'flash-sale': 250, 'replatform': 132, 'order-storm': 77 },
  achievements: ['first-blood', 'track:foundations', 'penny-pincher'],
  failedRuns: {},
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

await browser.close()
console.log('done')
