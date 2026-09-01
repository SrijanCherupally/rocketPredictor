export type Launch = {
  id: string
  date: string
  altitude: number
  flightTime: number
  descentTime: number
  parachuteSize: number
  rocketMass: number
  windSpeed: number
  airPressure: number
  humidity: number
  temperature: number
  notes?: string
}

export type Model = {
  intercept: number
  coefficients: number[]
  r2: number
  mae: number
  sampleSize: number
}

export const totalMass = (launch: Launch) => launch.rocketMass

export function linearRegression(points: Array<{ x: number; y: number }>): Model | null {
  if (points.length < 3) return null
  const meanX = points.reduce((sum, point) => sum + point.x, 0) / points.length
  const meanY = points.reduce((sum, point) => sum + point.y, 0) / points.length
  const varianceX = points.reduce((sum, point) => sum + (point.x - meanX) ** 2, 0)
  if (varianceX < 0.0001) return null
  const covariance = points.reduce((sum, point) => sum + (point.x - meanX) * (point.y - meanY), 0)
  const slope = covariance / varianceX
  const intercept = meanY - slope * meanX
  const predictions = points.map((point) => intercept + slope * point.x)
  const totalVariance = points.reduce((sum, point) => sum + (point.y - meanY) ** 2, 0)
  const residualVariance = points.reduce((sum, point, index) => sum + (point.y - predictions[index]) ** 2, 0)
  const mae = points.reduce((sum, point, index) => sum + Math.abs(point.y - predictions[index]), 0) / points.length

  return {
    intercept,
    coefficients: [slope],
    r2: totalVariance === 0 ? 0 : Math.max(0, 1 - residualVariance / totalVariance),
    mae,
    sampleSize: points.length,
  }
}

function solve(matrix: number[][], output: number[]): number[] | null {
  const n = output.length
  const augmented = matrix.map((row, i) => [...row, output[i]])
  for (let pivot = 0; pivot < n; pivot += 1) {
    let maxRow = pivot
    for (let row = pivot + 1; row < n; row += 1) {
      if (Math.abs(augmented[row][pivot]) > Math.abs(augmented[maxRow][pivot])) maxRow = row
    }
    if (Math.abs(augmented[maxRow][pivot]) < 1e-8) return null
    ;[augmented[pivot], augmented[maxRow]] = [augmented[maxRow], augmented[pivot]]
    const divisor = augmented[pivot][pivot]
    for (let column = pivot; column <= n; column += 1) augmented[pivot][column] /= divisor
    for (let row = 0; row < n; row += 1) {
      if (row === pivot) continue
      const factor = augmented[row][pivot]
      for (let column = pivot; column <= n; column += 1) augmented[row][column] -= factor * augmented[pivot][column]
    }
  }
  return augmented.map((row) => row[n])
}

export type WeatherReference = { wind: number; pressure: number; humidity: number; temperature: number }

export type DescentConditions = {
  mass: number
  altitude: number
  parachuteSize: number
  wind: number
  pressure: number
  humidity: number
  temperature: number
  flightTime: number
}

export type DescentModel = Model & {
  means: number[]
  scales: number[]
}

const descentFeatures = (conditions: DescentConditions) => [
  conditions.mass,
  conditions.altitude,
  conditions.parachuteSize,
  conditions.wind,
  conditions.pressure,
  conditions.humidity,
  conditions.temperature,
  conditions.flightTime,
]

/**
 * Ridge regression for descent time. Inputs are standardized before fitting so
 * that weather, mass, altitude, and parachute dimensions can learn together.
 * Rebuilding from the flight log makes each newly saved flight part of the model.
 */
export function descentRegression(launches: Launch[]): DescentModel | null {
  if (launches.length < 4) return null
  const rawFeatures = launches.map((launch) => descentFeatures({
    mass: totalMass(launch), altitude: launch.altitude, parachuteSize: launch.parachuteSize,
    wind: launch.windSpeed, pressure: launch.airPressure, humidity: launch.humidity,
    temperature: launch.temperature, flightTime: launch.flightTime,
  }))
  const columns = rawFeatures[0].length
  const means = Array.from({ length: columns }, (_, column) => rawFeatures.reduce((sum, row) => sum + row[column], 0) / rawFeatures.length)
  const scales = Array.from({ length: columns }, (_, column) => Math.max(1e-6, Math.sqrt(rawFeatures.reduce((sum, row) => sum + (row[column] - means[column]) ** 2, 0) / rawFeatures.length)))
  const features = rawFeatures.map((row) => [1, ...row.map((value, column) => (value - means[column]) / scales[column])])
  const target = launches.map((launch) => launch.descentTime)
  const normalMatrix = Array.from({ length: columns + 1 }, () => Array(columns + 1).fill(0))
  const normalOutput = Array(columns + 1).fill(0)
  features.forEach((row, rowIndex) => {
    for (let i = 0; i < row.length; i += 1) {
      normalOutput[i] += row[i] * target[rowIndex]
      for (let j = 0; j < row.length; j += 1) normalMatrix[i][j] += row[i] * row[j]
    }
  })
  // A modest ridge penalty keeps the prediction stable with a small flight log.
  for (let i = 1; i < normalMatrix.length; i += 1) normalMatrix[i][i] += 1
  const values = solve(normalMatrix, normalOutput)
  if (!values) return null
  const predictions = features.map((row) => row.reduce((sum, value, index) => sum + value * values[index], 0))
  const mean = target.reduce((sum, value) => sum + value, 0) / target.length
  const residual = target.reduce((sum, value, index) => sum + (value - predictions[index]) ** 2, 0)
  const variance = target.reduce((sum, value) => sum + (value - mean) ** 2, 0)
  return {
    intercept: values[0], coefficients: values.slice(1), means, scales,
    r2: variance === 0 ? 0 : Math.max(0, 1 - residual / variance),
    mae: target.reduce((sum, value, index) => sum + Math.abs(value - predictions[index]), 0) / target.length,
    sampleSize: launches.length,
  }
}

export function predictDescentTime(model: DescentModel, conditions: DescentConditions) {
  return model.intercept + descentFeatures(conditions).reduce((sum, value, index) => sum + model.coefficients[index] * ((value - model.means[index]) / model.scales[index]), 0)
}

export function adjustedRegression(launches: Launch[]): Model | null {
  if (launches.length < 4) return null
  const features = launches.map((launch) => [1, totalMass(launch), launch.windSpeed, launch.airPressure, launch.humidity, launch.temperature])
  const target = launches.map((launch) => launch.altitude)
  const columns = features[0].length
  const normalMatrix = Array.from({ length: columns }, () => Array(columns).fill(0))
  const normalOutput = Array(columns).fill(0)
  features.forEach((row, rowIndex) => {
    for (let i = 0; i < columns; i += 1) {
      normalOutput[i] += row[i] * target[rowIndex]
      for (let j = 0; j < columns; j += 1) normalMatrix[i][j] += row[i] * row[j]
    }
  })
  for (let i = 1; i < columns; i += 1) normalMatrix[i][i] += 0.01
  const values = solve(normalMatrix, normalOutput)
  if (!values) return null
  const predictions = features.map((row) => row.reduce((sum, value, index) => sum + value * values[index], 0))
  const mean = target.reduce((sum, value) => sum + value, 0) / target.length
  const residual = target.reduce((sum, value, index) => sum + (value - predictions[index]) ** 2, 0)
  const variance = target.reduce((sum, value) => sum + (value - mean) ** 2, 0)
  return {
    intercept: values[0],
    coefficients: values.slice(1),
    r2: variance === 0 ? 0 : Math.max(0, 1 - residual / variance),
    mae: target.reduce((sum, value, index) => sum + Math.abs(value - predictions[index]), 0) / target.length,
    sampleSize: launches.length,
  }
}

export function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}

export function adjustedAltitude(launch: Launch, model: Model, reference: WeatherReference) {
  const [, windCoefficient, pressureCoefficient, humidityCoefficient, temperatureCoefficient] = model.coefficients
  const observedWeather = windCoefficient * launch.windSpeed + pressureCoefficient * launch.airPressure + humidityCoefficient * launch.humidity + temperatureCoefficient * launch.temperature
  const referenceWeather = windCoefficient * reference.wind + pressureCoefficient * reference.pressure + humidityCoefficient * reference.humidity + temperatureCoefficient * reference.temperature
  return launch.altitude - observedWeather + referenceWeather
}

export function predictAdjustedAltitude(model: Model, mass: number, weather: WeatherReference) {
  const [massCoefficient, windCoefficient, pressureCoefficient, humidityCoefficient, temperatureCoefficient] = model.coefficients
  return model.intercept + massCoefficient * mass + windCoefficient * weather.wind + pressureCoefficient * weather.pressure + humidityCoefficient * weather.humidity + temperatureCoefficient * weather.temperature
}

export function optimalRocketMass(model: Model | null, targetAltitude: number, weather: WeatherReference) {
  if (!model || Math.abs(model.coefficients[0]) < 1e-8) return null
  const weatherAltitude = model.intercept + model.coefficients[1] * weather.wind + model.coefficients[2] * weather.pressure + model.coefficients[3] * weather.humidity + model.coefficients[4] * weather.temperature
  return (targetAltitude - weatherAltitude) / model.coefficients[0]
}

// ---------------------------------------------------------------------------
// Ballast formula
// ---------------------------------------------------------------------------

const fmt = (n: number, d = 4) => {
  if (n === 0) return '0'
  const abs = Math.abs(n)
  const decimals = abs >= 100 ? 1 : abs >= 10 ? 2 : abs >= 1 ? 3 : d
  return Number(n.toFixed(decimals)).toString()
}

/**
 * Generates a human-readable formula string for the adjusted regression model.
 * Returns null when the model is not ready.
 */
export function buildBallastFormula(
  model: Model,
  reference: { wind: number; pressure: number; humidity: number },
) {
  if (!model || model.coefficients.length < 4) return null

  const [massCoef, windCoef, pressureCoef, humidityCoef] = model.coefficients
  if (Math.abs(massCoef) < 1e-8) return null

  const terms: string[] = []

  // Intercept
  if (Math.abs(model.intercept) > 1e-6) {
    terms.push(fmt(model.intercept))
  }

  // Mass term
  if (Math.abs(massCoef) > 1e-6) {
    terms.push(massCoef < 0
      ? `${fmt(massCoef)} · mass`
      : `+ ${fmt(massCoef)} · mass`)
  }

  // Wind term
  if (Math.abs(windCoef) > 1e-6) {
    terms.push(windCoef < 0
      ? `${fmt(windCoef)} · wind`
      : `+ ${fmt(windCoef)} · wind`)
  }

  // Pressure term
  if (Math.abs(pressureCoef) > 1e-6) {
    terms.push(pressureCoef < 0
      ? `${fmt(pressureCoef)} · pressure`
      : `+ ${fmt(pressureCoef)} · pressure`)
  }

  // Humidity term
  if (Math.abs(humidityCoef) > 1e-6) {
    terms.push(humidityCoef < 0
      ? `${fmt(humidityCoef)} · humidity`
      : `+ ${fmt(humidityCoef)} · humidity`)
  }

  const formula = terms.length > 0 ? terms.join(' ') : '0'

  return {
    formula,
    intercept: model.intercept,
    massCoef,
    windCoef,
    pressureCoef,
    humidityCoef,
    r2: model.r2,
    mae: model.mae,
    sampleSize: model.sampleSize,
    reference,
  }
}

export type BallastFormula = NonNullable<ReturnType<typeof buildBallastFormula>>

/**
 * Given the adjusted model, reference weather, and current rocket mass,
 * predict altitude and compute how much mass to add/remove to hit a target.
 */
export function computeBallast(
  formula: BallastFormula,
  currentMass: number,
  targetAltitude: number,
): { predicted: number; massDelta: number; resultMass: number } {
  const { massCoef } = formula
  if (Math.abs(massCoef) < 1e-8) {
    return { predicted: 0, massDelta: 0, resultMass: currentMass }
  }
  const predicted = formula.intercept
    + massCoef * currentMass
    + formula.windCoef * formula.reference.wind
    + formula.pressureCoef * formula.reference.pressure
    + formula.humidityCoef * formula.reference.humidity
  const massDelta = (targetAltitude - predicted) / massCoef
  return {
    predicted,
    massDelta,
    resultMass: currentMass + massDelta,
  }
}
