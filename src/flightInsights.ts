import type { FlightRecord } from './predictionTypes'

const mean = (x: number[]) => x.reduce((a, b) => a + b, 0) / Math.max(1, x.length)
export function correlation(x: number[], y: number[]): number | null {
  if (x.length < 3 || x.length !== y.length) return null
  const mx = mean(x), my = mean(y)
  const denominator = Math.sqrt(x.reduce((s, v) => s + (v - mx) ** 2, 0) * y.reduce((s, v) => s + (v - my) ** 2, 0))
  return denominator < 1e-9 ? null : Math.max(-1, Math.min(1, x.reduce((s, v, i) => s + (v - mx) * (y[i] - my), 0) / denominator))
}
function residualize(values: number[], control: number[]) {
  const mx = mean(control), my = mean(values)
  const variance = control.reduce((s, v) => s + (v - mx) ** 2, 0)
  const slope = variance > 1e-12 ? control.reduce((s, v, i) => s + (v - mx) * (values[i] - my), 0) / variance : 0
  return values.map((v, i) => v - my - slope * (control[i] - mx))
}
export function flightInsights(input: FlightRecord[]) {
  const flights = input.filter(f => [f.altitude, f.rocketMass, f.windSpeed, f.airPressure, f.humidity, f.temperature].every(Number.isFinite) && f.rocketMass > 0 && f.altitude > 0)
  const mass = flights.map(f => 1 / f.rocketMass)
  const altitude = flights.map(f => f.altitude)
  const residuals = residualize(altitude, mass)
  const fields = ['windSpeed', 'airPressure', 'humidity', 'temperature'] as const
  const factors = fields.map(key => {
    const values = flights.map(f => f[key])
    return { key, raw: correlation(values, altitude), adjusted: correlation(residualize(values, mass), residuals), min: values.length ? Math.min(...values) : null, max: values.length ? Math.max(...values) : null }
  })
  const pairs: Array<{ first: FlightRecord; second: FlightRecord; altitudeDelta: number; windDelta: number; massDelta: number }> = []
  flights.forEach((a, i) => flights.slice(i + 1).forEach(b => {
    if (a.date !== b.date || Math.abs(a.rocketMass - b.rocketMass) > 5 || Math.abs(a.windSpeed - b.windSpeed) < .5) return
    const [first, second] = a.windSpeed < b.windSpeed ? [a, b] : [b, a]
    pairs.push({ first, second, altitudeDelta: second.altitude - first.altitude, windDelta: second.windSpeed - first.windSpeed, massDelta: second.rocketMass - first.rocketMass })
  }))
  const tiltCount = flights.filter(f => f.observedTilt != null).length
  return { flights, days: new Set(flights.map(f => f.date)).size, factors, pairs, tiltCount,
    residuals: flights.map((flight, i) => ({ flight, residual: residuals[i] })).sort((a, b) => Math.abs(b.residual) - Math.abs(a.residual)),
    sameTimes: flights.filter(f => f.flightTime > 0 && f.flightTime === f.descentTime).length }
}
