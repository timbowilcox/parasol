// Orchestrator — Sprint 1 days 7+8.
//
// Stages 1-8 are wired:
//   1. quality-assess           (Haiku)
//   2. extract-text-clean       (Haiku)  — or 2b extract-text-degraded (Sonnet vision)
//   3. triage                   (Haiku)
//   4. extract-clauses          (Haiku)
//   5. compare-playbook         (Sonnet, playbook context cached)
//   6. retrieve-authority       (deterministic; calls @parasol/corpus via DI)
//   7. generate-redline         (Sonnet, per-deviation, playbook + authority cached)
//   8. verify-citations         (deterministic; calibrates confidence on failure)
//
// Stage 9 (defined-terms-check) and 10 (assemble-output) land Day 9.
// Until then, OrchestratorRunResult.redlineDocxBase64 is undefined and
// the route handler / eval runner reads issues + citations directly.
//
// The shape of OrchestratorRunResult.issues mirrors the eval harness's
// PipelineOutput, so once Day 9 ships, eval --pipeline=production runs
// runOrchestrator() and maps the result.

import type {
  ContractType,
  Jurisdiction,
} from '@parasol/core'
import { UnsupportedContractTypeError, PipelineError } from '@parasol/core'
import type { OrchestratorContext, PipelineEvent, ModelEnv } from './types.js'
import {
  qualityAssessStage,
  extractTextCleanStage,
  extractTextDegradedStage,
  triageStage,
  extractClausesStage,
  comparePlaybookStage,
  generateRedlineStage,
  definedTermsCheckStage,
  type PageInput,
  type QualityAssessOutput,
  type ExtractTextCleanOutput,
  type TriageOutput,
  type ExtractedClauseDraft,
  type PipelineIssue,
  type PipelineCitation,
  type PlaybookDeviation,
  type DefinedTermIssue,
  type AssembledOutput,
} from './stages/index.js'
import {
  validateCitations,
  type CitationResolver,
  type ValidationOutcome,
} from './citation-validator.js'
import { assembleOutput } from './assemble-output.js'

// ─── Dependency-injected helpers (provided by the caller) ───────────────────
//
// @parasol/ai deliberately does NOT depend on @parasol/corpus or
// @parasol/playbooks (would create a workspace cycle). Instead the caller
// (route handler / eval runner) constructs these helpers and passes them in.

// Authority retriever — wraps @parasol/corpus.retrieveAuthority. Returns
// short text snippets the orchestrator caches as authority chunks for the
// generate-redline call. Limit is per-deviation; default 8 chunks per call
// keeps the input prompt under Anthropic's per-request limit even for the
// chattiest playbook clauses.
export type AuthorityRetriever = (input: {
  query: string
  jurisdiction: Jurisdiction | 'unknown'
  clauseId: string
  topK?: number
}) => Promise<string[]>

// ─── Orchestrator input / output ────────────────────────────────────────────

export interface OrchestratorInput {
  reviewId: string
  workspaceId: string
  // Pages already split + (where possible) text-extracted by intake plumbing.
  pages: PageInput[]
  // Workspace's contract-type allowlist. Documents whose triage classifies
  // outside this set are rejected with a friendly reply (handled upstream).
  acceptedContractTypes: readonly ContractType[]
  // Pre-serialised playbook content (use serialisePlaybookForContext from
  // @parasol/playbooks). Cached in the system prefix for stages 5 + 7.
  // null skips compare-playbook + downstream — useful for stages-1-4-only
  // runs (the harness in Day 6 stub-mode does this).
  playbookContext?: string | null
  // Function to retrieve corpus authority chunks for a deviation.
  // Wired by the caller against @parasol/corpus. null skips retrieval and
  // generate-redline runs without authority context (citations rely on
  // playbook references only — confidence will calibrate down).
  retrieveAuthority?: AuthorityRetriever | null
  // Function to resolve a citation's canonical_id against corpus_documents.
  // Wired by the caller against Supabase. null skips the deterministic
  // verification step; citations remain validated=false from the model.
  resolveCitation?: CitationResolver | null
  // Optional model env override (Sprint 2 A/B per DEF-041).
  modelEnv?: ModelEnv
  // Optional event sink. The orchestrator forwards every PipelineEvent
  // here; the route handler attaches a Supabase-writing implementation.
  emitEvent?: (event: PipelineEvent) => void
}

export interface OrchestratorRunResult {
  reviewId: string
  // Set when the document failed gating before the heavy stages ran.
  unsupported?: { reason: 'unsupported_contract_type' | 'unsupported_jurisdiction' | 'unparseable'; detail: string }
  // Stages 1-4 (always present once the pipeline got past quality-assess).
  quality?: QualityAssessOutput
  extractedText?: ExtractTextCleanOutput
  triage?: TriageOutput
  clauses?: ExtractedClauseDraft[]
  // Stages 5-8 — present when the production path was taken.
  deviations?: PlaybookDeviation[]
  issues: PipelineIssue[]
  citations: PipelineCitation[]
  citationValidation?: ValidationOutcome
  // Stage 9 (defined-terms-check) — present when the production path ran.
  // Empty array when the stage failed (best-effort; not pipeline-blocking).
  definedTerms?: DefinedTermIssue[]
  // Stage 10 (assemble-output) — present when the production path ran. The
  // route handler reads `assembled.redlineDocxBase64` to upload to Storage,
  // `assembled.email` for the Resend reply, `assembled.webView` for the
  // /review/[id] React page hydration.
  assembled?: AssembledOutput
}

// ─── runOrchestrator ────────────────────────────────────────────────────────

export async function runOrchestrator(input: OrchestratorInput): Promise<OrchestratorRunResult> {
  const events: PipelineEvent[] = []
  const ctx: OrchestratorContext = {
    reviewId: input.reviewId,
    workspaceId: input.workspaceId,
    jurisdiction: 'kenya',
    contractType: 'unknown',
    playbookContext: input.playbookContext ?? null,
    authorityChunks: [],
    emitEvent: (e) => {
      events.push(e)
      input.emitEvent?.(e)
    },
    modelEnv: input.modelEnv,
  }

  // ── Stage 1: quality-assess
  const quality = await qualityAssessStage.run({ pages: input.pages }, ctx)

  // ── Stage 2 / 2b: extract-text — route based on quality
  const extractedText = quality.recommendedRoute === 'clean'
    ? await extractTextCleanStage.run({ pages: input.pages }, ctx)
    : await extractTextDegradedStage.run({ pages: input.pages }, ctx)

  // ── Stage 3: triage — gate the pipeline on contract-type acceptance
  const triage = await triageStage.run({ fullText: extractedText.fullText }, ctx)
  ctx.contractType = triage.contractType
  ctx.jurisdiction = triage.jurisdiction === 'unknown' ? 'kenya' : triage.jurisdiction

  if (triage.contractType === 'unknown' || !input.acceptedContractTypes.includes(triage.contractType as ContractType)) {
    return {
      reviewId: input.reviewId,
      unsupported: {
        reason: 'unsupported_contract_type',
        detail: `triage classified contract as "${triage.contractType}"; Sprint 1 only supports ${input.acceptedContractTypes.join(', ')}`,
      },
      quality,
      extractedText,
      triage,
      issues: [],
      citations: [],
    }
  }

  // ── Stage 4: extract-clauses
  const clauseOut = await extractClausesStage.run({
    fullText: extractedText.fullText,
    contractType: triage.contractType as ContractType,
  }, ctx)

  // If the caller didn't supply playbook context, stop here. Stages 5+
  // need the playbook to produce meaningful output. The eval harness's
  // stub-oracle path runs without a playbook by design; production runs
  // always supply one.
  if (!ctx.playbookContext) {
    return {
      reviewId: input.reviewId,
      quality,
      extractedText,
      triage,
      clauses: clauseOut.clauses,
      issues: [],
      citations: [],
    }
  }

  // ── Stage 5: compare-playbook
  // Note: orchestration.md describes stage 9 (defined-terms-check) as running
  // in parallel to stages 5-7. Sprint 1 runs them sequentially for two
  // reasons: (a) it makes deterministic mock-based tests possible, (b) the
  // latency cost (one extra Haiku call, ~1-3s) is well within the 60s p95
  // target. Day 13 can re-introduce Promise.all if latency analysis shows
  // we're trending close to the bar.
  const compareOut = await comparePlaybookStage.run({
    contractType: triage.contractType as ContractType,
    jurisdiction: triage.jurisdiction,
    clauses: clauseOut.clauses,
  }, ctx)

  // ── Stage 6: retrieve-authority (deterministic; per-deviation)
  // ── Stage 7: generate-redline (Sonnet; per-deviation, gracefully degrades)
  const issues: PipelineIssue[] = []
  for (const deviation of compareOut.deviations) {
    // Refresh authority chunks for this clause's deviation. If retrieval
    // is not wired, generate-redline runs without authority context.
    const chunks = input.retrieveAuthority
      ? await retrieveAuthorityForDeviation(input.retrieveAuthority, deviation, triage.jurisdiction)
      : []
    ctx.authorityChunks = chunks

    try {
      const redline = await generateRedlineStage.run({
        contractType: triage.contractType as ContractType,
        jurisdiction: triage.jurisdiction,
        deviation,
      }, ctx)
      issues.push(redline.issue)
    } catch (cause) {
      // Per orchestration.md: a single failed flag doesn't kill the review.
      // Surface a manual-review-recommended placeholder issue and continue.
      // The route handler / UI explains the partial-failure to the user.
      issues.push(buildFailureIssue(deviation, (cause as Error).message))
    }
  }

  // ── Stage 9: defined-terms-check (Haiku, best-effort, non-blocking).
  // Per orchestration.md: failures are swallowed; an empty result is
  // surfaced and the pipeline continues. Sequential after generate-redline
  // for Sprint 1 (see comment above stage 5).
  const definedTerms: DefinedTermIssue[] = await definedTermsCheckStage
    .run({ fullText: extractedText.fullText }, ctx)
    .then((r) => r.issues)
    .catch(() => [])

  // ── Stage 8: verify-citations (deterministic; mutates confidence)
  const citationValidation = await validateCitations(issues, {
    resolveCitation: input.resolveCitation ?? undefined,
  })

  // Flatten verified citations to the run-level citations array. The eval
  // harness uses this for its independent citation-validity metric.
  const allCitations = citationValidation.issues.flatMap((i) => i.citations)

  // ── Stage 10: assemble-output (deterministic). Awaits all upstream.
  const assembleStartedAt = Date.now()
  ctx.emitEvent({
    stage: 'assemble-output',
    status: 'started',
    promptVersion: '0.1.0',
  })
  let assembled: AssembledOutput | undefined
  try {
    assembled = await assembleOutput({
      reviewId: input.reviewId,
      triage,
      clauses: clauseOut.clauses,
      issues: citationValidation.issues,
      definedTerms,
      fullText: extractedText.fullText,
    })
    ctx.emitEvent({
      stage: 'assemble-output',
      status: 'completed',
      promptVersion: '0.1.0',
      durationMs: Date.now() - assembleStartedAt,
    })
  } catch (cause) {
    // Assemble-output is deterministic; if it fails, it's a real bug.
    // Emit a failed event so the route handler can surface it.
    ctx.emitEvent({
      stage: 'assemble-output',
      status: 'failed',
      promptVersion: '0.1.0',
      durationMs: Date.now() - assembleStartedAt,
      errorMessage: (cause as Error).message,
    })
    throw cause
  }

  return {
    reviewId: input.reviewId,
    quality,
    extractedText,
    triage,
    clauses: clauseOut.clauses,
    deviations: compareOut.deviations,
    issues: citationValidation.issues,
    citations: allCitations,
    citationValidation,
    definedTerms,
    assembled,
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

// Build the retrieval query for a deviation: the playbook clause id +
// jurisdiction + (compare-playbook's reasoning, lightly summarised) →
// improves recall over just "clauseId" because the dense retriever is
// trained on natural language not enum strings.
async function retrieveAuthorityForDeviation(
  retrieve: AuthorityRetriever,
  deviation: PlaybookDeviation,
  jurisdiction: Jurisdiction | 'unknown',
): Promise<string[]> {
  const reasoning = deviation.reasoning.replace(/\s+/g, ' ').slice(0, 240)
  const query = `${deviation.playbookClauseId} ${reasoning}`
  return retrieve({
    query,
    jurisdiction,
    clauseId: deviation.playbookClauseId,
    topK: 8,
  })
}

// Construct a manual-review issue placeholder when generate-redline fails
// for a particular deviation. Preserves the deviation's clause id +
// severity so the user sees "we identified a problem here, please review
// manually" instead of silent omission.
function buildFailureIssue(deviation: PlaybookDeviation, errorMessage: string): PipelineIssue {
  return {
    clauseId: deviation.playbookClauseId,
    severity: deviation.severity,
    confidence: 'manual_review_recommended',
    currentPosition: deviation.currentText
      ? deviation.currentText.replace(/\s+/g, ' ').slice(0, 200)
      : '[clause missing from document]',
    recommendedPosition:
      'Manual review recommended — the redline generator could not produce a recommendation for this clause.',
    reasoning: `${deviation.reasoning}\n\nGenerate-redline failed: ${errorMessage}`,
    redlineText: '',
    citations: [],
  }
}

// Sprint 1 acceptance set. Documents outside this set get the friendly
// explainer reply; the orchestrator returns unsupported.
export const SPRINT_1_ACCEPTED_CONTRACT_TYPES: readonly ContractType[] = ['nda']

// Convert the orchestrator's unsupported branch into a typed error for
// callers that prefer try/catch over result-shape inspection.
export function rejectUnsupportedContractType(detail: string): never {
  throw new UnsupportedContractTypeError(detail)
}

// Re-export the EAC jurisdiction enum string union so the route handler
// can narrow against it without re-importing.
export type EacJurisdiction = Exclude<Jurisdiction, never>

// Re-thrown by the orchestrator-as-stage if a future caller wants the
// pipeline to fail rather than return partial results. Sprint 1 doesn't
// use this path; documented for the Day 9 route handler integration.
export { PipelineError }
