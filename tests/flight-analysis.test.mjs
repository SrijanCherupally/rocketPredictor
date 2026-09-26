import { test } from 'node:test'
import assert from 'node:assert/strict'
import { recommendNextFlight, compareFlights } from './dayRecommendation.mjs'
import { correlation, flightInsights } from './flightInsights.mjs'
import { predictionEngineV2 } from './predictionV2.mjs'
import { analysisEngine } from './analysisEngine.mjs'
import { rowToLaunch, createLaunch, updateLaunch } from './cloud.mjs'

const flight = (id, mass, altitude, date = '2026-09-01', extra = {}) => ({ id, rocketMass: mass, altitude, date, windSpeed: 1, airPressure: 30, temperature: 60, humidity: 60, parachuteSize: 18, descentTime: 38, flightTime: 42, ...extra })
const history = [500, 520, 540, 560].map((m, i) => flight(`h${i}`, m, -200 + 550000 / m, `2026-09-0${i + 1}`))
const recommend = (flights, date = '2026-09-26', wind = 1) => recommendNextFlight(flights, date, 800, wind, [500, 560])

test('starting mass uses all prior data, asks for three repeats and ignores future dates', () => {
  const result = recommend(history)
  assert.equal(result.status, 'ready'); assert.ok(Math.abs(result.mass - 550) < 1e-8)
  assert.equal(result.repeatsRemaining, 3)
  assert.deepEqual(recommend([...history, flight('future', 550, 1400, '2026-10-01')]), result)
})
test('same-day offset gains influence; tilted flights are downweighted and trigger repeat', () => {
  const straight = recommend([...history, flight('today', 550, 780, '2026-09-26', { observedTilt: 'straight' })])
  const tilted = recommend([...history, flight('today', 550, 780, '2026-09-26', { observedTilt: 'strong' })])
  assert.equal(straight.status, 'ready'); assert.equal(tilted.status, 'ready')
  assert.ok(tilted.dayShare < straight.dayShare); assert.ok(tilted.desired > straight.desired)
  assert.equal(tilted.mass, 550); assert.equal(tilted.repeat, true)
  const repeats = recommend([...history, ...[0, 1, 2].map(i => flight(`today${i}`, 550, 780, '2026-09-26', { observedTilt: 'straight' }))])
  assert.ok(repeats.dayShare > .5); assert.equal(repeats.repeat, false)
  assert.ok(Math.abs(repeats.mass - 550) <= 3); assert.ok(repeats.mass < 550)
})
test('direct interpolation requires straight, comparable same-day endpoints bracketing target', () => {
  const a = flight('a', 540, 820, '2026-09-26', { observedTilt: 'straight' })
  const b = flight('b', 560, 780, '2026-09-26', { observedTilt: 'straight' })
  const result = recommend([...history, a, b])
  assert.ok(result.bracket); assert.equal(result.desired, 550)
  assert.equal(result.mass, 557); assert.equal(result.expected, 786)
  assert.equal(recommend([...history, a, { ...b, observedTilt: 'strong' }]).bracket, null)
  assert.equal(recommend([...history, a, { ...b, windSpeed: 5 }]).bracket, null)
  const tiltedAfterBracket = recommend([...history, a, b, flight('tilted', 550, 780, '2026-09-26', { observedTilt: 'strong' })])
  assert.equal(tiltedAfterBracket.repeat, true)
  assert.equal(tiltedAfterBracket.mass, 550)
})
test('same-day recency follows creation time, not random identifiers', () => {
  const early = flight('zzz', 550, 810, '2026-09-26', { createdAt: '2026-09-26T10:00:00Z' })
  const late = flight('aaa', 553, 780, '2026-09-26', { createdAt: '2026-09-26T11:00:00Z' })
  assert.equal(recommend([...history, late, early]).latest.id, 'aaa')
})
test('unsupported targets, empty logs and constant masses produce no fabricated recommendation', () => {
  assert.equal(recommend([]).status, 'needs-data')
  assert.equal(recommend(history.map(f => ({ ...f, rocketMass: 550 }))).status, 'needs-data')
  assert.equal(recommendNextFlight(history, '2026-09-26', 5000, 1, [500, 560]).status, 'unsupported')
})
test('flight comparison separates mass change from unexplained variation', () => {
  const a = flight('a', 550, 815), b = flight('b', 553.5, 786)
  const result = compareFlights([...history, a, b], a, b)
  assert.equal(result.observed, -29)
  assert.ok(result.massExpected < -6 && result.massExpected > -7)
  assert.ok(Math.abs(result.unexplained - (-29 - result.massExpected)) < 1e-8)
})
test('mass-adjusted correlations do not turn pure mass confounding into wind evidence', () => {
  const data = flightInsights(history.map((f, i) => ({ ...f, windSpeed: i })))
  assert.ok(Math.abs(data.factors[0].raw) > .9)
  assert.equal(data.factors[0].adjusted, null)
  assert.equal(correlation([1, 1, 1], [1, 2, 3]), null)
})
test('tilt annotations and analysis experiments never change production predictions', () => {
  const conditions = { mass: 550, altitude: 800, parachuteSize: 18, wind: 1, pressure: 30, humidity: 60, temperature: 60 }
  const before = predictionEngineV2.recommend(history, 800, conditions)
  const annotated = history.map(f => ({ ...f, observedTilt: 'strong' }))
  analysisEngine.recommend(annotated, 800, conditions)
  recommend(annotated)
  assert.deepEqual(predictionEngineV2.recommend(annotated, 800, conditions), before)
})
test('cloud mapping persists and clears observations without conflating missing with straight', async () => {
  assert.equal(rowToLaunch({ launch_id: 'old', notes: '' }).observedTilt, null)
  let payload
  const response = { data: { launch_id: 'new', observed_tilt: 'strong', created_at: '2026-09-26T10:00:00Z' }, error: null }
  const chain = { select: () => chain, eq: () => chain, single: async () => response, maybeSingle: async () => response }
  const client = { from: () => ({ insert: row => { payload = row; return chain }, update: row => { payload = row; return chain } }) }
  await createLaunch(client, 'user', { ...history[0], observedTilt: 'strong' })
  assert.equal(payload.observed_tilt, 'strong')
  await updateLaunch(client, 'user', { ...history[0], observedTilt: null }, 1)
  assert.equal(payload.observed_tilt, null)
})
