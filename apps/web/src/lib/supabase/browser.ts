// Supabase browser client factory using @supabase/ssr.
// Use this in Client Components and browser-only utilities.
// Reads NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY from env;
// these are safe to expose (anon key is RLS-gated).

import { createBrowserClient as createSupabaseBrowserClient } from '@supabase/ssr'
import type { Database } from '@parasol/core'

export function createBrowserClient() {
  return createSupabaseBrowserClient<Database>(
    process.env['NEXT_PUBLIC_SUPABASE_URL']!,
    process.env['NEXT_PUBLIC_SUPABASE_ANON_KEY']!,
  )
}
