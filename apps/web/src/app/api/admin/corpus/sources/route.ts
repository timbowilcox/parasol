/**
 * Admin API: corpus sources
 *
 * GET   /api/admin/corpus/sources         List all configured sources with health
 * POST  /api/admin/corpus/sources         Create new source
 * PATCH /api/admin/corpus/sources/:id     Update source (enable/disable, schedule, params)
 *
 * SCAFFOLD STUB — Sprint 1 implements GET only. POST/PATCH deferred per DEFERRED.md.
 *
 * Auth: requires hub_admin role. Enforced via middleware (see apps/web/src/middleware.ts
 * once role-gating lands; for Sprint 1 use server-side getUser() and check role claim).
 *
 * See: docs/admin-surfaces.md (Corpus Health surface), docs/corpus-pipeline.md
 */

import { NextRequest, NextResponse } from 'next/server';

export async function GET(_req: NextRequest) {
  // TODO Sprint 1: implement using @parasol/corpus client to query corpus_sources
  // table and the corpus_runs view for last-run metadata. Filter by user role.
  return NextResponse.json(
    {
      error: 'not_implemented',
      message:
        'Sprint 1 task. Implementation: pull corpus_sources joined with last corpus_run per source. Return shape per docs/admin-surfaces.md.',
    },
    { status: 501 }
  );
}

export async function POST(_req: NextRequest) {
  // Deferred per DEFERRED.md — Sprint 1 reads only. Source creation requires
  // playbook-coverage matrix sign-off; coverage tooling lands in Sprint 2.
  return NextResponse.json(
    { error: 'not_implemented', message: 'Source creation deferred to Sprint 2.' },
    { status: 501 }
  );
}
