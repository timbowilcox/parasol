// /admin/corpus — Day 12 implementation.
//
// Read-only health summary, sources list, and recent runs panel, plus a
// per-source "Run now" trigger that posts to /api/admin/corpus/sources/
// [id]/run. Auth is enforced via requireAdmin (CLAUDE.md: non-admins
// receive 404 — undiscoverability over informativeness).
//
// Layout follows BRAND.md tokens already declared in globals.css. The
// status indicators use the severity ramps (healthy / warning / error)
// because corpus health is genuinely a severity-coded state.

import { notFound } from 'next/navigation'
import { ForbiddenError, UnauthorisedError } from '@parasol/core'
import { CorpusRepository } from '@parasol/corpus'
import { requireAdmin } from '@/server/auth'
import { createServerClient } from '@/lib/supabase/server'
import { RunNowButton } from './run-now-button'

export default async function CorpusAdminPage() {
  // CLAUDE.md: non-admins should not be able to discover this surface.
  // requireAdmin throws Unauthorised / Forbidden; we map both to 404.
  try {
    await requireAdmin()
  } catch (cause) {
    if (cause instanceof UnauthorisedError || cause instanceof ForbiddenError) {
      notFound()
    }
    throw cause
  }

  const supabase = await createServerClient()
  const corpus = new CorpusRepository(supabase)

  const [health, sources, runs] = await Promise.all([
    corpus.healthSummary(),
    corpus.listSources(),
    corpus.listRuns({ limit: 20 }),
  ])

  const sourceById = new Map(sources.map((s) => [s.id, s]))

  return (
    <main className="page">
      <h1 className="page-title">Corpus</h1>
      <p className="page-subtitle">
        Sources, ingestion runs, and health for the Kenyan corpus that
        backs every citation in a Parasol review.
      </p>

      <div className="summary-row">
        <Stat label="Documents" value={health.totalDocuments} />
        <Stat label="Chunks" value={health.totalChunks} />
        <Stat label="Healthy sources" value={health.healthySources} />
        <Stat label="Errored" value={health.erroredSources} />
      </div>

      <section style={{ marginTop: 24 }}>
        <h2 style={{ fontFamily: 'var(--font-serif)', fontWeight: 500, marginBottom: 12 }}>
          Sources
        </h2>
        {sources.length === 0 ? (
          <div className="card"><p style={{ margin: 0 }}>No sources configured yet.</p></div>
        ) : (
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Source</th>
                  <th>Jurisdiction</th>
                  <th>Status</th>
                  <th>Documents</th>
                  <th>Last run</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {sources.map((s) => (
                  <tr key={s.id}>
                    <td>
                      <div style={{ fontWeight: 500 }}>{s.name}</div>
                      <div style={{ color: 'var(--text-tertiary)', fontSize: 12, fontFamily: 'var(--font-mono)' }}>
                        {s.slug}
                      </div>
                    </td>
                    <td>{s.jurisdiction}</td>
                    <td><StatusPill status={s.status} /></td>
                    <td>{s.document_count}</td>
                    <td style={{ color: 'var(--text-secondary)' }}>
                      {s.last_run_at ? formatRelative(s.last_run_at) : 'Never'}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <RunNowButton sourceId={s.id} sourceName={s.name} disabled={s.status === 'running'} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section style={{ marginTop: 32 }}>
        <h2 style={{ fontFamily: 'var(--font-serif)', fontWeight: 500, marginBottom: 12 }}>
          Recent runs
        </h2>
        {runs.length === 0 ? (
          <div className="card"><p style={{ margin: 0 }}>No ingestion runs yet.</p></div>
        ) : (
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Source</th>
                  <th>Started</th>
                  <th>Status</th>
                  <th>Added</th>
                  <th>Updated</th>
                  <th>Errors</th>
                  <th>Duration</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((r) => {
                  const source = sourceById.get(r.source_id)
                  const errors = (r.errors as readonly unknown[] | null) ?? []
                  return (
                    <tr key={r.id}>
                      <td style={{ fontFamily: 'var(--font-mono)', fontSize: 13 }}>{source?.slug ?? r.source_id.slice(0, 8)}</td>
                      <td style={{ color: 'var(--text-secondary)' }}>{formatRelative(r.started_at)}</td>
                      <td><RunStatusPill status={r.status} /></td>
                      <td>{r.documents_added ?? 0}</td>
                      <td>{r.documents_updated ?? 0}</td>
                      <td>{errors.length}</td>
                      <td style={{ color: 'var(--text-secondary)' }}>{formatDuration(r.started_at, r.completed_at)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  )
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="summary-stat">
      <p className="summary-stat-label">{label}</p>
      <p className="summary-stat-value">{value}</p>
    </div>
  )
}

function StatusPill({ status }: { status: string }) {
  const cls = status === 'error'
    ? 'severity-critical'
    : status === 'warning'
      ? 'severity-material'
      : status === 'healthy' || status === 'running'
        ? 'severity-minor'
        : 'severity-minor'
  return <span className={`severity-pill ${cls}`}>{status}</span>
}

function RunStatusPill({ status }: { status: string }) {
  const cls = status === 'failed'
    ? 'severity-critical'
    : status === 'completed'
      ? 'severity-minor'
      : 'severity-minor'
  return <span className={`severity-pill ${cls}`}>{status}</span>
}

function formatRelative(iso: string): string {
  const t = new Date(iso).getTime()
  const diffSec = Math.floor((Date.now() - t) / 1000)
  if (diffSec < 60) return `${diffSec}s ago`
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`
  return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })
}

function formatDuration(startedAt: string, completedAt: string | null): string {
  if (!completedAt) return 'in flight'
  const ms = new Date(completedAt).getTime() - new Date(startedAt).getTime()
  if (ms < 1000) return `${ms}ms`
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`
  return `${Math.round(ms / 60_000)}m`
}
