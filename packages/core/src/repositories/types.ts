import type { SupabaseClient as SupabaseClientGeneric } from '@supabase/supabase-js'
import type { Database } from '../db.js'

export type { Json } from '../db.js'

// Re-export the typed client so callers don't need to know about the Database
// generic. App code passes a SupabaseClient created via @supabase/ssr (which
// returns SupabaseClient<Database> when constructed with the Database generic).
export type SupabaseClient = SupabaseClientGeneric<Database>

export type Tables<T extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][T]['Row']

export type TablesInsert<T extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][T]['Insert']
