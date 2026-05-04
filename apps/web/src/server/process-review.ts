// Process-review — the end-to-end orchestration helper for both intake
// surfaces (email and web upload). Used by /api/inbound/email (Day 10) and
// /api/upload (Day 11).
//
// Responsibilities:
//   1. Move review → 'processing'
//   2. Acquire attachment bytes (from Resend for email, from the upload
//      multipart body for web)
//   3. Extract pages (PDF / DOCX / text/plain)
//   4. Load + serialise the playbook (kenya/nda for Sprint 1)
//   5. Wire authority retriever + citation resolver against Supabase
//   6. Run the orchestrator
//   7. Persist clauses / issues / citations / assembled artefacts
//   8. Send the reply email if this is the email path
//   9. Move review → 'completed' / 'unsupported' / 'failed'
//
// The persistence step (Day 11) writes the relational tables so /review/[id]
// can render without re-running the orchestrator. Day 10's email-only path
// is preserved by gating the Resend reply on `replyEmail` being set.

import {
  runOrchestrator,
  type AuthorityRetriever,
  type CitationResolver,
  type PageInput,
  type PipelineIssue,
  type PipelineCitation,
  type ExtractedClauseDraft,
  type AssembledOutput,
} from '@parasol/ai'
import { SPRINT_1_ACCEPTED_CONTRACT_TYPES } from '@parasol/ai'
import { CorpusRepository, retrieveAuthority, type AuthorityResult } from '@parasol/corpus'
import { loadPlaybook, serialisePlaybookForContext } from '@parasol/playbooks'
import {
  ReviewRepository,
  ExtractedClauseRepository,
  IssueRepository,
  CitationRepository,
  type CitationInsert,
  type IssueInsert,
} from '@parasol/core'
import type { Database } from '@parasol/core'
// Use the loosely-generic SupabaseClient type re-exported by @parasol/core,
// which accepts both the @supabase/supabase-js direct client (2-param
// generic) and the @supabase/ssr server client (5-param generic with a
// resolved schema literal). Without the loose alias the route handlers
// can't pass their SSR client into this helper.
import type { SupabaseClient } from '@parasol/core'
import { extractPages } from '@/lib/intake/extract-pages'
import { fetchInboundAttachment, sendReply } from '@/lib/email/resend-send'
import { bindEventsToReview } from './pipeline-events'

// Discriminated union over the two ways bytes arrive: from Resend's
// attachment endpoint (email path) or directly from the multipart upload
// body (web path).
export type AttachmentSource =
  | { kind: 'email'; inboundEmailId: string; attachmentId: string | null; filename: string | null }
  | { kind: 'inline'; bytes: Uint8Array; mimeType: string; filename: string }

// Email-reply parameters. Present on the email path; absent on the web path
// (the user is already at /review/[id], no need to email them their own
// upload back).
export interface EmailReplyParams {
  replyTo: string
  emailMessageId: string
  originalSubject: string
}

export interface ProcessReviewInput {
  supabase: SupabaseClient
  reviewId: string
  workspaceId: string
  attachment: AttachmentSource
  replyEmail?: EmailReplyParams       // omit for web uploads
}

export type ProcessReviewResult =
  | { ok: true; status: 'completed' | 'unsupported'; replyMessageId: string | null }
  | { ok: false; status: 'failed'; reason: string }

export async function processReview(input: ProcessReviewInput): Promise<ProcessReviewResult> {
  const reviews = new ReviewRepository(input.supabase)

  // Move to processing immediately so the UI / observability can see the run.
  try {
    await reviews.updateStatus(input.reviewId, 'processing')
  } catch (cause) {
    return { ok: false, status: 'failed', reason: `status_update_failed: ${(cause as Error).message}` }
  }

  // ── 1. Acquire attachment bytes
  const acquired = await acquireBytes(input.attachment)
  if (!acquired.ok) {
    return finishFailed(reviews, input.reviewId, acquired.reason, input)
  }

  // ── 2. Extract pages
  const extractResult = await extractPages({
    bytes: acquired.bytes,
    mimeType: acquired.mimeType,
    filename: acquired.filename ?? undefined,
  })
  if (!extractResult.ok) {
    return finishUnsupported(reviews, input, extractResult.detail)
  }

  // ── 3. Load + serialise the playbook
  let playbookContext: string
  try {
    const playbook = await loadPlaybook('kenya', 'nda')
    playbookContext = serialisePlaybookForContext(playbook)
  } catch (cause) {
    return finishFailed(reviews, input.reviewId, `playbook_load_failed: ${(cause as Error).message}`, input)
  }

  // ── 4. Wire the dependency-injected helpers
  const authority = buildAuthorityRetriever(input.supabase)
  const citation = buildCitationResolver(input.supabase)

  // ── 5. Run the orchestrator
  let orchestratorResult: Awaited<ReturnType<typeof runOrchestrator>>
  try {
    orchestratorResult = await runOrchestrator({
      reviewId: input.reviewId,
      workspaceId: input.workspaceId,
      pages: extractResult.pages satisfies PageInput[],
      acceptedContractTypes: SPRINT_1_ACCEPTED_CONTRACT_TYPES,
      playbookContext,
      retrieveAuthority: authority,
      resolveCitation: citation,
      emitEvent: bindEventsToReview({ supabase: input.supabase, reviewId: input.reviewId }),
    })
  } catch (cause) {
    return finishFailed(reviews, input.reviewId, `orchestrator_failed: ${(cause as Error).message}`, input)
  }

  // ── 6. Unsupported branch — friendly explainer reply (email path only)
  if (orchestratorResult.unsupported) {
    return finishUnsupported(reviews, input, orchestratorResult.unsupported.detail)
  }

  // ── 7. Persist clauses / issues / citations + assembled artefacts
  const assembled = orchestratorResult.assembled
  if (!assembled) {
    return finishFailed(reviews, input.reviewId, 'orchestrator_returned_no_assembled_output', input)
  }
  try {
    await persistOutputs(input.supabase, input.reviewId, {
      clauses: orchestratorResult.clauses ?? [],
      issues: orchestratorResult.issues,
      assembled,
    })
  } catch (cause) {
    return finishFailed(reviews, input.reviewId, `persistence_failed: ${(cause as Error).message}`, input)
  }

  // ── 8. Send the reply (email path only)
  let replyMessageId: string | null = null
  if (input.replyEmail) {
    const sendResult = await sendReply({
      to: input.replyEmail.replyTo,
      inReplyTo: input.replyEmail.emailMessageId,
      subject: buildReplySubject(input.replyEmail.originalSubject, assembled.email.subjectSuffix),
      text: assembled.email.plainText,
      html: assembled.email.html,
      attachments: [
        {
          filename: redlinedFilename(acquired.filename),
          contentBase64: assembled.redlineDocxBase64,
          contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        },
      ],
    })
    if (!sendResult.ok) {
      return finishFailed(reviews, input.reviewId, `reply_send_failed: ${sendResult.detail}`, input)
    }
    replyMessageId = sendResult.id || null
  }

  try {
    await reviews.updateStatus(input.reviewId, 'completed')
  } catch (cause) {
    // Persistence + send already succeeded; log loudly but don't fail the run.
    console.error('processReview.status_update_after_send_failed', {
      reviewId: input.reviewId,
      error: (cause as Error).message,
    })
  }

  return { ok: true, status: 'completed', replyMessageId }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

type AcquireBytesResult =
  | { ok: true; bytes: Uint8Array; mimeType: string; filename: string | null }
  | { ok: false; reason: string }

async function acquireBytes(source: AttachmentSource): Promise<AcquireBytesResult> {
  if (source.kind === 'inline') {
    return { ok: true, bytes: source.bytes, mimeType: source.mimeType, filename: source.filename }
  }
  // email path — fetch via Resend
  if (!source.attachmentId) {
    return { ok: false, reason: 'no_attachment' }
  }
  const fetched = await fetchInboundAttachment({
    emailId: source.inboundEmailId,
    attachmentId: source.attachmentId,
  })
  if (!fetched.ok) {
    return { ok: false, reason: `attachment_fetch_failed: ${fetched.detail}` }
  }
  return { ok: true, bytes: fetched.bytes, mimeType: fetched.contentType, filename: source.filename }
}

function redlinedFilename(originalFilename: string | null): string {
  if (!originalFilename) return 'redlined.docx'
  return originalFilename.replace(/\.(docx?|pdf|txt)$/i, '') + '-redlined.docx'
}

async function persistOutputs(
  supabase: SupabaseClient,
  reviewId: string,
  out: {
    clauses: readonly ExtractedClauseDraft[]
    issues: readonly PipelineIssue[]
    assembled: AssembledOutput
  },
): Promise<void> {
  // Clauses first — issues reference clause_id by string, but we keep the
  // structured row available for the review page.
  const clausesRepo = new ExtractedClauseRepository(supabase)
  await clausesRepo.insertMany(out.clauses.map((c, idx) => ({
    review_id: reviewId,
    clause_id: c.clauseId,
    display_name: c.displayName,
    // The extract-clauses stage doesn't currently emit clause_type; we infer
    // from clause_id at the playbook level instead. Leave null here.
    clause_type: null,
    raw_text: c.rawText,
    section_reference: c.sectionReference ?? null,
    clause_order: idx,
  })))

  // Issues — note: extracted_clause_id is left null in Sprint 1. The
  // mapping back to the inserted clause UUID would require a second pass;
  // the review page joins on clause_id (string) in the meantime.
  const issuesRepo = new IssueRepository(supabase)
  const issueInserts: IssueInsert[] = out.issues.map((iss, idx) => ({
    review_id: reviewId,
    extracted_clause_id: null,
    clause_id: iss.clauseId,
    severity: iss.severity,
    confidence: iss.confidence,
    current_position: iss.currentPosition,
    recommended_position: iss.recommendedPosition,
    reasoning: iss.reasoning,
    redline_text: iss.redlineText || null,
    issue_order: idx,
  }))
  const insertedIssues = await issuesRepo.insertMany(issueInserts)

  // Citations — flat insert, mapped to the freshly-issued issue ids.
  const citationsRepo = new CitationRepository(supabase)
  const citationInserts: CitationInsert[] = []
  insertedIssues.forEach((row, i) => {
    const sourceIssue = out.issues[i]
    if (!sourceIssue) return
    sourceIssue.citations.forEach((c: PipelineCitation) => {
      citationInserts.push({
        issue_id: row.id,
        corpus_chunk_id: null,
        source_type: c.source,
        canonical_id: c.id,
        section: c.section ?? null,
        display_text: formatCitationDisplay(c),
        // PipelineCitation doesn't carry a URL; the source_url column is
        // populated post-resolution against corpus_documents in v2 (DEF-049).
        source_url: null,
        validated: c.validated ?? false,
      })
    })
  })
  await citationsRepo.insertMany(citationInserts)

  // Assembled artefacts on the review row.
  const reviewsRepo = new ReviewRepository(supabase)
  await reviewsRepo.updateAssembled(reviewId, {
    redlineDocxBase64: out.assembled.redlineDocxBase64,
    webViewJson: out.assembled.webView,
    emailBodyJson: out.assembled.email,
  })
}

function formatCitationDisplay(c: PipelineCitation): string {
  // Compact human-readable form, e.g. "kenya-statute/1995/4 s.36".
  const base = `${c.source}/${c.id}`
  return c.section ? `${base} ${c.section}` : base
}

function buildReplySubject(originalSubject: string, suffix: string): string {
  const re = originalSubject.toLowerCase().startsWith('re:') ? originalSubject : `Re: ${originalSubject}`
  return `${re} — ${suffix}`
}

async function finishFailed(
  reviews: ReviewRepository,
  reviewId: string,
  reason: string,
  _input: ProcessReviewInput,
): Promise<ProcessReviewResult> {
  try {
    await reviews.updateStatus(reviewId, 'failed', reason)
  } catch {
    // Best-effort — the failure was already a failure.
  }
  return { ok: false, status: 'failed', reason }
}

async function finishUnsupported(
  reviews: ReviewRepository,
  input: ProcessReviewInput,
  detail: string,
): Promise<ProcessReviewResult> {
  await reviews.updateStatus(input.reviewId, 'unsupported', detail).catch(() => undefined)

  // Email path: send an explainer so the sender knows why we couldn't help.
  // Web path: the upload UI polls status and surfaces the unsupported reason
  // inline; no email needed.
  if (input.replyEmail) {
    const subject = buildReplySubject(input.replyEmail.originalSubject, 'Parasol — could not process')
    const text = [
      'Thanks for sending this contract to Parasol.',
      '',
      'We were unable to process it: ' + detail,
      '',
      'Sprint 1 supports Kenyan-jurisdiction NDAs in PDF, DOCX, or plain text format.',
      'If you believe this was sent in error, please reply to this email.',
    ].join('\n')
    const html = `<!doctype html><html><body><p>Thanks for sending this contract to Parasol.</p>` +
      `<p>We were unable to process it: ${escapeHtml(detail)}.</p>` +
      `<p>Sprint 1 supports Kenyan-jurisdiction NDAs in PDF, DOCX, or plain text format. ` +
      `If you believe this was sent in error, please reply to this email.</p></body></html>`

    await sendReply({
      to: input.replyEmail.replyTo,
      inReplyTo: input.replyEmail.emailMessageId,
      subject,
      text,
      html,
    }).catch(() => undefined)
  }

  return { ok: true, status: 'unsupported', replyMessageId: null }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]!))
}

// ─── Authority retriever (binds @parasol/corpus.retrieveAuthority to Supabase) ─

function buildAuthorityRetriever(supabase: SupabaseClient): AuthorityRetriever {
  return async ({ query, jurisdiction, topK }) => {
    if (jurisdiction === 'unknown') {
      jurisdiction = 'kenya'
    }
    const results = await retrieveAuthority(
      query,
      { jurisdictions: [jurisdiction], topK: topK ?? 8 },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- corpus retrieval boundary
      { supabase: supabase as any },
    )
    return results.map((r: AuthorityResult) => r.textWithContext)
  }
}

// ─── Citation resolver (looks up corpus_documents by source/canonical_id) ─

function buildCitationResolver(supabase: SupabaseClient): CitationResolver {
  const corpus = new CorpusRepository(supabase)
  return async (source: string, canonicalId: string) => {
    const sourceType = mapCitationSource(source)
    if (!sourceType) return false
    const doc = await corpus.findLatestDocument(sourceType, 'kenya', canonicalId)
    return doc !== null
  }
}

function mapCitationSource(source: string): string | null {
  switch (source) {
    case 'kenya-statute': return 'statute'
    case 'kenya-case': return 'case'
    case 'kenya-regulation': return 'regulation'
    case 'odpc-determination': return 'odpc_determination'
    case 'kra-ruling': return 'kra_ruling'
    case 'cbk-circular': return 'cbk_circular'
    case 'cma-notice': return 'cma_notice'
    default: return null
  }
}

