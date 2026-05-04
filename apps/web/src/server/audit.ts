// Audit-log convenience for the web app.
//
// Wraps AuditRepository.appendEvent with a helper that pre-fills the actor
// id from the current Supabase session, captures the request's IP +
// user-agent for forensic context, and surfaces failures via console.error
// rather than throwing — an audit-write failure must not abort the
// underlying operation, but it must be loud.
//
// The CLAUDE.md "no PII in logs" rule applies to console output, not to
// the audit table itself. The audit table is the authorised system of
// record for who did what; raw user identifiers belong there.

import { AuditRepository, type SupabaseClient } from '@parasol/core'

export interface AdminAuditInput {
  supabase: SupabaseClient
  actorId: string                  // resolved by requireAdmin / requireAuth
  workspaceId: string | null       // null for system-level admin events
  action: string                   // namespaced — admin.corpus.run_triggered, etc.
  resourceType?: string
  resourceId?: string
  payload?: Record<string, unknown>
  ipAddress?: string | null
  userAgent?: string | null
}

export async function logAdminEvent(input: AdminAuditInput): Promise<void> {
  const repo = new AuditRepository(input.supabase)
  try {
    await repo.appendEvent({
      workspaceId: input.workspaceId,
      actorId: input.actorId,
      action: input.action,
      resourceType: input.resourceType ?? null,
      resourceId: input.resourceId ?? null,
      payload: (input.payload ?? {}) as never,
      ipAddress: input.ipAddress ?? null,
      userAgent: input.userAgent ?? null,
    })
  } catch (cause) {
    console.error('audit.append_failed', {
      action: input.action,
      actor: input.actorId,
      error: (cause as Error).message,
    })
  }
}

// Convenience extractor for a NextRequest's forwarding headers. Returns the
// first IP in the X-Forwarded-For chain (Vercel injects this) plus the
// User-Agent. Both nullable so callers don't have to special-case missing.
export function extractRequestContext(req: { headers: Headers }): {
  ipAddress: string | null
  userAgent: string | null
} {
  const xff = req.headers.get('x-forwarded-for')
  const ipAddress = xff ? (xff.split(',')[0] ?? '').trim() || null : null
  const userAgent = req.headers.get('user-agent')
  return { ipAddress, userAgent }
}
