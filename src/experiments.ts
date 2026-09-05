// Experimental models only. The original analytics.ts remains the frozen baseline.
import { adjustedRegression, descentRegression, linearRegression, predictAdjustedAltitude, predictDescentTime, type DescentConditions, type DescentModel, type Launch, type Model } from './analytics'

export type Task = 'descent' | 'altitude'
export type Method = 'baseline' | 'linear' | 'physics' | 'ridge' | 'neighbors' | 'neural'
export const methods: Method[] = ['baseline', 'linear', 'physics', 'ridge', 'neighbors', 'neural']
export const methodNames: Record<Method, string> = { baseline: 'Original regression', linear: 'Original mass-only', physics: 'Calibrated physics', ridge: 'Regularized regression', neighbors: 'Nearest flights', neural: 'Neural network' }
export const descriptions: Record<Method, string> = {
  baseline: 'Unchanged weather-aware baseline from analytics.ts.',
  linear: 'Unchanged mass-only altitude regression from analytics.ts.',
  physics: 'Descent: terminal-speed scaling calibrated to the median flight. Altitude: empirical inverse-mass trend, constrained to decrease with mass.',
  ridge: 'Standardized regression with shrinkage; descent learns a correction to terminal-speed scaling.',
  neighbors: 'Distance-weighted average of five similar flights; descent transfers their physics-normalized recovery times.',
  neural: 'Small tanh network with six hidden units, trained with backpropagation and L2 regularization. Requires 24 flights and sufficient validation data.',
}
const average = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length)
const medianValue = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return (s[Math.floor((s.length - 1) / 2)] + s[Math.floor(s.length / 2)]) / 2 }
const dot = (a: number[], b: number[]) => a.reduce((s, v, i) => s + v * b[i], 0)
export const conditionsFor = (l: Launch): DescentConditions => ({ mass: l.rocketMass, altitude: l.altitude, parachuteSize: l.parachuteSize, wind: l.windSpeed, pressure: l.airPressure, humidity: l.humidity, temperature: l.temperature })
export function validConditions(c: DescentConditions) {
  return [c.mass, c.altitude, c.parachuteSize, c.wind, c.pressure, c.humidity, c.temperature].every(Number.isFinite)
    && c.mass > 0 && c.altitude > 0 && c.parachuteSize > 0 && c.wind >= 0 && c.pressure > 0 && c.humidity >= 0 && c.humidity <= 100 && c.temperature > -459.67
}
export function usableFlights(flights: Launch[], task: Task) {
  return flights.filter(l => validConditions(conditionsFor(l)) && /^\d{4}-\d{2}-\d{2}$/.test(l.date) && Number.isFinite(Date.parse(l.date))
    && (task === 'altitude' || (Number.isFinite(l.descentTime) && l.descentTime > 0 && Number.isFinite(l.flightTime) && l.flightTime >= l.descentTime)))
}

/** Dry-air density approximation; launch pressure must be station pressure.
 * t = h sqrt(rho A / (2mg)) for Cd=1, followed by a learned calibration.
 * NASA: https://www.grc.nasa.gov/www/k-12/VirtualAero/BottleRocket/airplane/termvr.html
 * Logged liftoff mass is a proxy for recovery mass; calibration absorbs stable offsets.
 */
export function physicsTime(c: DescentConditions) {
  const kelvin = (c.temperature - 32) * 5 / 9 + 273.15
  const density = c.pressure * 3386.389 / (287.05 * kelvin)
  const area = Math.PI * (c.parachuteSize * .0254 / 2) ** 2
  return c.altitude * .3048 * Math.sqrt(density * area / (2 * c.mass / 1000 * 9.80665))
}
const features = (c: DescentConditions, task: Task) => task === 'descent'
  ? [Math.log(c.mass), Math.log(c.altitude), Math.log(c.parachuteSize), c.wind, c.pressure, c.humidity, c.temperature]
  : [c.mass, c.wind, c.pressure, c.humidity, c.temperature]

export type ExperimentModel = {
  task: Task; method: Method; sampleSize: number; means: number[]; scales: number[]
  weights: number[]; rows: number[][]; targets: number[]; center: number; spread: number
  hidden: number[][]; output: number[]; legacy?: Model | DescentModel
}
function solve(a: number[][], b: number[]) {
  const m = a.map((row, i) => [...row, b[i]])
  for (let p = 0; p < b.length; p++) {
    let best = p
    for (let i = p + 1; i < b.length; i++) if (Math.abs(m[i][p]) > Math.abs(m[best][p])) best = i
    if (Math.abs(m[best][p]) < 1e-10) return null
    ;[m[p], m[best]] = [m[best], m[p]]
    const d = m[p][p]
    for (let j = p; j <= b.length; j++) m[p][j] /= d
    for (let i = 0; i < b.length; i++) if (i !== p) {
      const f = m[i][p]
      for (let j = p; j <= b.length; j++) m[i][j] -= f * m[p][j]
    }
  }
  return m.map(row => row[b.length])
}
function ridge(rows: number[][], target: number[], penalty: number) {
  const x = rows.map(row => [1, ...row]); const d = x[0].length
  const a = Array.from({ length: d }, (_, i) => Array.from({ length: d }, (_, j) => average(x.map(row => row[i] * row[j])) + (i === j && i > 0 ? penalty : 0)))
  return solve(a, Array.from({ length: d }, (_, i) => average(x.map((row, k) => row[i] * target[k]))))
}

export function trainModel(flights: Launch[], task: Task, method: Method): ExperimentModel | null {
  const data = usableFlights(flights, task)
  if (data.length < (method === 'neural' ? 24 : 4) || (method === 'linear' && task === 'descent')) return null
  const model: ExperimentModel = { task, method, sampleSize: data.length, means: [], scales: [], weights: [], rows: [], targets: [], hidden: [], output: [], center: 0, spread: 1 }
  if (method === 'baseline' || method === 'linear') {
    const legacy = task === 'descent' ? descentRegression(data) : method === 'linear' ? linearRegression(data.map(l => ({ x: l.rocketMass, y: l.altitude }))) : adjustedRegression(data)
    return legacy ? { ...model, legacy } : null
  }
  if (method === 'physics') {
    if (task === 'descent') model.weights = [medianValue(data.map(l => l.descentTime / physicsTime(conditionsFor(l))))]
    else {
      const x = data.map(l => 1 / l.rocketMass); const y = data.map(l => l.altitude)
      const mx = average(x); const my = average(y); const variance = dot(x.map(v => v - mx), x.map(v => v - mx))
      if (variance < 1e-16) return null
      const slope = dot(x.map(v => v - mx), y.map(v => v - my)) / variance
      if (slope <= 0) return null
      model.weights = [my - slope * mx, slope]
    }
    return model
  }
  const raw = data.map(l => features(conditionsFor(l), task))
  model.means = raw[0].map((_, i) => average(raw.map(row => row[i])))
  model.scales = model.means.map((m, i) => Math.sqrt(average(raw.map(row => (row[i] - m) ** 2))) || 1)
  model.rows = raw.map(row => row.map((v, i) => (v - model.means[i]) / model.scales[i]))
  model.targets = data.map(l => task === 'descent' ? Math.log(l.descentTime / physicsTime(conditionsFor(l))) : l.altitude)
  model.center = average(model.targets)
  model.spread = Math.sqrt(average(model.targets.map(y => (y - model.center) ** 2))) || 1
  if (method === 'ridge') {
    const weights = ridge(model.rows, model.targets, .3)
    return weights ? { ...model, weights, rows: [], targets: [] } : null
  }
  if (method === 'neural') {
    // Fixed seed/hyperparameters: reproducible, never selected on held-out targets.
    let seed = 42
    const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296 - .5 }
    const x = model.rows.map(row => [1, ...row]); const y = model.targets.map(v => (v - model.center) / model.spread)
    model.hidden = Array.from({ length: 6 }, () => x[0].map(() => random() * .35))
    model.output = Array.from({ length: 7 }, () => random() * .2)
    for (let epoch = 0; epoch < 240; epoch++) {
      const gh = model.hidden.map(row => row.map(() => 0)); const go = model.output.map(() => 0)
      x.forEach((row, i) => {
        const hidden = model.hidden.map(w => Math.tanh(dot(row, w))); const activations = [1, ...hidden]
        const error = dot(activations, model.output) - y[i]
        go.forEach((_, j) => { go[j] += error * activations[j] / x.length })
        hidden.forEach((a, j) => row.forEach((v, k) => { gh[j][k] += error * model.output[j + 1] * (1 - a * a) * v / x.length }))
      })
      model.output = model.output.map((v, i) => v - .035 * (go[i] + (i ? .03 * v : 0)))
      model.hidden = model.hidden.map((row, j) => row.map((v, k) => v - .035 * (gh[j][k] + (k ? .03 * v : 0))))
    }
    model.rows = []; model.targets = []
  }
  return model
}

export function predictModel(model: ExperimentModel, c: DescentConditions): number | null {
  if (!validConditions(c)) return null
  let y: number
  if (model.legacy) y = model.task === 'descent' ? predictDescentTime(model.legacy as DescentModel, c) : model.method === 'linear'
    ? model.legacy.intercept + model.legacy.coefficients[0] * c.mass : predictAdjustedAltitude(model.legacy, c.mass, c)
  else if (model.method === 'physics') y = model.task === 'descent' ? physicsTime(c) * model.weights[0] : model.weights[0] + model.weights[1] / c.mass
  else {
    const row = features(c, model.task).map((v, i) => (v - model.means[i]) / model.scales[i])
    if (model.method === 'ridge') y = dot([1, ...row], model.weights)
    else if (model.method === 'neural') y = model.center + model.spread * dot([1, ...model.hidden.map(w => Math.tanh(dot([1, ...row], w)))], model.output)
    else {
      const near = model.rows.map((r, i) => ({ y: model.targets[i], distance: average(r.map((v, j) => (v - row[j]) ** 2)) })).sort((a, b) => a.distance - b.distance).slice(0, 5)
      const weights = near.map(n => 1 / (.15 + n.distance))
      y = dot(near.map(n => n.y), weights) / weights.reduce((a, b) => a + b, 0)
    }
    if (model.task === 'descent') y = physicsTime(c) * Math.exp(y)
  }
  return Number.isFinite(y) && y > 0 ? y : null
}

export type MassSolution = { mass: number | null; reason: string }
/** Invert only a decreasing, identifiable response inside measured mass support. */
export function solveMass(model: ExperimentModel, target: number, c: DescentConditions, bounds: [number, number]): MassSolution {
  const [min, max] = bounds
  const fail = (reason: string): MassSolution => ({ mass: null, reason })
  if (model.task !== 'altitude' || !Number.isFinite(target) || target <= 0 || min <= 0 || max <= min) return fail('Need a varied, positive mass range.')
  const curve = Array.from({ length: 65 }, (_, i) => predictModel(model, { ...c, mass: min + (max - min) * i / 64 }))
  if (curve.some(v => v === null)) return fail('Invalid prediction at these conditions.')
  const ys = curve as number[]
  if (ys[0] - ys[64] < 1 || ys.some((v, i) => i > 0 && v > ys[i - 1] + 1e-6)) return fail('Mass response is flat or non-monotonic; no unique recommendation.')
  if (target > ys[0] || target < ys[64]) return fail('Target is outside the predicted altitude range at logged masses.')
  let lo = min; let hi = max
  for (let i = 0; i < 35; i++) {
    const mid = (lo + hi) / 2; const y = predictModel(model, { ...c, mass: mid })
    if (y === null) return fail('Invalid prediction during inversion.')
    if (y > target) lo = mid; else hi = mid
  }
  return { mass: (lo + hi) / 2, reason: 'Within logged masses; assumes the same rocket and motor configuration.' }
}

export type ValidationRow = { id: string; date: string; actual: number; predicted: number; residual: number }
export type ExperimentResult = { method: Method; model: ExperimentModel | null; mae: number | null; rmse: number | null; r2: number | null; error80: number | null; massMae: number | null; massCount: number; tested: number; total: number; rows: ValidationRow[] }
export type Suite = { task: Task; flights: Launch[]; excluded: number; folds: number; results: ExperimentResult[] }
export function benchmark(flights: Launch[], task: Task): Suite {
  const data = usableFlights(flights, task).sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id))
  const dates = [...new Set(data.map(l => l.date))]; const folds = Math.min(5, dates.length)
  const foldOf = new Map(dates.map((date, i) => [date, i % Math.max(1, folds)]))
  const results = methods.filter(method => task === 'altitude' || method !== 'linear').map(method => {
    const rows: ValidationRow[] = []; const massErrors: number[] = []
    if (folds >= 3) for (let fold = 0; fold < folds; fold++) {
      const train = data.filter(l => foldOf.get(l.date) !== fold); const test = data.filter(l => foldOf.get(l.date) === fold)
      const model = trainModel(train, task, method)
      if (!model) continue
      for (const l of test) {
        const predicted = predictModel(model, conditionsFor(l)); const actual = task === 'descent' ? l.descentTime : l.altitude
        if (predicted === null) continue
        rows.push({ id: l.id, date: l.date, actual, predicted, residual: actual - predicted })
        if (task === 'altitude') {
          const solution = solveMass(model, l.altitude, conditionsFor(l), [Math.min(...train.map(l => l.rocketMass)), Math.max(...train.map(l => l.rocketMass))])
          if (solution.mass !== null) massErrors.push(Math.abs(solution.mass - l.rocketMass))
        }
      }
    }
    const errors = rows.map(r => Math.abs(r.residual)).sort((a, b) => a - b)
    const mean = average(rows.map(r => r.actual)); const variance = rows.reduce((s, r) => s + (r.actual - mean) ** 2, 0)
    return { method, model: trainModel(data, task, method), mae: rows.length ? average(errors) : null, rmse: rows.length ? Math.sqrt(average(errors.map(v => v * v))) : null,
      r2: variance > 0 ? 1 - rows.reduce((s, r) => s + r.residual ** 2, 0) / variance : null,
      error80: rows.length >= 8 ? errors[Math.ceil(.8 * errors.length) - 1] : null,
      massMae: massErrors.length ? average(massErrors) : null, massCount: massErrors.length, tested: rows.length, total: data.length, rows }
  })
  return { task, flights: data, excluded: flights.length - data.length, folds, results }
}
export function bestResult(suite: Suite) {
  return suite.results.filter(r => r.model && r.tested === r.total && r.tested >= 8 && r.mae !== null).sort((a, b) => a.mae! - b.mae!)[0] ?? null
}
export function outsideCoverage(flights: Launch[], c: DescentConditions, task: Task) {
  const keys: Array<keyof Omit<DescentConditions, 'flightTime'>> = task === 'descent' ? ['mass', 'altitude', 'parachuteSize', 'wind', 'pressure', 'humidity', 'temperature'] : ['wind', 'pressure', 'humidity', 'temperature']
  return keys.filter(key => flights.length && (c[key] < Math.min(...flights.map(l => conditionsFor(l)[key])) - 1e-8 || c[key] > Math.max(...flights.map(l => conditionsFor(l)[key])) + 1e-8))
}
