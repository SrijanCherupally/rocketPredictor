export type Database = {
  public: {
    Tables: {
      launches: {
        Row: {
          user_id: string; launch_id: string; date: string; altitude: number; flight_time: number; descent_time: number
          parachute_size: number; rocket_mass: number; wind_speed: number; air_pressure: number; humidity: number
          temperature: number; notes: string; version: number; created_at: string; updated_at: string; rocket_id: string | null
        }
        Insert: Omit<Database['public']['Tables']['launches']['Row'], 'created_at' | 'updated_at' | 'rocket_id' | 'version'> & { version?: number; rocket_id?: string | null }
        Update: Partial<Database['public']['Tables']['launches']['Insert']>
        Relationships: []
      }
      user_preferences: {
        Row: { user_id: string; units: 'imperial' | 'metric'; target_altitude: number; planner_min_mass: number; planner_max_mass: number; engine_version: 'legacy-v1' | 'current-v2'; updated_at: string }
        Insert: Omit<Database['public']['Tables']['user_preferences']['Row'], 'updated_at'>
        Update: Partial<Database['public']['Tables']['user_preferences']['Insert']>
        Relationships: []
      }
    }
    Views: Record<string, never>
    Functions: Record<string, never>
    Enums: Record<string, never>
    CompositeTypes: Record<string, never>
  }
}
