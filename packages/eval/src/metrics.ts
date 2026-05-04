// Eval metrics.
//
// All functions are pure — given a GroundTruth + PipelineOutput, they
// return a PerNdaScore. The runner glues them together; the reporter
// aggregates and writes JSON.
//
// Decisions:
//
// - We match issues by (clause_id, severity). Severity must agree because
//   getting "this is critical" wrong is a different error from missing
//   the clause entirely. Sprint 1 keeps it strict; we revisit fuzzy
//   matching (e.g. mark severity-mismatch as "partial" credit) once we
//   have eval data showing how often the model swaps neighbouring
//   severities.
//
// - Citation validity: every citation in any pipeline issue (or in the
//   `citations` top-level) must resolve in the corpus. The pipeline's
//   `verify-citations` stage already checks this on every output (CLAUDE.md
//   "Hard requirement, not best-effort"); the eval metric re-verifies
//   independently to keep the gate trustworthy.
//
// - Hallucination rate: a flag's `current_position` is hallucinated if its
//   verbatim source_text doesn't appear anywhere in the original document
//   bytes. The pipeline must paraphrase honestly; "the agreement says X"
//   when the agreement doesn't say X is the failure mode this catches.

import type {
  GroundTruth,
  PipelineOutput,
  PerNdaScore,
  EvalRunResult,
  AggregateScore,
  PipelineIssue,
  ExpectedIssue,
} from './types'

// ─── Per-NDA scoring ─────────────────────────────────────────────────────────

export interface ScoreInput {
  groundTruth: GroundTruth
  pipelineOutput: PipelineOutput
  // Original NDA bytes / text — used by hallucination detection. Pass null
  // to skip the hallucination check (e.g. when running stub-only).
  sourceText: string | null
  // CitationResolver-shaped: returns true iff (source, id) resolves in the
  // corpus. Pass null to skip citation validation (the pipeline's own
  // verify-citations stage may have already done it; the metric re-checks
  // independently when this resolver is supplied).
  resolveCitation: ((source: string, id: string) => Promise<boolean>) | null
}

export async function scoreNda(input: ScoreInput): Promise<PerNdaScore> {
  const { groundTruth: gt, pipelineOutput: out, sourceText, resolveCitation } = input

  // ── Clause identification: precision / recall / F1 by (clause_id, severity)
  const expected = gt.expected_issues.map(keyOf)
  const actual = out.issues.map(keyOf)
  const expectedSet = new Set(expected)
  const actualSet = new Set(actual)

  const truePositives = expected.filter((k) => actualSet.has(k))
  const falseNegatives = expected.filter((k) => !actualSet.has(k))
  const falsePositives = actual.filter((k) => !expectedSet.has(k))

  const precision = actual.length > 0 ? truePositives.length / actual.length : (expected.length === 0 ? 1 : 0)
  const recall = expected.length > 0 ? truePositives.length / expected.length : 1
  const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0

  // ── Citation validity: every cited (source, id) must resolve in corpus
  const allCitations = gatherCitations(out)
  let invalidCitations: Array<{ source: string; id: string }> = []
  let citationValidity = 1
  if (allCitations.length > 0) {
    if (resolveCitation) {
      const checks = await Promise.all(
        allCitations.map(async (c) => ({ c, ok: await resolveCitation(c.source, c.id) })),
      )
      invalidCitations = checks.filter((r) => !r.ok).map((r) => ({ source: r.c.source, id: r.c.id }))
      citationValidity = (allCitations.length - invalidCitations.length) / allCitations.length
    } else {
      // Trust the pipeline's own validator field if no independent resolver
      // is supplied. Pipeline output that lies about validated=true will
      // never get caught by this path; that's why the CI gate always
      // supplies a resolver.
      const trusted = allCitations.filter((c) => c.validated).length
      citationValidity = trusted / allCitations.length
      invalidCitations = allCitations
        .filter((c) => !c.validated)
        .map((c) => ({ source: c.source, id: c.id }))
    }
  }

  // ── Hallucination rate
  let hallucinationRate = 0
  if (sourceText !== null) {
    const norm = normaliseForSubstringMatch(sourceText)
    const hallucinated = out.issues.filter((iss) => {
      const candidate = normaliseForSubstringMatch(iss.current_position)
      // Empty current_position is meaningless not hallucinated.
      if (candidate.length < 12) return false
      return !norm.includes(candidate)
    })
    hallucinationRate = out.issues.length > 0 ? hallucinated.length / out.issues.length : 0
  }

  return {
    filename: gt.filename,
    clause_identification_precision: precision,
    clause_identification_recall: recall,
    clause_identification_f1: f1,
    citation_validity_rate: citationValidity,
    hallucination_rate: hallucinationRate,
    diagnostics: {
      matched_issues: truePositives.map(parseKey),
      extra_issues: falsePositives.map(parseKey),
      missed_issues: falseNegatives.map(parseKey),
      invalid_citations: invalidCitations,
    },
  }
}

// ─── Aggregation across multiple NDAs ────────────────────────────────────────

export function aggregate(perNda: PerNdaScore[]): AggregateScore {
  if (perNda.length === 0) {
    return {
      cases: 0,
      clause_identification_precision: 0,
      clause_identification_recall: 0,
      clause_identification_f1: 0,
      citation_validity_rate: 1,
      hallucination_rate: 0,
    }
  }
  const mean = (selector: (s: PerNdaScore) => number): number => {
    const sum = perNda.reduce((acc, s) => acc + selector(s), 0)
    return sum / perNda.length
  }
  const rated = perNda.filter((s) => typeof s.redline_appropriateness === 'number')
  const ratedMean = rated.length > 0
    ? rated.reduce((acc, s) => acc + (s.redline_appropriateness ?? 0), 0) / rated.length
    : undefined

  return {
    cases: perNda.length,
    clause_identification_precision: mean((s) => s.clause_identification_precision),
    clause_identification_recall: mean((s) => s.clause_identification_recall),
    clause_identification_f1: mean((s) => s.clause_identification_f1),
    citation_validity_rate: mean((s) => s.citation_validity_rate),
    hallucination_rate: mean((s) => s.hallucination_rate),
    redline_appropriateness: ratedMean,
    rated_subset_size: rated.length > 0 ? rated.length : undefined,
  }
}

// ─── Acceptance-bar evaluation ───────────────────────────────────────────────

export interface AcceptanceCheck {
  passed: boolean
  failures: string[]
}

export function checkAcceptanceBar(agg: AggregateScore, bar: {
  min_clause_identification_f1: number
  min_redline_appropriateness: number
  max_hallucination_rate: number
  min_citation_validity_rate: number
}): AcceptanceCheck {
  const failures: string[] = []
  if (agg.clause_identification_f1 < bar.min_clause_identification_f1) {
    failures.push(
      `clause F1 ${agg.clause_identification_f1.toFixed(3)} below bar ${bar.min_clause_identification_f1}`,
    )
  }
  if (agg.citation_validity_rate < bar.min_citation_validity_rate) {
    failures.push(
      `citation validity ${agg.citation_validity_rate.toFixed(3)} below bar ${bar.min_citation_validity_rate}`,
    )
  }
  if (agg.hallucination_rate > bar.max_hallucination_rate) {
    failures.push(
      `hallucination rate ${agg.hallucination_rate.toFixed(3)} above bar ${bar.max_hallucination_rate}`,
    )
  }
  // redline_appropriateness is optional — only enforced if rated subset exists
  if (typeof agg.redline_appropriateness === 'number') {
    const fraction = agg.redline_appropriateness / 5
    if (fraction < bar.min_redline_appropriateness) {
      failures.push(
        `redline appropriateness ${fraction.toFixed(3)} (=${agg.redline_appropriateness.toFixed(2)}/5) below bar ${bar.min_redline_appropriateness}`,
      )
    }
  }
  return { passed: failures.length === 0, failures }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function keyOf(issue: ExpectedIssue | PipelineIssue): string {
  return `${issue.clause_id}::${issue.severity}`
}

function parseKey(key: string): { clause_id: string; severity: 'critical' | 'material' | 'minor' } {
  const [clause_id, sev] = key.split('::')
  return {
    clause_id: clause_id ?? '',
    severity: (sev as 'critical' | 'material' | 'minor') ?? 'minor',
  }
}

function gatherCitations(out: PipelineOutput): PipelineOutput['citations'] {
  const all = [...out.citations]
  for (const iss of out.issues) {
    for (const c of iss.citations) all.push(c)
  }
  // De-duplicate by (source, id, section)
  const seen = new Set<string>()
  return all.filter((c) => {
    const k = `${c.source}::${c.id}::${c.section ?? ''}`
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
}

// Lowercase + collapse whitespace for substring containment checks.
// Doesn't try to be clever about punctuation or word boundaries; the
// hallucination check is intentionally strict (you said it, source has to
// say it). Day 13 may revisit if false-positive rate is high.
export function normaliseForSubstringMatch(s: string): string {
  return s.toLowerCase().replace(/\s+/g, ' ').trim()
}

// Helper for the reporter — assemble an EvalRunResult given per-NDA scores.
export function buildRunResult(input: {
  sprint: string
  pipeline: 'stub' | 'production'
  models: { haiku?: string; sonnet?: string; opus?: string }
  perNda: PerNdaScore[]
  gitSha?: string
}): EvalRunResult {
  return {
    ran_at: new Date().toISOString(),
    git_sha: input.gitSha,
    sprint: input.sprint,
    pipeline: input.pipeline,
    models: input.models,
    per_nda: input.perNda,
    aggregate: aggregate(input.perNda),
  }
}
