// Server-side auth utilities.
// All functions must be called from Server Components or server actions only.

import { redirect } from 'next/navigation'
import { createServerClient } from '@/lib/supabase/server'
import { ForbiddenError, UnauthorisedError, type ProfileRow } from '@parasol/core'

export interface AuthenticatedUser {
  id: string
  workspaceId: string
  role: 'owner' | 'admin' | 'member'
  isParasolAdmin: boolean
}

// Fetches the authenticated user's profile, returning null if the session
// is invalid or the profile row is missing. Used by both requireAuth (which
// redirects on null) and requireAdmin (which throws on null).
async function loadProfile(): Promise<{ userId: string; profile: ProfileRow } | null> {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single()

  if (error || !data) return null
  return { userId: user.id, profile: data as ProfileRow }
}

// Returns the authenticated user's profile or redirects to /login.
export async function requireAuth(): Promise<AuthenticatedUser> {
  const result = await loadProfile()
  if (!result) {
    redirect('/login')
  }
  return {
    id: result.userId,
    workspaceId: result.profile.workspace_id,
    role: result.profile.role,
    isParasolAdmin: result.profile.is_parasol_admin,
  }
}

// Throws ForbiddenError (→ 404 in admin middleware) if user is not parasol_admin.
// CLAUDE.md: non-admins receive 404, not 403 (intentionally undiscoverable).
export async function requireAdmin(): Promise<AuthenticatedUser> {
  const result = await loadProfile()
  if (!result) {
    throw new UnauthorisedError()
  }
  if (!result.profile.is_parasol_admin) {
    throw new ForbiddenError()
  }
  return {
    id: result.userId,
    workspaceId: result.profile.workspace_id,
    role: result.profile.role,
    isParasolAdmin: true,
  }
}
