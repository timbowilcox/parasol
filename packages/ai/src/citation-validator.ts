// Citation validator.
//
// Per CLAUDE.md: "Every flagged clause cites verifiable Kenyan or EAC
// authority. Citation validator runs on every output. Anything claiming
// 'DPA 2019 s.40' must resolve in the corpus or the redline regenerates.
// Hard requirement, not best-effort."
//
// This module is the deterministic layer. A separate Sonnet content-claim
// validator (Day 13 polish if eval shows the deterministic check is
// insufficient) would verify that the citation's text actually supports
// the issue's reasoning; for Sprint 1, presence-in-corpus is the gate.
//
// Confidence calibration applied in the same pass:
//   high   → medium             on any citation failure within the issue
//   medium → manual_review      on any citation failure
//   manual_review → unchanged   (already at the floor)

import type { ConfidenceLevel } from '@parasol/core'
import type { PipelineIssue, PipelineCitation } from './stages/types'

// Citation source types whose canonical_id is expected to resolve in
// corpus_documents. Mirror packages/playbooks/src/schema.ts. market-norm
// and parasol-internal are intentionally non-corpus and never resolved.
const CORPUS_BACKED_SOURCES: ReadonlySet<string> = new Set([
  'kenya-statute',
  'kenya-case',
  'kenya-regulation',
  'odpc-determination',
  'kra-ruling',
  'cbk-circular',
  'cma-notice',
  'eac-treaty',
])

// Async resolver: returns true iff (source, canonical_id) exists in
// corpus_documents. Wired by the orchestrator caller against Supabase.
// When omitted, deterministic validation is skipped — every citation's
// `validated` flag from generate-redline is preserved.
export type CitationResolver = (source: string, canonicalId: string) => Promise<boolean>

export interface ValidateOptions {
  resolveCitation?: CitationResolver
}

export interface ValidationOutcome {
  issues: PipelineIssue[]
  // Diagnostic counts surfaced in the run log + acceptance check.
  totalCitations: number
  resolvedCitations: number
  unresolvedCitations: number
  issuesWithFailures: number
}

export async function validateCitations(
  issues: PipelineIssue[],
  options: ValidateOptions = {},
): Promise<ValidationOutcome> {
  const { resolveCitation } = options
  let totalCitations = 0
  let resolvedCitations = 0
  let unresolvedCitations = 0
  let issuesWithFailures = 0

  // Resolve all corpus-backed citations in parallel; non-corpus sources
  // (market-norm, parasol-internal) are not resolved and remain at their
  // input `validated` value.
  const validated: PipelineIssue[] = []

  for (const issue of issues) {
    let issueHadFailure = false
    const newCitations: PipelineCitation[] = []

    for (const citation of issue.citations) {
      totalCitations++

      // Non-corpus source: keep input validated state, count as resolved
      // for the issuesWithFailures tally (these are intentionally trusted).
      if (!CORPUS_BACKED_SOURCES.has(citation.source)) {
        newCitations.push(citation)
        resolvedCitations++
        continue
      }

      // Corpus-backed: deterministic resolution.
      let isResolved: boolean
      if (resolveCitation) {
        try {
          isResolved = await resolveCitation(citation.source, citation.id)
        } catch {
          // Resolver errors are conservative-safe: treat as unresolved.
          isResolved = false
        }
      } else {
        // No resolver supplied — fall back to the model-supplied flag.
        // The orchestrator's CI run always supplies a resolver; this branch
        // is for unit tests and local debugging.
        isResolved = citation.validated
      }

      if (isResolved) {
        resolvedCitations++
      } else {
        unresolvedCitations++
        issueHadFailure = true
      }

      newCitations.push({ ...citation, validated: isResolved })
    }

    if (issueHadFailure) issuesWithFailures++

    validated.push({
      ...issue,
      citations: newCitations,
      // Apply confidence calibration only when this issue had a failed
      // corpus-backed citation. Non-corpus-only issues keep their input
      // confidence (they have no resolution check to ding them).
      confidence: issueHadFailure
        ? degradeConfidence(issue.confidence)
        : issue.confidence,
    })
  }

  return {
    issues: validated,
    totalCitations,
    resolvedCitations,
    unresolvedCitations,
    issuesWithFailures,
  }
}

// Calibrated confidence drop on citation failure. Per docs/orchestration.md:
//   high   → medium
//   medium → manual_review_recommended
//   manual_review_recommended → unchanged (already at floor)
export function degradeConfidence(c: ConfidenceLevel): ConfidenceLevel {
  if (c === 'high') return 'medium'
  if (c === 'medium') return 'manual_review_recommended'
  return c
}

// Pure helper for tests + the orchestrator: count an issue's "trusted"
// citations after validation (non-corpus + resolved corpus).
export function countTrustedCitations(issue: PipelineIssue): number {
  return issue.citations.filter((c) =>
    !CORPUS_BACKED_SOURCES.has(c.source) || c.validated,
  ).length
}

export const __testing = { CORPUS_BACKED_SOURCES }
