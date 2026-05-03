import type { SupabaseClient } from './types.js'

// All repositories receive a SupabaseClient at construction. The client is
// produced by the app layer (apps/web/src/lib/supabase/server.ts uses
// @supabase/ssr to attach Next.js cookies; non-Next contexts like the
// corpus ingestor or eval runner construct the raw client from
// @supabase/supabase-js with the service-role key only inside admin scripts).
//
// Repositories never construct their own client and never use the
// service_role key in app-facing code paths.
export abstract class BaseRepository {
  constructor(protected readonly supabase: SupabaseClient) {}
}
