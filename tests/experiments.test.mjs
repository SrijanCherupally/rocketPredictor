import { test } from 'node:test'
import assert from 'node:assert/strict'
import { benchmark, bestResult, conditionsFor, methods, physicsTime, predictModel, solveMass, trainModel, usableFlights, massWeatherEffect, usesWeather } from './experiments.mjs'
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
test('small-data neural network is deterministic and learns beyond its physical prior', () => {
  assert.equal(trainModel(seedLaunches.slice(0, 3), 'descent', 'neural'), null)
  assert.ok(trainModel(seedLaunches.slice(0, 4), 'descent', 'neural'))
  const first = trainModel(fixture, 'altitude', 'neural'); const second = trainModel(fixture, 'altitude', 'neural')
  assert.deepEqual(first, second)
  const mse = fixture.reduce((s, l) => s + (predictModel(first, conditionsFor(l)) - l.altitude) ** 2, 0)
  const prior = fixture.reduce((s, l) => s + (predictModel(first.base, conditionsFor(l)) - l.altitude) ** 2, 0)
  assert.ok(mse < prior, 'backpropagation must improve on the physical prior')
  assert.equal(first.hidden.length, 3)
  close(predictModel(JSON.parse(JSON.stringify(first)), conditions), predictModel(first, conditions))
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
  assert.equal(suite.results.find(r => r.method === 'neural').tested, 8)
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

// Measurements from the reported eight-flight failure; IDs/notes removed.
const reportedFlights = [
  ['2026-08-18', 946, 44, 44, 482.9, 0, 30.12, 87, 57],
  ['2026-08-18', 967, 44, 44, 483.5, 0, 30.12, 87, 57],
  ['2026-08-27', 826, 39, 39, 535, 1, 30, 78, 63],
  ['2026-08-27', 787, 35, 35, 543.3, 3, 30, 78, 63],
  ['2026-09-01', 825, 39, 39, 541.3, 0, 30.13, 94, 60],
  ['2026-09-01', 793, 38.7, 38.7, 551, .5, 30.13, 92, 57],
  ['2026-09-01', 801, 36.5, 36.3, 549.4, 3, 30.13, 92, 58],
  ['2026-09-01', 785, 35, 35, 548.1, 5, 30.13, 90, 62],
].map(([date, altitude, flightTime, descentTime, rocketMass, windSpeed, airPressure, humidity, temperature], i) => ({ id: `reported-${i}`, date, altitude, flightTime, descentTime, rocketMass, windSpeed, airPressure, humidity, temperature, parachuteSize: 18 }))

test('reproduces reported 449.1 error and explains training-versus-unseen-day gap', () => {
  const suite = benchmark(reportedFlights, 'altitude'); const baseline = suite.results.find(r => r.method === 'baseline')
  assert.equal(suite.folds, 3)
  assert.equal(baseline.mae.toFixed(1), '449.1')
  assert.equal(baseline.rmse.toFixed(1), '565.5')
  assert.equal(baseline.r2.toFixed(2), '-67.51')
  assert.equal(baseline.trainingMae.toFixed(2), '6.23')
  assert.equal(baseline.massMae.toFixed(1), '28.2')
  assert.equal(baseline.massCount, 2)
  assert.equal(baseline.tested, 8)
  close(baseline.trainingMae, adjustedRegression(reportedFlights).mae, 1e-6)
  assert.deepEqual(baseline.validationFolds.map(f => f.trainingCount), [6, 6, 4])
  const september = baseline.rows.filter(r => r.date === '2026-09-01')
  assert.ok(september.every(r => r.trainingCount === 4 && r.predicted > 1200 && r.actual < 830))
  close(baseline.massMae, baseline.rows.filter(r => r.massError !== null).reduce((sum, r) => sum + r.massError, 0) / 2)
})

test('weather-aware mass changes with inputs; mass-only variants explicitly do not', () => {
  for (const method of ['baseline', 'ridge']) {
    const model = trainModel(seedLaunches, 'altitude', method)
    const before = solveMass(model, 800, { ...conditions, wind: 4 }, [560, 602])
    const after = solveMass(model, 800, { ...conditions, wind: 5 }, [560, 602])
    assert.notEqual(before.mass, null); assert.notEqual(after.mass, null)
    assert.ok(Math.abs(before.mass - after.mass) > .01)
    assert.equal(usesWeather(method, 'altitude'), true)
    close(massWeatherEffect(model, seedLaunches, 800, { ...conditions, wind: 5 }).delta - massWeatherEffect(model, seedLaunches, 800, { ...conditions, wind: 4 }).delta, after.mass - before.mass)
  }
  for (const method of ['physics', 'linear']) {
    const model = trainModel(seedLaunches, 'altitude', method)
    close(solveMass(model, 800, { ...conditions, wind: 0 }, [560, 602]).mass, solveMass(model, 800, { ...conditions, wind: 10 }, [560, 602]).mass)
    assert.equal(usesWeather(method, 'altitude'), false)
  }
})

test('nonphysical finite forecasts count in validation instead of being hidden', () => {
  const model = trainModel(seedLaunches, 'altitude', 'baseline')
  model.legacy = { ...model.legacy, intercept: -100, coefficients: [0, 0, 0, 0, 0] }
  assert.equal(predictModel(model, conditions), null)
  assert.equal(predictModel(model, conditions, 'validation'), -100)
  // A deliberately extreme held-out mass makes the sparse original model fail.
  const extreme = reportedFlights.map((l, i) => i === 0 ? { ...l, rocketMass: 10000 } : l)
  const result = benchmark(extreme, 'altitude').results.find(r => r.method === 'baseline')
  assert.equal(result.tested, 8)
  assert.ok(result.rows.some(r => r.predicted < 0))
  close(result.mae, result.rows.reduce((sum, row) => sum + Math.abs(row.actual - row.predicted), 0) / 8)
})

test('eight real flights train and validate both neural models on every held-out date', () => {
  for (const task of ['altitude', 'descent']) {
    const result = benchmark(reportedFlights, task).results.find(r => r.method === 'neural')
    assert.equal(result.model.sampleSize, 8)
    assert.equal(result.tested, 8)
    assert.deepEqual(result.validationFolds.map(f => f.trainingCount), [6, 6, 4])
    assert.ok(result.rows.every(r => Number.isFinite(r.predicted) && r.predicted > 0))
    if (task === 'altitude') {
      assert.ok(result.massCount > 0)
      const c = { ...conditionsFor(reportedFlights[4]), wind: 1.5, pressure: 30.125, humidity: 89, temperature: 60 }
      assert.ok(solveMass(result.model, 800, c, [482.9, 551]).mass !== null)
    }
  }
})

test('neural physical priors, scales and weights exclude the held-out launch day', () => {
  const changed = reportedFlights.map(l => l.date === '2026-09-01' ? { ...l, altitude: l.altitude * 2, descentTime: l.descentTime * 2, flightTime: l.flightTime * 2 } : l)
  for (const task of ['altitude', 'descent']) {
    const originalRows = benchmark(reportedFlights, task).results.find(r => r.method === 'neural').rows.filter(r => r.date === '2026-09-01')
    const changedRows = benchmark(changed, task).results.find(r => r.method === 'neural').rows.filter(r => r.date === '2026-09-01')
    originalRows.forEach((row, i) => close(changedRows[i].predicted, row.predicted * (task === 'descent' ? 2 : 1)))
  }
})

test('neural corrections are bounded, mass is monotonic, constant weather does not invent a learned effect', () => {
  const model = trainModel(reportedFlights, 'altitude', 'neural')
  const c = conditionsFor(reportedFlights[4])
  const stressed = { ...c, wind: 100, temperature: 150, pressure: 20, humidity: 0 }
  const ratio = predictModel(model, stressed) / predictModel(model.base, stressed)
  assert.ok(ratio >= Math.exp(-.2) && ratio <= Math.exp(.2))
  assert.ok(predictModel(model, { ...c, mass: 490 }) > predictModel(model, { ...c, mass: 540 }))
  const sameWeather = reportedFlights.map(l => ({ ...l, windSpeed: 3, airPressure: 30, humidity: 80, temperature: 60 }))
  const constant = trainModel(sameWeather, 'altitude', 'neural')
  close(predictModel(constant, c), predictModel(constant, stressed))
})
