// Supabase server client factory using @supabase/ssr.
// Use this in Server Components, server actions, and Route Handlers.
// Never use the service role key in app code per CLAUDE.md.

import { createServerClient as createSupabaseServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import type { Database } from '@parasol/core'

export async function createServerClient() {
  const cookieStore = await cookies()

  return createSupabaseServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(
          cookiesToSet: Array<{
            name: string
            value: string
            options?: Parameters<typeof cookieStore.set>[2]
          }>,
        ) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => {
              cookieStore.set(name, value, options)
            })
          } catch {
            // setAll called from a Server Component — cookies are read-only in that context.
            // The middleware handles session refresh in that case.
          }
        },
      },
    },
  )
}
