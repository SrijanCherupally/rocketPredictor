import type { DescentConditions, Launch } from './analytics'

export type EngineVersion = 'legacy-v1' | 'current-v2'
export type Units = 'imperial' | 'metric'

export type FlightRecord = Launch & {
  schemaVersion?: 2
  version?: number
  createdAt?: string
  updatedAt?: string
}

export type WorkspacePreferences = {
  units: Units
  targetAltitude: number
  plannerMinMass: number
  plannerMaxMass: number
  engineVersion: EngineVersion
}

export type PredictionMethodV2 = 'monotonic-baseline' | 'weather-ridge' | 'physics-hybrid' | 'nearest-flights' | 'bounded-neural'

export type PredictionMetrics = {
  mae: number
  r2: number
  testedFlights: number
  launchDays: number
  massCoverage: number
}

export type MethodComparison = {
  method: PredictionMethodV2
  methodLabel: string
  eligible: boolean
  selected: boolean
  metrics: PredictionMetrics | null
  marginOfError: number | null
  note: string | null
}

export type DescentPredictionResult = {
  status: 'ready'
  method: 'physics-estimate' | 'calibrated-physics'
  methodLabel: string
  expectedSeconds: number
  interval: [number, number] | null
  marginOfError: number | null
  calibrationFlights: number
  warnings: string[]
}

export type PredictionResult =
  | {
      engineVersion: 'current-v2'
      status: 'ready'
      method: PredictionMethodV2
      methodLabel: string
      recommendedMass: number
      expectedAltitude: number
      interval: [number, number] | null
      observedMassRange: [number, number]
      metrics: PredictionMetrics
      comparisons: MethodComparison[]
      features: string[]
      warnings: string[]
    }
  | {
      engineVersion: 'current-v2'
      status: 'needs-data' | 'unsupported'
      method: PredictionMethodV2 | null
      reason: string
      observedMassRange: [number, number] | null
      warnings: string[]
      comparisons: MethodComparison[]
    }

export type PredictionEngineV2 = {
  recommend(flights: Launch[], targetAltitude: number, conditions: DescentConditions, limits?: [number, number]): PredictionResult
  predictDescent(flights: Launch[], conditions: DescentConditions): DescentPredictionResult
}

export type LegacyEngineAdapter = {
  readonly engineVersion: 'legacy-v1'
  toLegacyLaunches(records: FlightRecord[]): Launch[]
}

export type ExportEnvelope = {
  schemaVersion: 2
  exportedAt: string
  engineVersion: EngineVersion
  preferences: WorkspacePreferences
  flights: FlightRecord[]
}
