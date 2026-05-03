/**
 * Admin API: corpus runs
 *
 * GET  /api/admin/corpus/runs              Recent ingestion run log (paginated)
 * GET  /api/admin/corpus/runs?source=:id   Filter to specific source
 * POST /api/admin/corpus/runs              Trigger manual run for a source
 *
 * SCAFFOLD STUB — Sprint 1 implements GET only.
 *
 * See: docs/admin-surfaces.md (Corpus Health surface), docs/corpus-pipeline.md
 */

import { NextRequest, NextResponse } from 'next/server';

export async function GET(_req: NextRequest) {
  // TODO Sprint 1: query corpus_runs table, latest 50 by default, optional
  // ?source=<id> filter, ?limit=<n>, ?cursor=<id> for pagination.
  // Return shape includes: run_id, source_id, started_at, completed_at, status,
  // documents_added, documents_updated, documents_skipped, error_summary.
  return NextResponse.json(
    {
      error: 'not_implemented',
      message: 'Sprint 1 task. Implementation per docs/admin-surfaces.md.',
    },
    { status: 501 }
  );
}

export async function POST(_req: NextRequest) {
  // Manual run trigger — Sprint 2 task. Requires job queue (consider Inngest or
  // Supabase Edge Functions cron + pg_cron). DEFERRED.md DEF-018 for ingestion
  // queue selection.
  return NextResponse.json(
    { error: 'not_implemented', message: 'Manual run trigger deferred to Sprint 2.' },
    { status: 501 }
  );
}
