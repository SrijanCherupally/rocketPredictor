import type { DescentConditions, Launch } from './analytics'
import type { PredictionEngineV2, PredictionMethodV2, PredictionMetrics } from './predictionTypes'

type Candidate = {
  method: PredictionMethodV2
  label: string
  features: string[]
  complexity: number
  predict: (conditions: DescentConditions) => number
}

const EPSILON = 1e-9
const labels: Record<PredictionMethodV2, string> = {
  'monotonic-baseline': 'Monotonic mass baseline',
  'weather-ridge': 'Weather-aware regression',
  'physics-hybrid': 'Physics-informed weather model',
  'nearest-flights': 'Nearest comparable flights',
  'bounded-neural': 'Bounded weather network',
}
const weatherFeatures = ['mass', 'wind', 'pressure', 'humidity', 'temperature']

const valid = (flight: Launch) => [flight.altitude, flight.rocketMass, flight.windSpeed, flight.airPressure, flight.humidity, flight.temperature].every(Number.isFinite)
  && flight.altitude > 0 && flight.rocketMass > 0 && flight.windSpeed >= 0 && flight.airPressure > 0 && flight.humidity >= 0 && flight.humidity <= 100
  && /^\d{4}-\d{2}-\d{2}$/.test(flight.date)
const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / Math.max(values.length, 1)
const quantile = (values: number[], q: number) => {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * q))]
}
const valuesFor = (flight: Launch) => [flight.rocketMass, flight.windSpeed, flight.airPressure, flight.humidity, flight.temperature]
const valuesForConditions = (conditions: DescentConditions) => [conditions.mass, conditions.wind, conditions.pressure, conditions.humidity, conditions.temperature]

// Modified Gram-Schmidt on an augmented ridge system avoids the unstable
// normal-equation inversion used by Legacy v1.
function ridgeQr(rows: number[][], targets: number[], penalty: number) {
  if (!rows.length) return null
  const columns = rows[0].length + 1
  const augmentedRows = rows.map(row => [1, ...row])
  const augmentedTargets = [...targets]
  for (let column = 1; column < columns; column += 1) {
    augmentedRows.push(Array.from({ length: columns }, (_, index) => index === column ? Math.sqrt(penalty) : 0))
    augmentedTargets.push(0)
  }
  const qColumns: number[][] = []
  const r = Array.from({ length: columns }, () => Array(columns).fill(0))
  for (let column = 0; column < columns; column += 1) {
    const vector = augmentedRows.map(row => row[column])
    for (let previous = 0; previous < column; previous += 1) {
      r[previous][column] = qColumns[previous].reduce((sum, value, index) => sum + value * vector[index], 0)
      for (let index = 0; index < vector.length; index += 1) vector[index] -= r[previous][column] * qColumns[previous][index]
    }
    r[column][column] = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0))
    if (r[column][column] < EPSILON) return null
    qColumns.push(vector.map(value => value / r[column][column]))
  }
  const qty = qColumns.map(column => column.reduce((sum, value, index) => sum + value * augmentedTargets[index], 0))
  const coefficients = Array(columns).fill(0)
  for (let row = columns - 1; row >= 0; row -= 1) {
    coefficients[row] = (qty[row] - r[row].slice(row + 1).reduce((sum, value, index) => sum + value * coefficients[row + 1 + index], 0)) / r[row][row]
  }
  return coefficients
}

function scalesFor(flights: Launch[]) {
  const columns = weatherFeatures.map((_, index) => flights.map(flight => valuesFor(flight)[index]))
  const centers = columns.map(mean)
  const scales = columns.map((column, index) => Math.max(Math.sqrt(mean(column.map(value => (value - centers[index]) ** 2))), [5, 1, .05, 5, 5][index]))
  return { centers, scales }
}

function standardizedCandidate(flights: Launch[], method: PredictionMethodV2, penalty: number, physicsPrior = false): Candidate | null {
  const { centers, scales } = scalesFor(flights)
  const rows = flights.map(flight => valuesFor(flight).map((value, index) => (value - centers[index]) / scales[index]))
  const inverseFit = physicsPrior ? fitInverseMass(flights) : null
  const targets = flights.map(flight => flight.altitude - (inverseFit ? inverseFit.predict({ mass: flight.rocketMass } as DescentConditions) : 0))
  const coefficients = ridgeQr(rows, targets, penalty)
  if (!coefficients) return null
  return {
    method,
    label: labels[method],
    features: weatherFeatures,
    complexity: physicsPrior ? 3 : 4,
    predict: conditions => {
      const row = valuesForConditions(conditions).map((value, index) => (value - centers[index]) / scales[index])
      const correction = coefficients[0] + row.reduce((sum, value, index) => sum + value * coefficients[index + 1], 0)
      return (inverseFit ? inverseFit.predict(conditions) : 0) + correction
    },
  }
}

function fitInverseMass(flights: Launch[]): Candidate | null {
  if (flights.length < 3) return null
  const x = flights.map(flight => 1 / flight.rocketMass)
  const y = flights.map(flight => flight.altitude)
  const mx = mean(x); const my = mean(y)
  const variance = x.reduce((sum, value) => sum + (value - mx) ** 2, 0)
  if (variance < EPSILON) return null
  const slope = x.reduce((sum, value, index) => sum + (value - mx) * (y[index] - my), 0) / variance
  if (slope <= 0) return null
  const intercept = my - slope * mx
  return { method: 'monotonic-baseline', label: labels['monotonic-baseline'], features: ['mass'], complexity: 1, predict: conditions => intercept + slope / conditions.mass }
}

function nearestCandidate(flights: Launch[]): Candidate | null {
  if (flights.length < 8) return null
  const { scales } = scalesFor(flights)
  return { method: 'nearest-flights', label: labels['nearest-flights'], features: weatherFeatures, complexity: 5, predict: conditions => {
    const input = valuesForConditions(conditions)
    const neighbors = flights.map(flight => ({ flight, distance: Math.sqrt(valuesFor(flight).reduce((sum, value, index) => sum + ((value - input[index]) / scales[index]) ** 2, 0)) })).sort((a, b) => a.distance - b.distance).slice(0, 5)
    const weighted = neighbors.map(item => ({ value: item.flight.altitude, weight: 1 / Math.max(item.distance, .05) ** 2 }))
    return weighted.reduce((sum, item) => sum + item.value * item.weight, 0) / weighted.reduce((sum, item) => sum + item.weight, 0)
  } }
}

function boundedNeuralCandidate(flights: Launch[]): Candidate | null {
  const base = standardizedCandidate(flights, 'weather-ridge', .15, true)
  if (!base || flights.length < 12) return null
  const { centers, scales } = scalesFor(flights)
  const hiddenWeights = [
    [0, -.45, .22, -.18, .31],
    [0, .28, -.34, .25, -.21],
    [0, -.19, .27, .36, -.29],
  ]
  const hidden = flights.map(flight => {
    const row = valuesFor(flight).map((value, index) => (value - centers[index]) / scales[index])
    return hiddenWeights.map(weights => Math.tanh(row.reduce((sum, value, index) => sum + value * weights[index], 0)))
  })
  const residuals = flights.map(flight => flight.altitude - base.predict({ mass: flight.rocketMass, wind: flight.windSpeed, pressure: flight.airPressure, humidity: flight.humidity, temperature: flight.temperature, altitude: flight.altitude, parachuteSize: flight.parachuteSize } as DescentConditions))
  const output = ridgeQr(hidden, residuals, .5)
  if (!output) return null
  return { method: 'bounded-neural', label: labels['bounded-neural'], features: weatherFeatures, complexity: 6, predict: conditions => {
    const row = valuesForConditions(conditions).map((value, index) => (value - centers[index]) / scales[index])
    const activations = hiddenWeights.map(weights => Math.tanh(row.reduce((sum, value, index) => sum + value * weights[index], 0)))
    const correction = output[0] + activations.reduce((sum, value, index) => sum + value * output[index + 1], 0)
    return base.predict(conditions) + Math.max(-120, Math.min(120, correction))
  } }
}

function candidatesFor(flights: Launch[]) {
  return [fitInverseMass(flights), standardizedCandidate(flights, 'weather-ridge', .2), standardizedCandidate(flights, 'physics-hybrid', .25, true), nearestCandidate(flights), boundedNeuralCandidate(flights)].filter((candidate): candidate is Candidate => candidate !== null)
}

function isMonotonic(candidate: Candidate, conditions: DescentConditions, range: [number, number]) {
  let previous = Infinity
  for (let index = 0; index <= 32; index += 1) {
    const mass = range[0] + (range[1] - range[0]) * index / 32
    const value = candidate.predict({ ...conditions, mass })
    if (!Number.isFinite(value) || value > previous + 1e-6) return false
    previous = value
  }
  return true
}

function solveMass(candidate: Candidate, target: number, conditions: DescentConditions, range: [number, number]) {
  if (!isMonotonic(candidate, conditions, range)) return null
  const atLow = candidate.predict({ ...conditions, mass: range[0] })
  const atHigh = candidate.predict({ ...conditions, mass: range[1] })
  if (target > atLow || target < atHigh) return null
  let low = range[0]; let high = range[1]
  for (let iteration = 0; iteration < 60; iteration += 1) {
    const midpoint = (low + high) / 2
    if (candidate.predict({ ...conditions, mass: midpoint }) > target) low = midpoint
    else high = midpoint
  }
  return (low + high) / 2
}

function validate(flights: Launch[], method: PredictionMethodV2) {
  const days = [...new Set(flights.map(flight => flight.date))]
  const rows: Array<{ actual: number; predicted: number; massSolved: boolean }> = []
  for (const day of days) {
    const train = flights.filter(flight => flight.date !== day)
    const test = flights.filter(flight => flight.date === day)
    const candidate = candidatesFor(train).find(item => item.method === method)
    if (!candidate) continue
    const range: [number, number] = [Math.min(...train.map(flight => flight.rocketMass)), Math.max(...train.map(flight => flight.rocketMass))]
    for (const flight of test) {
      const conditions = { mass: flight.rocketMass, altitude: flight.altitude, parachuteSize: flight.parachuteSize, wind: flight.windSpeed, pressure: flight.airPressure, humidity: flight.humidity, temperature: flight.temperature }
      const predicted = candidate.predict(conditions)
      if (Number.isFinite(predicted)) rows.push({ actual: flight.altitude, predicted, massSolved: solveMass(candidate, flight.altitude, conditions, range) !== null })
    }
  }
  if (!rows.length) return null
  const errors = rows.map(row => row.predicted - row.actual)
  const actualMean = mean(rows.map(row => row.actual))
  const residual = errors.reduce((sum, error) => sum + error ** 2, 0)
  const total = rows.reduce((sum, row) => sum + (row.actual - actualMean) ** 2, 0)
  return {
    metrics: { mae: mean(errors.map(Math.abs)), r2: total ? 1 - residual / total : 0, testedFlights: rows.length, launchDays: days.length, massCoverage: rows.filter(row => row.massSolved).length / rows.length } satisfies PredictionMetrics,
    residual80: quantile(errors.map(Math.abs), .8),
  }
}

export const predictionEngineV2: PredictionEngineV2 = {
  recommend(inputFlights, targetAltitude, conditions, limits) {
    const flights = inputFlights.filter(valid).sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id))
    const massRange: [number, number] | null = flights.length ? [Math.min(...flights.map(flight => flight.rocketMass)), Math.max(...flights.map(flight => flight.rocketMass))] : null
    if (flights.length < 3 || !massRange || massRange[0] === massRange[1]) return { engineVersion: 'current-v2', status: 'needs-data', method: null, reason: 'Log at least three flights with different launch masses.', observedMassRange: massRange, warnings: [] }
    const days = new Set(flights.map(flight => flight.date)).size
    const weatherSpread = [1, 2, 3, 4].filter(index => Math.max(...flights.map(flight => valuesFor(flight)[index])) - Math.min(...flights.map(flight => valuesFor(flight)[index])) > [0, 2, .08, 8, 8][index]).length
    const allCandidates = candidatesFor(flights)
    const evaluations = allCandidates.map(candidate => ({ candidate, validation: validate(flights, candidate.method) }))
    const learnedEligible = flights.length >= 8 && days >= 3
    const eligible = evaluations.filter(item => item.candidate.method === 'monotonic-baseline' || (learnedEligible && item.validation && item.validation.metrics.massCoverage >= .6 && (item.candidate.features.length === 1 || weatherSpread >= 2)))
      .filter(item => isMonotonic(item.candidate, conditions, massRange))
    const ranked = eligible.sort((a, b) => {
      if (!a.validation) return 1
      if (!b.validation) return -1
      const tolerance = Math.max(3, Math.min(a.validation.metrics.mae, b.validation.metrics.mae) * .05)
      return Math.abs(a.validation.metrics.mae - b.validation.metrics.mae) <= tolerance ? a.candidate.complexity - b.candidate.complexity : a.validation.metrics.mae - b.validation.metrics.mae
    })
    const selected = ranked[0] ?? evaluations.find(item => item.candidate.method === 'monotonic-baseline')
    if (!selected) return { engineVersion: 'current-v2', status: 'unsupported', method: null, reason: 'The flight log does not contain a physically usable mass trend.', observedMassRange: massRange, warnings: [] }
    const requested: [number, number] = limits ? [Math.max(massRange[0], limits[0]), Math.min(massRange[1], limits[1])] : massRange
    const mass = requested[0] < requested[1] ? solveMass(selected.candidate, targetAltitude, conditions, requested) : null
    const warnings: string[] = []
    if (!learnedEligible) warnings.push('Using the conservative baseline until eight flights across three launch days are available.')
    if (weatherSpread < 2) warnings.push('Logged weather has too little variation to validate weather effects.')
    if (mass === null) return { engineVersion: 'current-v2', status: 'unsupported', method: selected.candidate.method, reason: `The ${targetAltitude.toFixed(0)} ft target is outside this model’s supported mass range.`, observedMassRange: requested, warnings }
    const expectedAltitude = selected.candidate.predict({ ...conditions, mass })
    const error80 = selected.validation?.residual80 ?? null
    return {
      engineVersion: 'current-v2', status: 'ready', method: selected.candidate.method, methodLabel: selected.candidate.label,
      recommendedMass: mass, expectedAltitude, interval: error80 === null ? null : [Math.max(0, expectedAltitude - error80), expectedAltitude + error80],
      observedMassRange: requested, metrics: selected.validation?.metrics ?? { mae: NaN, r2: NaN, testedFlights: 0, launchDays: days, massCoverage: 0 },
      features: selected.candidate.features, warnings,
    }
  },
}
