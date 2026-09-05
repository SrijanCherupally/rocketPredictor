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
    }

export type PredictionEngineV2 = {
  recommend(flights: Launch[], targetAltitude: number, conditions: DescentConditions, limits?: [number, number]): PredictionResult
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
