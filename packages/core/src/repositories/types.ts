import type { SupabaseClient as SupabaseClientGeneric } from '@supabase/supabase-js'
import type { Database } from '../db'

export type { Json } from '../db'

// Re-export the typed client. We allow the SchemaName generic to vary
// because the SSR client from @supabase/ssr surfaces 5 type params with a
// resolved schema literal, while a vanilla createClient<Database>(...) call
// from @supabase/supabase-js leaves SchemaName at its default. Both produce
// the same runtime behaviour; the looser generic just stops TypeScript
// from rejecting one when the other is expected.
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- intentional cross-flavour widening
export type SupabaseClient = SupabaseClientGeneric<Database, any, any>

export type Tables<T extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][T]['Row']

export type TablesInsert<T extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][T]['Insert']
