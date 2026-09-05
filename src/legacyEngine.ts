import type { Launch } from './analytics'
import type { FlightRecord, LegacyEngineAdapter } from './predictionTypes'

// The implementation modules analytics.ts and experiments.ts are intentionally
// untouched. This adapter is the only boundary between new records and Legacy v1.
const legacyKeys: Array<keyof Launch> = ['id', 'date', 'altitude', 'flightTime', 'descentTime', 'parachuteSize', 'rocketMass', 'windSpeed', 'airPressure', 'humidity', 'temperature', 'notes']

export const legacyEngine: LegacyEngineAdapter = {
  engineVersion: 'legacy-v1',
  toLegacyLaunches(records: FlightRecord[]) {
    return records.map(record => Object.fromEntries(legacyKeys.map(key => [key, record[key]])) as Launch)
  },
}
