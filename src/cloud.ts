import type { SupabaseClient } from '@supabase/supabase-js'
import type { Launch } from './analytics'
import type { EngineVersion, WorkspacePreferences } from './predictionTypes'

export type CloudLaunchRow = {
  user_id: string
  launch_id: string
  date: string
  altitude: number
  flight_time: number
  descent_time: number
  parachute_size: number
  rocket_mass: number
  wind_speed: number
  air_pressure: number
  humidity: number
  temperature: number
  notes: string | null
  version: number
  created_at: string
  updated_at: string
}

export type CloudPreferences = {
  units: 'imperial' | 'metric'
  targetAltitude: number
  plannerMinMass: number
  plannerMaxMass: number
  engineVersion: EngineVersion
}

export class CloudConflictError extends Error {
  constructor(message = 'This flight changed on another device.') {
    super(message)
    this.name = 'CloudConflictError'
  }
}

type Client = SupabaseClient

export const rowToLaunch = (row: CloudLaunchRow): Launch => ({
  id: row.launch_id,
  date: row.date,
  altitude: row.altitude,
  flightTime: row.flight_time,
  descentTime: row.descent_time,
  parachuteSize: row.parachute_size,
  rocketMass: row.rocket_mass,
  windSpeed: row.wind_speed,
  airPressure: row.air_pressure,
  humidity: row.humidity,
  temperature: row.temperature,
  notes: row.notes ?? '',
})

const launchToRow = (userId: string, launch: Launch) => ({
  user_id: userId,
  launch_id: launch.id,
  date: launch.date,
  altitude: launch.altitude,
  flight_time: launch.flightTime,
  descent_time: launch.descentTime,
  parachute_size: launch.parachuteSize,
  rocket_mass: launch.rocketMass,
  wind_speed: launch.windSpeed,
  air_pressure: launch.airPressure,
  humidity: launch.humidity,
  temperature: launch.temperature,
  notes: launch.notes ?? '',
})

export async function fetchWorkspace(client: Client, userId: string) {
  const pageSize = 500
  const allRows: CloudLaunchRow[] = []
  for (let from = 0; ; from += pageSize) {
    const result = await client.from('launches').select('*').eq('user_id', userId).order('date', { ascending: true }).order('launch_id', { ascending: true }).range(from, from + pageSize - 1)
    if (result.error) throw result.error
    const page = (result.data ?? []) as CloudLaunchRow[]
    allRows.push(...page)
    if (page.length < pageSize) break
  }
  const [launchResult, preferenceResult] = await Promise.all([
    Promise.resolve({ data: allRows, error: null }),
    client.from('user_preferences').select('*').eq('user_id', userId).maybeSingle(),
  ])
  if (launchResult.error) throw launchResult.error
  if (preferenceResult.error) throw preferenceResult.error
  const rows = (launchResult.data ?? []) as CloudLaunchRow[]
  const preference = preferenceResult.data as { units?: 'imperial' | 'metric'; target_altitude?: number; planner_min_mass?: number; planner_max_mass?: number; engine_version?: EngineVersion } | null
  return {
    launches: rows.map(rowToLaunch),
    versions: Object.fromEntries(rows.map((row) => [row.launch_id, row.version])),
    preferences: preference
      ? { units: preference.units ?? 'imperial', targetAltitude: preference.target_altitude ?? 800, plannerMinMass: preference.planner_min_mass ?? 500, plannerMaxMass: preference.planner_max_mass ?? 700, engineVersion: preference.engine_version ?? 'current-v2' }
      : null,
  }
}

export async function importLaunches(client: Client, userId: string, launches: Launch[]) {
  if (launches.length === 0) return
  const { error } = await client.from('launches').upsert(launches.map((launch) => launchToRow(userId, launch)), { onConflict: 'user_id,launch_id', ignoreDuplicates: true })
  if (error) throw error
}

export async function createLaunch(client: Client, userId: string, launch: Launch) {
  const { data, error } = await client.from('launches').insert(launchToRow(userId, launch)).select('*').single()
  if (error) throw error
  return data as CloudLaunchRow
}

export async function updateLaunch(client: Client, userId: string, launch: Launch, expectedVersion: number) {
  const { data, error } = await client.from('launches').update({ ...launchToRow(userId, launch), version: expectedVersion + 1 }).eq('user_id', userId).eq('launch_id', launch.id).eq('version', expectedVersion).select('*').maybeSingle()
  if (error) throw error
  if (!data) throw new CloudConflictError()
  return data as CloudLaunchRow
}

export async function deleteLaunch(client: Client, userId: string, launchId: string, expectedVersion: number) {
  const { data, error } = await client.from('launches').delete().eq('user_id', userId).eq('launch_id', launchId).eq('version', expectedVersion).select('launch_id').maybeSingle()
  if (error) throw error
  if (!data) throw new CloudConflictError()
}

export async function savePreferences(client: Client, userId: string, preferences: CloudPreferences) {
  const { error } = await client.from('user_preferences').upsert({ user_id: userId, units: preferences.units, target_altitude: preferences.targetAltitude, planner_min_mass: preferences.plannerMinMass, planner_max_mass: preferences.plannerMaxMass, engine_version: preferences.engineVersion }, { onConflict: 'user_id' })
  if (error) throw error
}

export const defaultPreferences: WorkspacePreferences = { units: 'imperial', targetAltitude: 800, plannerMinMass: 500, plannerMaxMass: 700, engineVersion: 'current-v2' }
