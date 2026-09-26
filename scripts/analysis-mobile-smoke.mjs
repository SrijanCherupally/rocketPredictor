/* global process, console, localStorage, document, innerWidth */
import { chromium } from '@playwright/test'
import { createServer } from 'vite'
import { readFileSync, mkdirSync } from 'node:fs'
import assert from 'node:assert/strict'

const data = process.env.TEST_FLIGHT_FILE ? JSON.parse(readFileSync(process.env.TEST_FLIGHT_FILE, 'utf8')).flights : [
  [500, 950], [525, 850], [550, 805], [550.1, 815], [553.5, 786],
].map(([rocketMass, altitude], i) => ({ id: `sample-${i}`, date: `2026-09-${String(i + 1).padStart(2, '0')}`, rocketMass, altitude, windSpeed: .5, temperature: 60, airPressure: 30, humidity: 60, flightTime: 42, descentTime: 38, parachuteSize: 18 }))
const server = await createServer({ server: { host: '127.0.0.1', port: 0 } })
await server.listen()
const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, timezoneId: 'America/Los_Angeles' })
const page = await context.newPage()
const errors = []
page.on('pageerror', e => errors.push(e.message))
mkdirSync('artifacts', { recursive: true })
const inView = async locator => {
  const box = await locator.boundingBox()
  const viewport = page.viewportSize()
  assert.ok(box && box.x >= 0 && box.y >= 0 && box.x + box.width <= viewport.width + 1 && box.y + box.height <= viewport.height + 1, `Control outside viewport: ${JSON.stringify(box)} in ${JSON.stringify(viewport)}`)
}
const navigate = async name => {
  if (page.viewportSize().width <= 760) await page.getByRole('button', { name: 'Open navigation' }).click()
  await page.getByRole('button', { name: name === 'Flights' ? /^Flights/ : name, exact: name !== 'Flights' }).click()
}
try {
  // Evening in Los Angeles is already the following UTC date.
  await page.clock.setFixedTime(new Date('2026-09-27T02:00:00Z'))
  await page.goto(server.resolvedUrls.local[0])
  await page.evaluate(flights => {
    localStorage.setItem('apexflite-launches-v1', JSON.stringify(flights))
    localStorage.setItem('apexflite-prefs-v1', JSON.stringify({ engineVersion: 'legacy-v1', units: 'imperial', targetAltitude: 800, plannerMinMass: 500, plannerMaxMass: 700 }))
  }, data)
  await page.reload(); await navigate('Analysis')
  await page.getByRole('heading', { name: 'Next flight mass' }).waitFor()
  await page.getByLabel('Recommendation launch day').fill('2026-09-26')
  const productionBefore = await page.evaluate(() => localStorage.getItem('apexflite-launches-v1'))
  if (data.some(f => f.date === '2026-09-26')) await page.locator('.next-flight').getByRole('combobox', { name: /^Flight path/ }).selectOption('strong')
  assert.equal(await page.evaluate(() => localStorage.getItem('apexflite-launches-v1')), productionBefore, 'what-if annotations must not alter saved flights')
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('apexflite-prefs-v1')).engineVersion), 'legacy-v1')
  await page.screenshot({ path: 'artifacts/analysis-desktop.png', fullPage: true })
  for (const [width, height] of [[320,568],[360,640],[375,667],[390,844],[412,915],[430,932],[844,390],[390,360],[768,1024]]) {
    await page.setViewportSize({ width, height })
    await page.waitForTimeout(200)
    if (!(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))) { console.log(await page.evaluate(() => [...document.querySelectorAll('*')].filter(e => {const b=e.getBoundingClientRect();return b.right > innerWidth + 1 && b.width > 0}).map(e => ({tag:e.tagName, class:e.className, width:e.getBoundingClientRect().width})).slice(0,20))); await page.screenshot({path:'artifacts/analysis-overflow.png',fullPage:true}) }
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `Analysis overflow at ${width}`)
    await page.getByRole('button', { name: 'Log a flight', exact: true }).click()
    const modal = page.getByRole('dialog', { name: 'Log a flight' })
    assert.equal(await modal.getByLabel('Launch date').inputValue(), '2026-09-26', 'flight date must use the local launch day, not UTC')
    await inView(modal.getByRole('button', { name: 'Close', exact: true }))
    await inView(modal.getByRole('button', { name: 'Save flight' }))
    await modal.getByRole('button', { name: 'Close', exact: true }).press('Shift+Tab')
    assert.equal(await modal.getByRole('button', { name: 'Save flight' }).evaluate(e => e === document.activeElement), true)
    await modal.getByLabel('Total flight time').fill('42')
    await modal.getByLabel('Descent time').fill('38')
    await modal.getByLabel('Observed flight path').selectOption('strong')
    await modal.getByLabel('Notes', { exact: true }).fill(`Phone ${width} × ${height}`)
    await inView(modal.getByRole('button', { name: 'Close', exact: true }))
    await inView(modal.getByRole('button', { name: 'Save flight' }))
    if (width === 390 && height === 844) await page.screenshot({ path: 'artifacts/flight-mobile.png' })
    if (height === 360) await page.screenshot({ path: 'artifacts/flight-keyboard-height.png' })
    await modal.getByRole('button', { name: 'Save flight' }).click()
    await modal.waitFor({ state: 'hidden' })
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('apexflite-launches-v1')).at(-1))
    assert.equal(saved.observedTilt, 'strong')
    await page.getByRole('button', { name: 'Log a flight', exact: true }).click()
    await modal.getByRole('button', { name: 'Close', exact: true }).click()
    await modal.waitFor({ state: 'hidden' })
    assert.equal(await page.evaluate(() => document.body.style.overflow), '')
  }
  await page.setViewportSize({ width: 390, height: 844 })
  await navigate('Flights')
  const edit = page.getByRole('button', { name: /^Edit / }).first()
  await inView(edit); await edit.click()
  const modal = page.getByRole('dialog', { name: 'Edit flight' })
  assert.equal(await modal.getByLabel('Observed flight path').inputValue(), 'strong')
  await modal.getByLabel('Observed flight path').selectOption('')
  await modal.getByRole('button', { name: 'Update flight' }).click()
  await modal.waitFor({ state: 'hidden' })
  await page.reload(); await navigate('Flights'); await page.getByRole('button', { name: /^Edit / }).first().click()
  assert.equal(await modal.getByLabel('Observed flight path').inputValue(), '')
  await modal.press('Escape'); await modal.waitFor({ state: 'hidden' })
  await navigate('Settings'); await page.getByRole('button', { name: /Metric/ }).click()
  await navigate('Analysis')
  await page.getByLabel('Recommendation launch day').fill('2026-09-27')
  await page.getByLabel('Next flight wind').fill('0.8')
  await page.evaluate(() => { localStorage.setItem('apexflite-theme-v1', 'dark') })
  await page.reload()
  await page.screenshot({ path: 'artifacts/analysis-mobile-dark.png', fullPage: true })
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
  assert.deepEqual(errors, [])
  console.log('Analysis and mobile checks passed: 9 viewports, pinned Close/Save, save/edit/reload, optional tilt, what-if isolation, metric/dark mode, focus trap, escape, no runtime errors.')
} finally { await browser.close(); await server.close() }
