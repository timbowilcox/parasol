// Process-review — the end-to-end orchestration helper for an email-intake
// review. Called from the /api/inbound/email route handler after the webhook
// has been verified, the workspace looked up, and the review row inserted in
// 'pending' status. Sprint 1 ships the email path only; the web upload path
// (Day 11) calls into the same helper.
//
// Responsibilities:
//   1. Move review → 'processing'
//   2. Pull attachment bytes from Resend
//   3. Extract pages (PDF / DOCX / text/plain)
//   4. Load + serialise the playbook (kenya/nda for Sprint 1)
//   5. Wire authority retriever + citation resolver against Supabase
//   6. Run the orchestrator
//   7. Send the reply email with the redlined DOCX attachment
//   8. Move review → 'completed' / 'unsupported' / 'failed' as appropriate
//
// Persistence of issues/citations/clauses to the relational tables is Day 11
// (web review page); Day 10 keeps the row minimal and surfaces results via
// the email reply only.

import {
  runOrchestrator,
  type AuthorityRetriever,
  type CitationResolver,
  type PageInput,
} from '@parasol/ai'
import { SPRINT_1_ACCEPTED_CONTRACT_TYPES } from '@parasol/ai'
import { CorpusRepository, retrieveAuthority, type AuthorityResult } from '@parasol/corpus'
import { loadPlaybook, serialisePlaybookForContext } from '@parasol/playbooks'
import { ReviewRepository } from '@parasol/core'
import type { Database } from '@parasol/core'
import type { SupabaseClient } from '@supabase/supabase-js'
import { extractPages } from '@/lib/intake/extract-pages.js'
import { fetchInboundAttachment, sendReply } from '@/lib/email/resend-send.js'
import { bindEventsToReview } from './pipeline-events.js'

export interface ProcessReviewInput {
  supabase: SupabaseClient<Database>
  reviewId: string
  workspaceId: string
  // The hashed sender stored on the review row is opaque; we need the raw
  // address to send the reply, so the route handler hands it through.
  replyTo: string
  emailMessageId: string                 // for In-Reply-To threading
  inboundEmailId: string                 // Resend's email_id for attachment fetch
  attachmentId: string | null            // null when no attachment present
  attachmentFilename: string | null
  originalSubject: string                // we prefix the reply with "Re: "
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

  // ── 1. Fetch the attachment bytes
  if (!input.attachmentId) {
    return finishFailed(reviews, input.reviewId, 'no_attachment', input)
  }
  const attachmentResp = await fetchInboundAttachment({
    emailId: input.inboundEmailId,
    attachmentId: input.attachmentId,
  })
  if (!attachmentResp.ok) {
    return finishFailed(reviews, input.reviewId, `attachment_fetch_failed: ${attachmentResp.detail}`, input)
  }

  // ── 2. Extract pages
  const extractResult = await extractPages({
    bytes: attachmentResp.bytes,
    mimeType: attachmentResp.contentType,
    filename: input.attachmentFilename ?? undefined,
  })
  if (!extractResult.ok) {
    return finishUnsupported(reviews, input, extractResult.detail)
  }

  // ── 3. Load + serialise the playbook
  // Sprint 1 always uses kenya/nda; once we ship more playbooks we'd defer
  // selection until after triage. The orchestrator gates on contract type
  // anyway, so loading the NDA playbook for a non-NDA document is wasted but
  // harmless (the gate fires before the cached system prefix matters).
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

  // ── 6. Unsupported branch — friendly explainer reply
  if (orchestratorResult.unsupported) {
    return finishUnsupported(reviews, input, orchestratorResult.unsupported.detail)
  }

  // ── 7. Send the reply with assembled output
  const assembled = orchestratorResult.assembled
  if (!assembled) {
    // Should be impossible — the orchestrator always populates `assembled`
    // on the production path. Treat as a failure rather than guess.
    return finishFailed(reviews, input.reviewId, 'orchestrator_returned_no_assembled_output', input)
  }

  const sendResult = await sendReply({
    to: input.replyTo,
    inReplyTo: input.emailMessageId,
    subject: buildReplySubject(input.originalSubject, assembled.email.subjectSuffix),
    text: assembled.email.plainText,
    html: assembled.email.html,
    attachments: [
      {
        filename: input.attachmentFilename
          ? input.attachmentFilename.replace(/\.(docx?|pdf|txt)$/i, '') + '-redlined.docx'
          : 'redlined.docx',
        contentBase64: assembled.redlineDocxBase64,
        contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      },
    ],
  })

  if (!sendResult.ok) {
    return finishFailed(reviews, input.reviewId, `reply_send_failed: ${sendResult.detail}`, input)
  }

  try {
    await reviews.updateStatus(input.reviewId, 'completed')
  } catch (cause) {
    // Reply has been sent successfully; if the status update fails the
    // review row stays in 'processing' but the customer has their result.
    // Log loudly — this needs follow-up, not silent failure.
    console.error('processReview.status_update_after_send_failed', {
      reviewId: input.reviewId,
      error: (cause as Error).message,
    })
  }

  return { ok: true, status: 'completed', replyMessageId: sendResult.id || null }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

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

  // Send a brief explainer so the sender isn't left waiting indefinitely.
  // We don't attach the redline DOCX (there isn't one) — just the message.
  const subject = buildReplySubject(input.originalSubject, 'Parasol — could not process')
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
    to: input.replyTo,
    inReplyTo: input.emailMessageId,
    subject,
    text,
    html,
  }).catch(() => undefined)

  return { ok: true, status: 'unsupported', replyMessageId: null }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]!))
}

// ─── Authority retriever (binds @parasol/corpus.retrieveAuthority to Supabase) ─

function buildAuthorityRetriever(supabase: SupabaseClient<Database>): AuthorityRetriever {
  return async ({ query, jurisdiction, topK }) => {
    if (jurisdiction === 'unknown') {
      // The retrieval RPC requires a single jurisdiction; default to kenya
      // for unknown-classified documents. The orchestrator only calls this
      // after triage has run, so this mostly fires for edge-case documents.
      jurisdiction = 'kenya'
    }
    // The retrieval module's SupabaseClient type is the un-generic one from
    // @supabase/supabase-js (corpus needs RPC access not on the strongly
    // typed Database). The cast at the boundary is the documented seam.
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

function buildCitationResolver(supabase: SupabaseClient<Database>): CitationResolver {
  const corpus = new CorpusRepository(supabase)
  return async (source: string, canonicalId: string) => {
    // Map citation source enum → corpus source_type enum. The mapping is
    // 1:1 for Sprint 1 (we only ship kenya-statute, kenya-case,
    // odpc-determination on the corpus side; the rest pass through and
    // either resolve or the validator marks them unresolved).
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
    // 'eac-treaty', 'market-norm', 'parasol-internal' have no corpus
    // mapping — the validator skips non-corpus sources upstream and
    // never invokes this resolver for them.
    default: return null
  }
}
