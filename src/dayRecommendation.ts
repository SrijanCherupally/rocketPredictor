import type { FlightRecord } from './predictionTypes'

export const tiltWeight = (flight: FlightRecord) => flight.observedTilt === 'strong' ? .15 : flight.observedTilt === 'slight' ? .5 : flight.observedTilt === 'straight' ? 1 : .7
const usable = (f: FlightRecord) => Number.isFinite(f.altitude) && f.altitude > 0 && Number.isFinite(f.rocketMass) && f.rocketMass > 0 && Number.isFinite(f.windSpeed) && f.windSpeed >= 0

export function massTrend(flights: FlightRecord[]) {
  const valid = flights.filter(usable)
  if (valid.length < 3) return null
  const weight = valid.reduce((s, f) => s + tiltWeight(f), 0)
  const mx = valid.reduce((s, f) => s + tiltWeight(f) / f.rocketMass, 0) / weight
  const my = valid.reduce((s, f) => s + tiltWeight(f) * f.altitude, 0) / weight
  const variance = valid.reduce((s, f) => s + tiltWeight(f) * (1 / f.rocketMass - mx) ** 2, 0)
  if (variance < 1e-12) return null
  const slope = valid.reduce((s, f) => s + tiltWeight(f) * (1 / f.rocketMass - mx) * (f.altitude - my), 0) / variance
  if (slope <= 0) return null
  const intercept = my - slope * mx
  return { slope, intercept, predict: (mass: number) => intercept + slope / mass }
}

export function compareFlights(flights: FlightRecord[], first: FlightRecord, second: FlightRecord) {
  // Exclude the compared pair from the fit where possible to avoid explaining
  // away its own difference. This is a descriptive comparison, not causality.
  const trend = massTrend(flights.filter(f => f.id !== first.id && f.id !== second.id))
  const observed = second.altitude - first.altitude
  const massExpected = trend ? trend.predict(second.rocketMass) - trend.predict(first.rocketMass) : null
  return { observed, massExpected, unexplained: massExpected === null ? null : observed - massExpected }
}

export function recommendNextFlight(input: FlightRecord[], date: string, target: number, wind: number, limits: [number, number], latestFlightId?: string) {
  const flights = input.filter(f => usable(f) && f.date <= date).sort((a, b) => a.date.localeCompare(b.date) || (a.createdAt && b.createdAt ? a.createdAt.localeCompare(b.createdAt) : 0))
  const today = flights.filter(f => f.date === date)
  const history = flights.filter(f => f.date < date)
  const historicalTrend = massTrend(history)
  const trend = historicalTrend ?? massTrend(flights)
  if (!trend || !Number.isFinite(target) || target <= 0 || !Number.isFinite(wind) || wind < 0) return { status: 'needs-data' as const, reason: 'Need at least three valid flights with a decreasing mass–altitude trend, plus a positive target and valid wind.' }
  const low = Math.max(limits[0], Math.min(...flights.map(f => f.rocketMass)))
  const high = Math.min(limits[1], Math.max(...flights.map(f => f.rocketMass)))
  if (!Number.isFinite(low) || !Number.isFinite(high) || low >= high) return { status: 'needs-data' as const, reason: 'The recorded mass range does not overlap your configured limits.' }
  const latest = today.find(f => f.id === latestFlightId) ?? today.at(-1)
  const rows = today.map(f => ({ flight: f, weight: tiltWeight(f) * (f === latest ? 2 : 1) / (1 + ((f.windSpeed - wind) / 2) ** 2), residual: f.altitude - trend.predict(f.rocketMass) }))
  const evidence = rows.reduce((s, row) => s + row.weight, 0)
  // Same-day evidence is blended with two historical pseudo-observations.
  // A sole unknown flight gets 41% influence; a marked tilted one gets 13%.
  const dayShare = historicalTrend ? evidence / (2 + evidence) : 0
  const offset = historicalTrend ? rows.reduce((s, row) => s + row.weight * row.residual, 0) / (2 + evidence) : 0
  let desired = trend.slope / (target - trend.intercept - offset)
  let method = today.length ? 'Same-day calibrated history' : 'Historical starting mass'
  const comparable = today.filter(f => f.observedTilt === 'straight' && Math.abs(f.windSpeed - wind) <= 1)
  const brackets: Array<{ a: FlightRecord; b: FlightRecord }> = []
  comparable.forEach((a, i) => comparable.slice(i + 1).forEach(b => {
    if (Math.abs(a.rocketMass - b.rocketMass) >= 2 && Math.abs(a.windSpeed - b.windSpeed) <= 1 && (a.altitude - b.altitude) * (a.rocketMass - b.rocketMass) < 0 && target >= Math.min(a.altitude, b.altitude) && target <= Math.max(a.altitude, b.altitude)) brackets.push({ a, b })
  }))
  // Only interpolate between actual same-day endpoints. Never project this
  // local slope outside their altitude bracket.
  const bracket: { a: FlightRecord; b: FlightRecord } | undefined = brackets.sort((x, y) => Math.abs(x.a.altitude - x.b.altitude) - Math.abs(y.a.altitude - y.b.altitude)).at(0)
  if (bracket) {
    desired = bracket.a.rocketMass + (target - bracket.a.altitude) * (bracket.b.rocketMass - bracket.a.rocketMass) / (bracket.b.altitude - bracket.a.altitude)
    method = 'Same-day straight-flight interpolation'
  }
  if (!Number.isFinite(desired) || desired < low || desired > high) return { status: 'unsupported' as const, reason: 'The target requires a mass outside the recorded/configured range. Collect more supporting flights before extending it.' }
  const matching = latest ? today.filter(f => Math.abs(f.rocketMass - latest.rocketMass) <= 1 && Math.abs(f.windSpeed - wind) <= 1 && f.observedTilt !== 'strong') : []
  const repeat = !!latest && (latest.observedTilt === 'strong' || (!bracket && matching.length < 3))
  const inBounds = latest && latest.rocketMass >= low && latest.rocketMass <= high
  const mass = inBounds ? repeat ? latest.rocketMass : Math.max(low, Math.min(high, latest.rocketMass + Math.max(-3, Math.min(3, desired - latest.rocketMass)))) : desired
  const residuals = flights.map(f => Math.abs(f.altitude - trend.predict(f.rocketMass))).sort((a, b) => a - b)
  const spread = residuals[Math.min(residuals.length - 1, Math.ceil(.8 * residuals.length) - 1)]
  const expected = bracket && mass >= Math.min(bracket.a.rocketMass, bracket.b.rocketMass) && mass <= Math.max(bracket.a.rocketMass, bracket.b.rocketMass)
    ? bracket.a.altitude + (mass - bracket.a.rocketMass) * (bracket.b.altitude - bracket.a.altitude) / (bracket.b.rocketMass - bracket.a.rocketMass)
    : trend.predict(mass) + offset
  return { status: 'ready' as const, mass, desired, expected, spread, dayShare, dayFlights: today.length, latest, method, repeat,
    repeatsRemaining: latest && repeat ? Math.max(1, 3 - matching.length) : today.length ? 1 : 3,
    slopeAtMass: -trend.slope / mass ** 2, low, high, bracket: bracket ?? null }
}
