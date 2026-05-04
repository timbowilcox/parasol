// Orchestrator shell — Sprint 1 day 7.
//
// Stages 1-4 (the cheap Haiku stages) are wired and runnable. Stages 5-10
// land Day 8 (compare-playbook, generate-redline, verify-citations) and
// Day 9 (defined-terms-check, assemble-output). Until then, those stages
// return empty placeholders so the orchestrator can run end-to-end against
// the eval harness without crashing.
//
// The shape of OrchestratorRun mirrors what the eval harness's
// PipelineOutput type expects, so once the production stages are wired,
// the eval --pipeline=production flag in packages/eval/src/cli/run.ts
// just calls runOrchestrator() and maps the result.

import type {
  ContractType,
  Jurisdiction,
  IssueSeverity,
  ConfidenceLevel,
} from '@parasol/core'
import {
  UnsupportedContractTypeError,
} from '@parasol/core'
import type { OrchestratorContext, PipelineEvent, ModelEnv } from './types.js'
import {
  qualityAssessStage,
  extractTextCleanStage,
  extractTextDegradedStage,
  triageStage,
  extractClausesStage,
  type PageInput,
  type QualityAssessOutput,
  type ExtractTextCleanOutput,
  type TriageOutput,
  type ExtractedClauseDraft,
} from './stages/index.js'

// ─── Orchestrator input / output ────────────────────────────────────────────

export interface OrchestratorInput {
  reviewId: string
  workspaceId: string
  // Pages already split + (where possible) text-extracted by intake plumbing.
  pages: PageInput[]
  // The workspace's contract-type allowlist for Sprint 1. Documents whose
  // triage classifies outside this set are rejected with a friendly reply
  // (handled by the email/web layer, not here).
  acceptedContractTypes: readonly ContractType[]
  // Optional model env override (Sprint 2 A/B per DEF-041).
  modelEnv?: ModelEnv
  // Optional event sink. The orchestrator writes pipeline_events through
  // this; the route handler attaches a Supabase-writing implementation.
  // null defaults to a no-op.
  emitEvent?: (event: PipelineEvent) => void
}

export interface OrchestratorRunResult {
  reviewId: string
  // Set when the document failed triage gating.
  unsupported?: { reason: 'unsupported_contract_type' | 'unsupported_jurisdiction' | 'unparseable'; detail: string }
  // Stage-1-4 outputs — present when the run reached at least that stage.
  quality?: QualityAssessOutput
  extractedText?: ExtractTextCleanOutput
  triage?: TriageOutput
  clauses?: ExtractedClauseDraft[]
  // Stub placeholders for the heavy stages that land Day 8-9.
  issues: PipelineIssueDraft[]
  citations: PipelineCitationDraft[]
  redlineDocxBase64?: string  // Day 9 assemble-output writes this
  // Stage timings collected via PipelineEvents emitted to the sink.
  // The orchestrator does not buffer them; the route handler aggregates
  // from the event stream when it needs them.
}

// Stub draft shapes for stages that aren't wired yet. Once Day 8 ships
// generate-redline + verify-citations, replace these with the production types.
export interface PipelineIssueDraft {
  clauseId: string
  severity: IssueSeverity
  confidence: ConfidenceLevel
  currentPosition: string
  recommendedPosition: string
  reasoning: string
  citations: PipelineCitationDraft[]
}

export interface PipelineCitationDraft {
  source: string
  id: string
  section?: string
  validated: boolean
}

// ─── runOrchestrator ────────────────────────────────────────────────────────

export async function runOrchestrator(input: OrchestratorInput): Promise<OrchestratorRunResult> {
  const events: PipelineEvent[] = []
  const ctx: OrchestratorContext = {
    reviewId: input.reviewId,
    workspaceId: input.workspaceId,
    jurisdiction: 'kenya',     // Sprint 1 default; overwritten after triage
    contractType: 'unknown',   // overwritten after triage
    playbookContext: null,     // loaded between stages 4 and 5 (Day 8)
    authorityChunks: [],       // populated per-clause inside generate-redline (Day 8)
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

  // ── Stages 5-10: deliberately not wired in Day 7. Day 8 lands the heavy
  // reasoning stages; Day 9 wires assemble-output. For now, return the
  // stage-1-4 results plus empty issues/citations so the eval harness sees
  // a coherent (if thin) PipelineOutput.
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

// ─── Helpers exposed for the route / eval layers ────────────────────────────

// Sprint 1 acceptance set. Document received outside this set gets the
// friendly explainer reply; doesn't proceed through the pipeline.
export const SPRINT_1_ACCEPTED_CONTRACT_TYPES: readonly ContractType[] = ['nda']

// For tests + future composition: callers can throw the typed error from
// the orchestrator's unsupported branch when they want to convert to an
// error rather than handle the result.
export function rejectUnsupportedContractType(detail: string): never {
  throw new UnsupportedContractTypeError(detail)
}

// Re-export the EAC jurisdiction enum string union so the route handler
// can narrow against it without re-importing.
export type EacJurisdiction = Exclude<Jurisdiction, never>
