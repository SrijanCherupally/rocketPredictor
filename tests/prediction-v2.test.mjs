import { test } from 'node:test'
import assert from 'node:assert/strict'
import { predictionEngineV2 } from './predictionV2.mjs'
import { seedLaunches } from './seed.mjs'
import { legacyEngine } from './legacyEngine.mjs'

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

test('v2 selects a weather model when held-out weather signal is strong', () => {
  const flights = Array.from({ length: 24 }, (_, index) => {
    const mass = 500 + (index * 19 % 160)
    const windSpeed = index % 8
    const airPressure = 29.5 + (index % 5) * .12
    const humidity = 30 + (index * 7 % 55)
    const temperature = 50 + (index * 9 % 35)
    return {
      ...seedLaunches[0], id: `weather-${index}`, date: `2026-04-${String(Math.floor(index / 3) + 1).padStart(2, '0')}`,
      rocketMass: mass, windSpeed, airPressure, humidity, temperature,
      altitude: 1320 - .72 * mass - 8 * windSpeed + 18 * (airPressure - 29.8) - .4 * humidity + .7 * temperature,
    }
  })
  const calm = predictionEngineV2.recommend(flights, 900, { ...conditions, wind: 1, temperature: 55, humidity: 35 })
  const windy = predictionEngineV2.recommend(flights, 900, { ...conditions, wind: 7, temperature: 85, humidity: 80 })
  assert.equal(calm.status, 'ready')
  assert.equal(windy.status, 'ready')
  assert.notEqual(calm.method, 'monotonic-baseline')
  assert.notEqual(windy.method, 'monotonic-baseline')
  assert.ok(Math.abs(calm.recommendedMass - windy.recommendedMass) > 1)
})

test('legacy adapter ignores new record metadata without changing measurements', () => {
  const record = { ...seedLaunches[0], schemaVersion: 2, version: 9, createdAt: '2026-01-01T00:00:00Z', futureField: 'ignored' }
  const [legacy] = legacyEngine.toLegacyLaunches([record])
  assert.deepEqual(legacy, seedLaunches[0])
  assert.equal('futureField' in legacy, false)
  assert.equal('version' in legacy, false)
})
