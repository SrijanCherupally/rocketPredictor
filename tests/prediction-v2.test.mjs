import { test } from 'node:test'
import assert from 'node:assert/strict'
import { predictionEngineV2 } from './predictionV2.mjs'
import { seedLaunches } from './seed.mjs'

const conditions = { mass: 578, altitude: 800, parachuteSize: 18, wind: 4, pressure: 29.92, humidity: 50, temperature: 70 }

test('v2 requires varied mass before making a recommendation', () => {
  assert.equal(predictionEngineV2.recommend([], 800, conditions).status, 'needs-data')
  assert.equal(predictionEngineV2.recommend(seedLaunches.map(flight => ({ ...flight, rocketMass: 578 })), 800, conditions).status, 'needs-data')
})

test('v2 recommendation is finite, supported, and round-trips target altitude', () => {
  const result = predictionEngineV2.recommend(seedLaunches, 800, conditions)
  assert.equal(result.engineVersion, 'current-v2')
  assert.equal(result.status, 'ready')
  assert.ok(Number.isFinite(result.recommendedMass))
  assert.ok(result.recommendedMass >= result.observedMassRange[0])
  assert.ok(result.recommendedMass <= result.observedMassRange[1])
  assert.ok(Math.abs(result.expectedAltitude - 800) < .001)
})

test('v2 never extrapolates to an unreachable target', () => {
  const result = predictionEngineV2.recommend(seedLaunches, 9000, conditions)
  assert.equal(result.status, 'unsupported')
})

test('v2 learned models require eight flights across three launch days', () => {
  const result = predictionEngineV2.recommend(seedLaunches.slice(0, 7), 800, conditions)
  assert.ok(result.warnings.some(warning => warning.includes('eight flights')))
  if (result.status === 'ready') assert.equal(result.method, 'monotonic-baseline')
})

test('v2 honors configured mass limits', () => {
  const result = predictionEngineV2.recommend(seedLaunches, 800, conditions, [575, 590])
  if (result.status === 'ready') assert.ok(result.recommendedMass >= 575 && result.recommendedMass <= 590)
  else assert.equal(result.status, 'unsupported')
})
