// GET /api/admin/corpus/runs — Day 12 implementation.
//
// Returns the most-recent corpus_ingestion_runs entries. Optional
// ?source=<uuid> filter narrows to a single source. Used by the admin
// dashboard's recent-runs panel; default limit (50) covers the last few
// days of activity at Sprint 1 cadence.

import { NextResponse, type NextRequest } from 'next/server'
import { CorpusRepository } from '@parasol/corpus'
import { requireAdmin } from '@/server/auth'
import { createServerClient } from '@/lib/supabase/server'
import { adminAuthErrorResponse } from '../sources/route'

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    await requireAdmin()
  } catch (cause) {
    return adminAuthErrorResponse(cause)
  }

  const url = new URL(req.url)
  const sourceId = url.searchParams.get('source') ?? undefined
  const limitParam = url.searchParams.get('limit')
  const limit = limitParam ? Math.max(1, Math.min(200, Number(limitParam))) : 50

  const supabase = await createServerClient()
  const corpus = new CorpusRepository(supabase)
  const runs = await corpus.listRuns({ limit, sourceId })

  return NextResponse.json({ runs }, { status: 200 })
}

export async function POST(_req: NextRequest): Promise<NextResponse> {
  // Manual run trigger lives at /api/admin/corpus/sources/[id]/run, not
  // here — keeping the URL ID-bound makes audit logs and idempotency
  // easier to reason about.
  return NextResponse.json(
    { error: 'not_implemented', message: 'Use POST /api/admin/corpus/sources/[id]/run.' },
    { status: 501 },
  )
}
