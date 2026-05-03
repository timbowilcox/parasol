// Server-side auth utilities.
// All functions must be called from Server Components or server actions only.

import { redirect } from 'next/navigation'
import { createServerClient } from '@/lib/supabase/server'
import { ForbiddenError, UnauthorisedError } from '@parasol/core'

export interface AuthenticatedUser {
  id: string
  workspaceId: string
  role: 'owner' | 'admin' | 'member'
  isParasolAdmin: boolean
}

// Returns the authenticated user's profile or redirects to /login.
export async function requireAuth(): Promise<AuthenticatedUser> {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  const { data: profile, error } = await supabase
    .from('profiles')
    .select('workspace_id, role, is_parasol_admin')
    .eq('id', user.id)
    .single()

  if (error || !profile) {
    redirect('/login')
  }

  return {
    id: user.id,
    workspaceId: profile.workspace_id as string,
    role: profile.role as AuthenticatedUser['role'],
    isParasolAdmin: profile.is_parasol_admin as boolean,
  }
}

// Throws ForbiddenError (→ 404 in admin middleware) if user is not parasol_admin.
// CLAUDE.md: non-admins receive 404, not 403 (intentionally undiscoverable).
export async function requireAdmin(): Promise<AuthenticatedUser> {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    throw new UnauthorisedError()
  }

  const { data: profile, error } = await supabase
    .from('profiles')
    .select('workspace_id, role, is_parasol_admin')
    .eq('id', user.id)
    .single()

  if (error || !profile || !(profile.is_parasol_admin as boolean)) {
    // Return 404 to non-admins — the admin surface is intentionally undiscoverable
    throw new ForbiddenError()
  }

  return {
    id: user.id,
    workspaceId: profile.workspace_id as string,
    role: profile.role as AuthenticatedUser['role'],
    isParasolAdmin: true,
  }
}
