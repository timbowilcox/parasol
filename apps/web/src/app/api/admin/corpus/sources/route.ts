// GET /api/admin/corpus/sources — Day 12 implementation.
//
// Returns the configured corpus_sources rows joined with the latest run
// metadata. Auth-gated to parasol_admin via requireAdmin (CLAUDE.md: non-
// admins receive 404, not 403 — undiscoverability over informativeness).
//
// POST is deferred to Sprint 2 — source creation requires playbook-coverage
// matrix sign-off; the corpus admin UI ships in read-only + run-now form.

import { NextResponse, type NextRequest } from 'next/server'
import { CorpusRepository } from '@parasol/corpus'
import { ForbiddenError, UnauthorisedError } from '@parasol/core'
import { requireAdmin } from '@/server/auth'
import { createServerClient } from '@/lib/supabase/server'

export async function GET(_req: NextRequest): Promise<NextResponse> {
  try {
    await requireAdmin()
  } catch (cause) {
    return adminAuthErrorResponse(cause)
  }

  const supabase = await createServerClient()
  const corpus = new CorpusRepository(supabase)
  const sources = await corpus.listSources()

  return NextResponse.json({ sources }, { status: 200 })
}

export async function POST(_req: NextRequest): Promise<NextResponse> {
  // Deferred per DEFERRED.md — Sprint 1 reads only. Source creation
  // requires playbook-coverage matrix sign-off; coverage tooling lands
  // in Sprint 2.
  return NextResponse.json(
    { error: 'not_implemented', message: 'Source creation deferred to Sprint 2.' },
    { status: 501 },
  )
}

// CLAUDE.md: parasol_admin is intentionally undiscoverable. Both
// "not signed in" and "signed in but not an admin" return 404 so the
// existence of the admin surface isn't leaked.
export function adminAuthErrorResponse(cause: unknown): NextResponse {
  if (cause instanceof UnauthorisedError || cause instanceof ForbiddenError) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }
  throw cause
}
