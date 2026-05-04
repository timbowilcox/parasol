// POST /api/admin/corpus/sources/[id]/run — Trigger an incremental
// ingestion run for a single corpus source.
//
// Sprint 1 scope: synchronous trigger that returns immediately after
// kicking off the ingestion in the background via after(). The handler
// resolves the source by id, finds the matching Scraper implementation,
// instantiates it, and hands it to ingestSource(). The client polls the
// runs list to observe progress.
//
// Auth: requireAdmin (CLAUDE.md — non-admins see 404). Every trigger
// writes an audit_log row in the admin.corpus.run_triggered namespace
// with the source id + slug + acting admin in the payload.
//
// DEF-018 (queue selection): Sprint 1 uses Vercel after() which keeps the
// function alive past the response boundary. Sprint 4 swaps in Inngest /
// Supabase Edge cron for the scheduled-cron path; the manual-trigger path
// here still uses after() because it's user-driven and one-shot.

import { NextResponse, type NextRequest, after } from 'next/server'
import {
  CorpusRepository,
  KenyaLawScraper,
  ingestSource,
  type Scraper,
} from '@parasol/corpus'
import { requireAdmin } from '@/server/auth'
import { createServerClient } from '@/lib/supabase/server'
import { adminAuthErrorResponse } from '../../route'
import { logAdminEvent, extractRequestContext } from '@/server/audit'

// Run-now is the only ingestion path with a manual trigger; the scheduled
// path runs from the cron handler (DEF-017). Same maxDuration ceiling as
// the contract pipeline — Vercel Pro caps at 300s but Sprint 1 holds at
// 120 while we measure.
export const maxDuration = 120

type RouteParams = { id: string }

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<RouteParams> },
): Promise<NextResponse> {
  let admin
  try {
    admin = await requireAdmin()
  } catch (cause) {
    return adminAuthErrorResponse(cause)
  }

  const { id } = await params
  const supabase = await createServerClient()
  const corpus = new CorpusRepository(supabase)

  // Resolve the source row to confirm it exists and to surface its slug
  // (the scraper factory is keyed by slug, not by id).
  const sources = await corpus.listSources()
  const source = sources.find((s) => s.id === id)
  if (!source) {
    return NextResponse.json({ error: 'source_not_found' }, { status: 404 })
  }

  let scraper: Scraper
  try {
    scraper = makeScraper(source.slug)
  } catch (cause) {
    return NextResponse.json(
      { error: 'no_scraper_for_slug', detail: (cause as Error).message },
      { status: 422 },
    )
  }

  const ctx = extractRequestContext(req)

  // Audit the trigger before kicking off — the run itself is asynchronous,
  // so the audit row is the durable record that the user pressed the button.
  await logAdminEvent({
    supabase,
    actorId: admin.id,
    workspaceId: null,                 // admin.corpus events are system-level
    action: 'admin.corpus.run_triggered',
    resourceType: 'corpus_source',
    resourceId: source.id,
    payload: { sourceSlug: source.slug, sourceName: source.name },
    ipAddress: ctx.ipAddress,
    userAgent: ctx.userAgent,
  })

  // Hand the heavy work off after the response. Vercel keeps the function
  // alive up to maxDuration; the run writes its progress to
  // corpus_ingestion_runs which the admin UI polls.
  after(async () => {
    try {
      const result = await ingestSource({
        scraper,
        repository: corpus,
        triggeredBy: admin.id,
        // Sprint 1: skip the heavy operations when the API key isn't
        // configured for the current environment. Production runs always
        // have both set.
        skipEmbedding: !process.env['VOYAGE_API_KEY'],
        skipTagging: !process.env['ANTHROPIC_API_KEY'],
      })
      await logAdminEvent({
        supabase,
        actorId: admin.id,
        workspaceId: null,
        action: 'admin.corpus.run_completed',
        resourceType: 'corpus_source',
        resourceId: source.id,
        payload: {
          sourceSlug: source.slug,
          documentsAdded: result.documentsAdded,
          documentsUpdated: result.documentsUpdated,
          errorCount: result.errors.length,
        },
      })
    } catch (cause) {
      console.error('admin.corpus.run_failed', {
        source_id: source.id,
        error: (cause as Error).message,
      })
      await logAdminEvent({
        supabase,
        actorId: admin.id,
        workspaceId: null,
        action: 'admin.corpus.run_failed',
        resourceType: 'corpus_source',
        resourceId: source.id,
        payload: { sourceSlug: source.slug, error: (cause as Error).message },
      })
    }
  })

  return NextResponse.json(
    { accepted: true, sourceSlug: source.slug },
    { status: 202 },
  )
}

// Map a corpus_sources.slug → Scraper implementation. Sprint 1 ships only
// the Kenya Law statutes scraper; Sprint 4 adds judgments + ODPC + KRA.
// Additional scrapers register here as they land.
function makeScraper(slug: string): Scraper {
  switch (slug) {
    case 'kenya-acts':
      return new KenyaLawScraper()
    default:
      throw new Error(`no scraper registered for slug "${slug}"`)
  }
}
