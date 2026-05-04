// Eval harness types.
//
// Ground-truth annotations describe what a Kenyan in-house counsel would
// expect Parasol to flag in a given NDA. The pipeline output describes what
// Parasol actually flagged. Metrics compare the two to compute precision,
// recall, citation validity, and hallucination rate.
//
// The shapes here are stable across:
//   - the annotation YAML files in packages/eval/data/golden/nda/
//   - the stub pipeline (Day 6)
//   - the real pipeline output (Day 7-9)
//   - the reporter's sprint-1.json output
//   - the CI gate

import type { ClauseType, IssueSeverity, ConfidenceLevel } from '@parasol/core'

// ─── Ground-truth annotation ────────────────────────────────────────────────

// What a counsel-validated annotator says SHOULD appear in the output for
// a given NDA. One annotation per NDA file.
export interface GroundTruth {
  // Filename of the NDA (e.g. "nda-001.pdf"); matches manifest.yaml.
  filename: string
  // ISO date the annotation was made.
  annotated_at: string
  // Annotator identity. For Sprint 1 this is "parasol-internal-draft" since
  // the dataset is internally annotated; v1 launch requires counsel sign-off
  // (DEF-028 path). Mirrors the playbook's status: draft mechanic.
  annotated_by: string
  // Free-form notes the annotator wants to surface to a reviewer.
  notes?: string
  // The expected list of issues. Order doesn't matter; metrics match by
  // (clause_id, severity).
  expected_issues: ExpectedIssue[]
  // Citations the annotator believes the pipeline SHOULD include for this
  // NDA. e.g. "any flag on data-protection clauses must cite DPA 2019 s.49".
  expected_citations?: ExpectedCitation[]
}

export interface ExpectedIssue {
  // Maps to the playbook clause id (e.g. 'governing_law').
  clause_id: ClauseType | string
  severity: IssueSeverity
  // Human-readable expectation; not used by precision/recall but surfaced in
  // the per-NDA report for reviewer scrutiny.
  description: string
  // If true, the metric considers this a "must include" — missing it
  // dings recall heavily. Defaults to true for critical, false otherwise.
  required?: boolean
  // Acceptable confidence range. If the pipeline reports outside this range,
  // confidence-calibration penalty applies.
  expected_confidence?: ConfidenceLevel
}

export interface ExpectedCitation {
  // Same source enum as the playbook citation source.
  source: 'kenya-statute' | 'kenya-case' | 'kenya-regulation' | 'odpc-determination' | 'kra-ruling' | 'cbk-circular' | 'cma-notice'
  // Canonical id matching corpus_documents.canonical_id (e.g. "2019/24" for DPA).
  id: string
  // Optional section reference (e.g. "s.49").
  section?: string
}

// ─── Pipeline output (what we evaluate) ──────────────────────────────────────

// What the pipeline produces for one NDA. The real shape lands incrementally
// across Day 7-9; the eval harness only relies on what it asserts about.
// Stub pipeline (pipeline-stub.ts) produces deterministic plausible output.
export interface PipelineOutput {
  filename: string
  // Identified clauses + their playbook id mapping. Used for recall on
  // ExpectedIssue.clause_id.
  identified_clauses: IdentifiedClause[]
  // Issues the pipeline flagged.
  issues: PipelineIssue[]
  // Citations the pipeline included anywhere in its output. For citation
  // validity, every citation must resolve in the corpus.
  citations: PipelineCitation[]
  // Per-stage timing. Surfaced for the cost / latency dashboards (Day 8+).
  stage_timings_ms?: Record<string, number>
  // Total tokens consumed end-to-end.
  total_tokens?: number
}

export interface IdentifiedClause {
  clause_id: ClauseType | string
  // The verbatim clause text the pipeline pulled from the document. Used
  // for hallucination check ("does this text appear in the source?").
  source_text: string
  // The pipeline's confidence in the identification.
  confidence: ConfidenceLevel
}

export interface PipelineIssue {
  clause_id: ClauseType | string
  severity: IssueSeverity
  confidence: ConfidenceLevel
  current_position: string
  recommended_position: string
  reasoning: string
  // Citations attached to the issue's reasoning.
  citations: PipelineCitation[]
}

export interface PipelineCitation {
  source: string
  id: string
  section?: string
  // True if the citation validator (Day 8 verify-citations stage) confirmed
  // it resolves in the corpus. For Sprint 1 the eval harness re-validates
  // independently against the corpus to keep the metric trustworthy.
  validated: boolean
}

// ─── Per-NDA scoring result ──────────────────────────────────────────────────

export interface PerNdaScore {
  filename: string
  // Recall on expected_issues: TP / (TP + FN). 1.0 = caught everything.
  clause_identification_precision: number
  clause_identification_recall: number
  clause_identification_f1: number
  // Fraction of pipeline citations that resolve in the corpus. Should be 1.0
  // (the citation validator is the gate). Anything <1.0 fails the CI gate.
  citation_validity_rate: number
  // Hallucination rate: fraction of issues whose source_text is NOT
  // verifiable substring in the source document. Should be ~0.
  hallucination_rate: number
  // 1-5 lawyer-rated appropriateness. Sampled by humans at 20% per the
  // sprint plan; absent on un-rated runs (we still aggregate the rated subset).
  redline_appropriateness?: number
  // True positives, false positives, false negatives (for diagnostics).
  diagnostics: {
    matched_issues: Array<{ clause_id: string; severity: IssueSeverity }>
    extra_issues: Array<{ clause_id: string; severity: IssueSeverity }>
    missed_issues: Array<{ clause_id: string; severity: IssueSeverity }>
    invalid_citations: Array<{ source: string; id: string }>
  }
}

// ─── Run-level aggregate ─────────────────────────────────────────────────────

export interface EvalRunResult {
  // ISO timestamp.
  ran_at: string
  // Git SHA of the run.
  git_sha?: string
  // Sprint label (e.g. 'sprint-1') — used to name the result file.
  sprint: string
  // Pipeline implementation: 'stub' for the Day 6 harness; 'production' once
  // Day 9 wires the real orchestrator.
  pipeline: 'stub' | 'production'
  // Models in use, surfaced in the result for replay correlation.
  models: { haiku?: string; sonnet?: string; opus?: string }
  // Per-NDA results.
  per_nda: PerNdaScore[]
  // Aggregates across all NDAs.
  aggregate: AggregateScore
}

export interface AggregateScore {
  cases: number
  clause_identification_precision: number  // mean
  clause_identification_recall: number     // mean
  clause_identification_f1: number         // mean
  citation_validity_rate: number           // mean (must be 1.0 for CI gate)
  hallucination_rate: number               // mean (must be < 0.02 for CI gate)
  redline_appropriateness?: number         // mean over rated cases
  rated_subset_size?: number               // count with redline_appropriateness
}

// ─── CI acceptance bar ───────────────────────────────────────────────────────
// Sprint 1 acceptance per docs/sprint-1-plan.md:
//   ≥85% clause identification, ≥80% redline appropriateness,
//   <2% hallucination rate, 100% citation validity.
// The reporter compares the AggregateScore against this and the CI gate
// fails on any breach.

export const SPRINT_1_ACCEPTANCE_BAR = {
  min_clause_identification_f1: 0.85,
  min_redline_appropriateness: 0.80,  // expressed as a fraction of 1.0; mapped from 1-5 by /5
  max_hallucination_rate: 0.02,
  min_citation_validity_rate: 1.0,
} as const

export type AcceptanceBar = typeof SPRINT_1_ACCEPTANCE_BAR
