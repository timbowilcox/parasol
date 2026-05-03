/**
 * /admin/corpus — Corpus management surface
 *
 * Sprint 1 scope: read-only health summary, sources list, recent runs panel,
 * manual "Run now" trigger per source. Schedule editing and full Vercel Cron
 * integration deferred to Sprint 4 (DEF-017, DEF-018).
 *
 * Detailed spec: docs/admin-surfaces.md
 * Visual reference: parasol_corpus_admin artefact (chat 2026-05-03)
 *
 * Authorisation: middleware enforces parasol_admin role on /admin/*.
 * Non-admins receive 404 (intentionally undiscoverable).
 */
import { requireAdmin } from '@/server/auth';

export default async function CorpusAdminPage() {
  // Auth — 404 if not parasol_admin
  await requireAdmin();

  // TODO Sprint 1: implement
  // - Fetch health summary (total_documents, total_chunks, healthy_sources, pending_diffs)
  // - Fetch sources list with last_run_at, last_run_status, document_count
  // - Fetch recent runs (last 7 days)
  // - Render to match parasol_corpus_admin artefact design from chat 2026-05-03
  // - Wire "Run now" buttons to POST /api/admin/corpus/sources/[id]/run
  // - All admin actions log to audit_log with namespace admin.corpus.*
  // - Use BRAND.md design system; sentence case throughout; severity ramps for status only

  return null; // placeholder until Sprint 1 implementation
}
