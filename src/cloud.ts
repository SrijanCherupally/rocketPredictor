import type { SupabaseClient } from '@supabase/supabase-js'
import type { Launch } from './analytics'

export type CloudLaunchRow = {
  user_id: string
  launch_id: string
  rocket_id: string | null
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

export type Rocket = {
  id: string
  name: string
  description: string | null
  createdAt: string
}

export type RocketRow = {
  id: string
  user_id: string
  name: string
  description: string | null
  created_at: string
  updated_at: string
}

export class CloudConflictError extends Error {
  constructor(message = 'This flight changed on another device.') {
    super(message)
    this.name = 'CloudConflictError'
  }
}

type Client = SupabaseClient

// ---------------------------------------------------------------------------
// Launch <-> Row mappers
// ---------------------------------------------------------------------------

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

const launchToRow = (userId: string, launch: Launch, rocketId: string) => ({
  user_id: userId,
  launch_id: launch.id,
  rocket_id: rocketId,
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

// ---------------------------------------------------------------------------
// Rockets
// ---------------------------------------------------------------------------

export async function fetchRockets(client: Client, userId: string) {
  try {
    const { data, error } = await client
      .from('rockets')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: true })

    if (error) {
      if (error.message?.includes('schema cache')) return []
      throw error
    }

    return (data ?? []).map((row: RocketRow): Rocket => ({
      id: row.id,
      name: row.name,
      description: row.description,
      createdAt: row.created_at,
    }))
  } catch (err) {
    if (err instanceof Error && err.message?.includes('schema cache')) {
      console.warn('Schema cache error, treating as new user')
      return []
    }
    throw err
  }
}

export async function createRocket(
  client: Client,
  userId: string,
  name: string,
  description?: string,
): Promise<Rocket> {
  const MAX_RETRIES = 2
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const { data, error } = await client
        .from('rockets')
        .insert({ user_id: userId, name, description: description ?? null })
        .select('*')
        .single()

      if (error) throw error
      const rocket = data as RocketRow

      // Rocket preferences (target altitude) live in their own table.
      const { error: prefError } = await client
        .from('rocket_preferences')
        .insert({ rocket_id: rocket.id, target_altitude: 800 })

      if (prefError) throw prefError

      return {
        id: rocket.id,
        name: rocket.name,
        description: rocket.description,
        createdAt: rocket.created_at,
      }
    } catch (err) {
      if (
        attempt < MAX_RETRIES - 1 &&
        err instanceof Error &&
        err.message?.includes('schema cache')
      ) {
        console.warn(`Schema cache error on rocket create, retrying (${attempt + 1})…`)
        await new Promise((resolve) => setTimeout(resolve, 1000))
        continue
      }
      throw err
    }
  }
  // Should not reach here, but satisfy TypeScript
  throw new Error('createRocket: max retries exceeded')
}

export async function updateRocket(
  client: Client,
  userId: string,
  rocketId: string,
  name: string,
  description?: string,
): Promise<Rocket> {
  const { data, error } = await client
    .from('rockets')
    .update({ name, description: description ?? null })
    .eq('id', rocketId)
    .eq('user_id', userId)
    .select('*')
    .single()

  if (error) throw error
  const rocket = data as RocketRow
  return {
    id: rocket.id,
    name: rocket.name,
    description: rocket.description,
    createdAt: rocket.created_at,
  }
}

export async function deleteRocket(
  client: Client,
  userId: string,
  rocketId: string,
): Promise<void> {
  // Cascade delete removes rocket_preferences and all associated launches.
  const { error } = await client
    .from('rockets')
    .delete()
    .eq('id', rocketId)
    .eq('user_id', userId)

  if (error) throw error
}

// ---------------------------------------------------------------------------
// Rocket preferences
// ---------------------------------------------------------------------------

export async function fetchRocketPreferences(
  client: Client,
  rocketId: string,
): Promise<{ targetAltitude: number }> {
  const { data, error } = await client
    .from('rocket_preferences')
    .select('target_altitude')
    .eq('rocket_id', rocketId)
    .maybeSingle()

  if (error) throw error
  return { targetAltitude: data?.target_altitude ?? 800 }
}

export async function saveRocketPreferences(
  client: Client,
  rocketId: string,
  targetAltitude: number,
): Promise<void> {
  const { error } = await client
    .from('rocket_preferences')
    .upsert({ rocket_id: rocketId, target_altitude: targetAltitude }, { onConflict: 'rocket_id' })

  if (error) throw error
}

// ---------------------------------------------------------------------------
// User preferences (global — units only)
// ---------------------------------------------------------------------------

export async function saveUserPreferences(
  client: Client,
  userId: string,
  units: 'imperial' | 'metric',
): Promise<void> {
  const { error } = await client
    .from('user_preferences')
    .upsert({ user_id: userId, units }, { onConflict: 'user_id' })

  if (error) throw error
}

export async function fetchUserPreferences(
  client: Client,
  userId: string,
): Promise<{ units: 'imperial' | 'metric' } | null> {
  const { data, error } = await client
    .from('user_preferences')
    .select('units')
    .eq('user_id', userId)
    .maybeSingle()

  if (error) throw error
  if (!data) return null
  return { units: data.units ?? 'imperial' }
}

// ---------------------------------------------------------------------------
// Rocket data (launches + preferences for one rocket)
// ---------------------------------------------------------------------------

export async function fetchRocketData(
  client: Client,
  userId: string,
  rocketId: string,
) {
  const [launchResult, prefResult] = await Promise.all([
    client
      .from('launches')
      .select('*')
      .eq('user_id', userId)
      .eq('rocket_id', rocketId)
      .order('date', { ascending: true }),

    client
      .from('rocket_preferences')
      .select('target_altitude')
      .eq('rocket_id', rocketId)
      .maybeSingle(),
  ])

  if (launchResult.error) throw launchResult.error
  if (prefResult.error) throw prefResult.error

  const rows = (launchResult.data ?? []) as CloudLaunchRow[]
  const prefs = prefResult.data as { target_altitude?: number } | null

  return {
    launches: rows.map(rowToLaunch),
    versions: Object.fromEntries(rows.map((row) => [row.launch_id, row.version])),
    targetAltitude: prefs?.target_altitude ?? 800,
  }
}

// ---------------------------------------------------------------------------
// Legacy launches (rocket_id IS NULL — pre-rockets user)
// ---------------------------------------------------------------------------

/**
 * Finds launches belonging to a user that are not yet assigned to any rocket.
 * These are legacy launches from before the rockets feature was added.
 */
export async function fetchLegacyLaunches(
  client: Client,
  userId: string,
): Promise<Launch[]> {
  const { data, error } = await client
    .from('launches')
    .select('*')
    .eq('user_id', userId)
    .is('rocket_id', null)
    .order('date', { ascending: true })

  if (error) throw error
  return (data as CloudLaunchRow[]).map(rowToLaunch)
}

/**
 * Re-assigns a batch of legacy launches to a rocket.
 */
export async function assignLaunchesToRocket(
  client: Client,
  userId: string,
  launchIds: string[],
  rocketId: string,
): Promise<void> {
  if (launchIds.length === 0) return

  const { error } = await client
    .from('launches')
    .update({ rocket_id: rocketId })
    .eq('user_id', userId)
    .in('launch_id', launchIds)

  if (error) throw error
}

// ---------------------------------------------------------------------------
// Launches (all require a rocket)
// ---------------------------------------------------------------------------

export async function createLaunch(
  client: Client,
  userId: string,
  launch: Launch,
  rocketId: string,
): Promise<CloudLaunchRow> {
  const { data, error } = await client
    .from('launches')
    .insert(launchToRow(userId, launch, rocketId))
    .select('*')
    .single()

  if (error) throw error
  return data as CloudLaunchRow
}

export async function updateLaunch(
  client: Client,
  userId: string,
  launch: Launch,
  rocketId: string,
  expectedVersion: number,
): Promise<CloudLaunchRow> {
  const { data, error } = await client
    .from('launches')
    .update({ ...launchToRow(userId, launch, rocketId), version: expectedVersion + 1 })
    .eq('user_id', userId)
    .eq('launch_id', launch.id)
    .eq('rocket_id', rocketId)
    .eq('version', expectedVersion)
    .select('*')
    .maybeSingle()

  if (error) throw error
  if (!data) throw new CloudConflictError()
  return data as CloudLaunchRow
}

export async function deleteLaunch(
  client: Client,
  userId: string,
  launchId: string,
  rocketId: string,
  expectedVersion: number,
): Promise<void> {
  const { data, error } = await client
    .from('launches')
    .delete()
    .eq('user_id', userId)
    .eq('launch_id', launchId)
    .eq('rocket_id', rocketId)
    .eq('version', expectedVersion)
    .select('launch_id')
    .maybeSingle()

  if (error) throw error
  if (!data) throw new CloudConflictError()
}

// ---------------------------------------------------------------------------
// Local → Cloud import (requires a rocket)
// ---------------------------------------------------------------------------

export async function importLaunches(
  client: Client,
  userId: string,
  launches: Launch[],
  rocketId: string,
): Promise<void> {
  if (launches.length === 0) return

  const { error } = await client
    .from('launches')
    .upsert(launches.map((launch) => launchToRow(userId, launch, rocketId)), {
      onConflict: 'user_id,launch_id',
    })

  if (error) throw error
}
