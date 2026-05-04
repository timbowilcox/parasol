// /review/[id] — Server component reading the persisted review + clauses
// + issues + citations and rendering the structured findings view.
//
// Auth: requireAuth() ensures the caller is signed in; RLS on the reviews
// table scopes the lookup to the caller's workspace, so a 404 here is
// indistinguishable from "review belongs to a different workspace" — by
// design.
//
// Polling: when the row is still 'pending' or 'processing', the page
// includes a meta refresh tag so the browser reloads every 5s until the
// orchestrator finishes. v2 (DEF-049) replaces this with an SSE / RSC
// stream.

import { notFound } from 'next/navigation'
import Link from 'next/link'
import { requireAuth } from '@/server/auth'
import { createServerClient } from '@/lib/supabase/server'
import {
  ReviewRepository,
  ExtractedClauseRepository,
  IssueRepository,
  CitationRepository,
  type IssueRow,
  type CitationRow,
} from '@parasol/core'

type RouteParams = { id: string }

export default async function ReviewPage({ params }: { params: Promise<RouteParams> }) {
  const { id } = await params
  await requireAuth()
  const supabase = await createServerClient()

  const reviewsRepo = new ReviewRepository(supabase)
  let review
  try {
    review = await reviewsRepo.getById(id)
  } catch {
    notFound()
  }

  if (review.status === 'pending' || review.status === 'processing') {
    return <ProcessingView reviewId={review.id} status={review.status} filename={review.original_filename} />
  }
  if (review.status === 'failed') {
    return <FailedView review={review} />
  }
  if (review.status === 'unsupported') {
    return <UnsupportedView review={review} />
  }

  // Completed — load the relational artefacts.
  const [clauses, issues] = await Promise.all([
    new ExtractedClauseRepository(supabase).listForReview(id),
    new IssueRepository(supabase).listForReview(id),
  ])
  const citations = issues.length > 0
    ? await new CitationRepository(supabase).listForIssues(issues.map((i) => i.id))
    : []
  const citationsByIssue = groupCitations(citations)
  const summary = countSeverities(issues)

  return (
    <main className="page">
      <h1 className="page-title">Review</h1>
      <p className="page-subtitle">
        {review.original_filename ?? 'Untitled contract'}
        {' · '}
        {review.contract_type ?? 'unknown contract type'}
        {' · '}
        Kenya
      </p>

      <div className="status-banner completed">Completed</div>

      <div className="summary-row">
        <Stat label="Critical" value={summary.critical} />
        <Stat label="Material" value={summary.material} />
        <Stat label="Minor" value={summary.minor} />
        <Stat label="Issues" value={issues.length} />
      </div>

      {review.redline_docx_base64 ? (
        <p>
          <a className="btn btn-primary" href={`/api/review/${review.id}/redline.docx`}>
            Download redlined .docx
          </a>
        </p>
      ) : null}

      <section style={{ marginTop: 24 }}>
        <h2 style={{ fontFamily: 'var(--font-serif)', fontWeight: 500 }}>Findings</h2>
        {issues.length === 0 ? (
          <div className="card">
            <p style={{ margin: 0 }}>No issues identified against the playbook.</p>
          </div>
        ) : (
          issues.map((issue) => (
            <IssueCard
              key={issue.id}
              issue={issue}
              citations={citationsByIssue.get(issue.id) ?? []}
            />
          ))
        )}
      </section>

      {clauses.length > 0 && (
        <section style={{ marginTop: 32 }}>
          <h2 style={{ fontFamily: 'var(--font-serif)', fontWeight: 500 }}>Extracted clauses</h2>
          <p className="page-subtitle" style={{ fontSize: 13 }}>
            Reference list of every clause the extractor identified, in
            document order.
          </p>
          <ul style={{ paddingLeft: 18 }}>
            {clauses.map((c) => (
              <li key={c.id}>
                <span className="citation" style={{ textDecoration: 'none' }}>{c.clause_id}</span>
                {' — '}
                {c.display_name}
                {c.section_reference ? ` (${c.section_reference})` : ''}
              </li>
            ))}
          </ul>
        </section>
      )}
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

function IssueCard({ issue, citations }: { issue: IssueRow; citations: CitationRow[] }) {
  return (
    <div className={`issue-card ${issue.severity}`}>
      <div className="issue-header">
        <span className={`severity-pill severity-${issue.severity}`}>{issue.severity}</span>
        <span className="issue-clause-id">{issue.clause_id}</span>
        <ConfidenceBadge confidence={issue.confidence} />
      </div>
      <div className="issue-section">
        <h4>Current position</h4>
        <p>{issue.current_position}</p>
      </div>
      <div className="issue-section">
        <h4>Recommended</h4>
        <p>{issue.recommended_position}</p>
      </div>
      <div className="issue-section">
        <h4>Reasoning</h4>
        <p>{issue.reasoning}</p>
      </div>
      {issue.redline_text && (
        <div className="issue-section">
          <h4>Proposed redline</h4>
          <p>{issue.redline_text}</p>
        </div>
      )}
      {citations.length > 0 && (
        <div className="issue-section">
          <h4>Authority</h4>
          <p>
            {citations.map((c, idx) => (
              <span key={c.id}>
                {idx > 0 && ' · '}
                <span className={`citation ${c.validated ? '' : 'unverified'}`}>
                  {c.display_text}
                </span>
              </span>
            ))}
          </p>
        </div>
      )}
    </div>
  )
}

function ConfidenceBadge({ confidence }: { confidence: IssueRow['confidence'] }) {
  const dotClass = confidence === 'high'
    ? 'confidence-high'
    : confidence === 'medium' ? 'confidence-medium' : 'confidence-manual'
  const label = confidence === 'high'
    ? 'High confidence'
    : confidence === 'medium' ? 'Medium confidence' : 'Manual review recommended'
  return (
    <span className="confidence">
      <span className={`confidence-dot ${dotClass}`} />
      {label}
    </span>
  )
}

function groupCitations(citations: readonly CitationRow[]): Map<string, CitationRow[]> {
  const map = new Map<string, CitationRow[]>()
  for (const c of citations) {
    const arr = map.get(c.issue_id) ?? []
    arr.push(c)
    map.set(c.issue_id, arr)
  }
  return map
}

function countSeverities(issues: readonly IssueRow[]) {
  return issues.reduce(
    (acc, i) => {
      acc[i.severity] += 1
      return acc
    },
    { critical: 0, material: 0, minor: 0 },
  )
}

// ─── Status views ─────────────────────────────────────────────────────────

function ProcessingView({
  reviewId,
  status,
  filename,
}: { reviewId: string; status: 'pending' | 'processing'; filename: string | null }) {
  return (
    <main className="page">
      {/* Auto-refresh every 5s while the pipeline runs. Replaced by SSE in v2. */}
      <meta httpEquiv="refresh" content="5" />
      <h1 className="page-title">Review</h1>
      <p className="page-subtitle">{filename ?? 'Untitled contract'}</p>
      <div className="status-banner">
        {status === 'pending'
          ? 'Queued · the orchestrator will pick this up momentarily.'
          : 'Identifying clauses, applying playbook, verifying citations…'}
      </div>
      <p className="page-subtitle" style={{ fontSize: 13 }}>
        This page refreshes every 5 seconds. Most NDAs complete within a minute.
      </p>
      <p style={{ marginTop: 32, fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-tertiary)' }}>
        review_id: {reviewId}
      </p>
    </main>
  )
}

function FailedView({ review }: { review: { id: string; original_filename: string | null; error_message: string | null } }) {
  return (
    <main className="page">
      <h1 className="page-title">Review</h1>
      <p className="page-subtitle">{review.original_filename ?? 'Untitled contract'}</p>
      <div className="status-banner failed">
        Processing failed: {review.error_message ?? 'unknown error'}
      </div>
      <p>
        <Link className="btn" href="/review/new">Try another upload</Link>
      </p>
    </main>
  )
}

function UnsupportedView({ review }: { review: { original_filename: string | null; error_message: string | null } }) {
  return (
    <main className="page">
      <h1 className="page-title">Review</h1>
      <p className="page-subtitle">{review.original_filename ?? 'Untitled contract'}</p>
      <div className="status-banner unsupported">
        Out of Sprint 1 scope: {review.error_message ?? 'unsupported document'}
      </div>
      <p>
        Sprint 1 supports Kenyan-jurisdiction NDAs in PDF, DOCX, or plain text.
        Other contract types are on the Sprint 2-7 roadmap.
      </p>
      <p>
        <Link className="btn" href="/review/new">Upload a different document</Link>
      </p>
    </main>
  )
}
