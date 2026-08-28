export type Launch = {
  id: string
  date: string
  altitude: number
  flightTime: number
  descentTime: number
  parachuteSize: number
  rocketMass: number
  motorMass: number
  windSpeed: number
  airPressure: number
  humidity: number
  notes?: string
}

export type Model = {
  intercept: number
  coefficients: number[]
  r2: number
  mae: number
  sampleSize: number
}

export const totalMass = (launch: Launch) => launch.rocketMass + launch.motorMass

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

export function adjustedRegression(launches: Launch[]): Model | null {
  if (launches.length < 7) return null
  const features = launches.map((launch) => [1, totalMass(launch), launch.windSpeed, launch.airPressure, launch.humidity])
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

export function adjustedAltitude(launch: Launch, model: Model, reference: { wind: number; pressure: number; humidity: number }) {
  const [, windCoefficient, pressureCoefficient, humidityCoefficient] = model.coefficients
  const observedWeather = windCoefficient * launch.windSpeed + pressureCoefficient * launch.airPressure + humidityCoefficient * launch.humidity
  const referenceWeather = windCoefficient * reference.wind + pressureCoefficient * reference.pressure + humidityCoefficient * reference.humidity
  return launch.altitude - observedWeather + referenceWeather
}
