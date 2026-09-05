import { test } from 'node:test'
import assert from 'node:assert/strict'
import { benchmark, bestResult, conditionsFor, methods, physicsTime, predictModel, solveMass, trainModel, usableFlights } from './experiments.mjs'
import { adjustedRegression, descentRegression, predictAdjustedAltitude, predictDescentTime } from './analytics.mjs'
import { seedLaunches } from './seed.mjs'
import { clampMassRange } from './massRange.mjs'

const conditions = conditionsFor(seedLaunches[0])
const close = (a, b, tolerance = 1e-7) => assert.ok(Math.abs(a - b) < tolerance, `${a} differs from ${b}`)
// Explicit synthetic fixtures for invariants; never represented as external flight data.
const fixture = Array.from({ length: 40 }, (_, i) => {
  const l = { ...seedLaunches[0], id: `fixture-${i}`, date: `2026-01-${String(i % 20 + 1).padStart(2, '0')}`, rocketMass: 480 + (i * 31 % 180), altitude: 1100 - i * 5, parachuteSize: 16 + i % 7, windSpeed: i % 11, airPressure: 29.5 + (i % 8) * .1, temperature: 60 + i % 25 }
  l.altitude = 300 + 290000 / l.rocketMass - l.windSpeed * 2
  l.descentTime = physicsTime(conditionsFor(l)) * 1.1
  l.flightTime = l.descentTime + 12
  return l
})

test('baseline wrappers reproduce unchanged original predictions', () => {
  close(predictModel(trainModel(seedLaunches, 'descent', 'baseline'), conditions), predictDescentTime(descentRegression(seedLaunches), conditions))
  close(predictModel(trainModel(seedLaunches, 'altitude', 'baseline'), conditions), predictAdjustedAltitude(adjustedRegression(seedLaunches), conditions.mass, conditions))
})
test('calibrated physics respects mass, altitude, parachute and density scaling', () => {
  const model = trainModel(fixture, 'descent', 'physics'); const prediction = predictModel(model, conditions)
  close(predictModel(model, { ...conditions, mass: conditions.mass * 4 }), prediction / 2)
  close(predictModel(model, { ...conditions, altitude: conditions.altitude * 2 }), prediction * 2)
  close(predictModel(model, { ...conditions, parachuteSize: conditions.parachuteSize * 2 }), prediction * 2)
  close(predictModel(model, { ...conditions, pressure: conditions.pressure * 4 }), prediction * 2)
})
test('invalid flights cannot poison training; incomplete recovery does not discard altitude', () => {
  const invalid = [{ ...fixture[0], rocketMass: NaN }, { ...fixture[0], airPressure: 0 }, { ...fixture[0], humidity: 101 }, { ...fixture[0], date: 'nonsense' }]
  assert.equal(usableFlights(invalid, 'descent').length, 0)
  assert.equal(usableFlights([{ ...fixture[0], descentTime: 0 }], 'altitude').length, 1)
  assert.equal(usableFlights([{ ...fixture[0], descentTime: 0 }, { ...fixture[0], descentTime: 9000 }], 'descent').length, 0)
  assert.equal(predictModel(trainModel(fixture, 'descent', 'ridge'), { ...conditions, mass: 0 }), null)
})
test('all experimental methods make finite positive predictions and leave data unchanged', () => {
  const before = JSON.stringify(fixture)
  for (const task of ['descent', 'altitude']) for (const method of methods) {
    if (task === 'descent' && method === 'linear') continue
    const model = trainModel(fixture, task, method); assert.ok(model, `${task}/${method}`)
    const value = predictModel(model, conditions); assert.ok(value > 0 && Number.isFinite(value), `${task}/${method}`)
  }
  assert.equal(JSON.stringify(fixture), before)
})
test('neural network is deterministic, data-gated and trained beyond its intercept', () => {
  assert.equal(trainModel(seedLaunches, 'descent', 'neural'), null)
  const first = trainModel(fixture, 'altitude', 'neural'); const second = trainModel(fixture, 'altitude', 'neural')
  assert.deepEqual(first, second)
  const mse = fixture.reduce((s, l) => s + (predictModel(first, conditionsFor(l)) - l.altitude) ** 2, 0)
  const constant = fixture.reduce((s, l) => s + (first.center - l.altitude) ** 2, 0)
  assert.ok(mse < constant * .8, 'training must improve on a constant prediction')
})
test('mass inversion stays in measured support and round-trips altitude', () => {
  const model = trainModel(seedLaunches, 'altitude', 'physics')
  const solution = solveMass(model, 800, conditions, [560, 602])
  assert.ok(solution.mass >= 560 && solution.mass <= 602)
  close(predictModel(model, { ...conditions, mass: solution.mass }), 800)
  assert.equal(solveMass(model, 9000, conditions, [560, 602]).mass, null)
  assert.equal(solveMass(model, 800, conditions, [560, 560]).mass, null)
  const flat = trainModel(fixture.map(l => ({ ...l, altitude: 800 })), 'altitude', 'ridge')
  assert.equal(solveMass(flat, 800, conditions, [480, 660]).mass, null)
})
test('validation keeps same-date flights out of training and fits preprocessing only on training', () => {
  const suite = benchmark(fixture, 'descent'); const result = suite.results.find(r => r.method === 'ridge')
  const dates = [...new Set(fixture.map(l => l.date))].sort(); const heldout = fixture[7]; const fold = dates.indexOf(heldout.date) % suite.folds
  const train = fixture.filter(l => dates.indexOf(l.date) % suite.folds !== fold).sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id))
  const expected = predictModel(trainModel(train, 'descent', 'ridge'), conditionsFor(heldout))
  close(result.rows.find(r => r.id === heldout.id).predicted, expected)
  const changed = fixture.map(l => dates.indexOf(l.date) % suite.folds === fold ? { ...l, descentTime: l.descentTime * 2, flightTime: l.flightTime * 3 } : l)
  close(benchmark(changed, 'descent').results.find(r => r.method === 'ridge').rows.find(r => r.id === heldout.id).predicted, expected)
})
test('metrics are computed from held-out predictions, include negative R² and mass coverage', () => {
  const suite = benchmark(seedLaunches, 'altitude')
  for (const r of suite.results.filter(r => r.tested)) {
    close(r.mae, r.rows.reduce((s, row) => s + Math.abs(row.actual - row.predicted), 0) / r.rows.length)
    assert.ok(r.massCount <= r.tested)
  }
  assert.equal(suite.results.find(r => r.method === 'neural').tested, 0)
  assert.ok(bestResult(suite))
  const noisy = fixture.map((l, i) => ({ ...l, altitude: i % 2 ? 10 : 5000 }))
  assert.ok(benchmark(noisy, 'altitude').results.some(r => r.r2 < 0))
})
test('too little data or only one launch day never yields validation confidence', () => {
  for (const data of [[], seedLaunches.slice(0, 3), seedLaunches.map(l => ({ ...l, date: '2026-01-01' }))]) {
    const suite = benchmark(data, 'descent')
    assert.equal(bestResult(suite), null)
    assert.ok(suite.results.every(r => r.error80 === null && r.mae === null))
  }
})
test('zoom handles clamp after data changes and support coincident or decimal masses', () => {
  assert.deepEqual(clampMassRange([540, 590], [560, 602]), [560, 590])
  assert.deepEqual(clampMassRange([540, 550], [560, 602]), [560, 602])
  assert.deepEqual(clampMassRange([600, 580], [560, 602]), [600, 600])
  assert.deepEqual(clampMassRange(null, [578.25, 578.25]), [578.25, 578.25])
  assert.deepEqual(clampMassRange([NaN, 580], [560, 602]), [560, 602])
})
