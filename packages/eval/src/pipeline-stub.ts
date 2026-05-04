// Stub pipeline.
//
// Day 6 ships the eval harness *infrastructure*. The real orchestrator
// stages land Day 7-9. To exercise the runner end-to-end before then, we
// have a stub pipeline that produces deterministic, plausible-shaped
// PipelineOutput.
//
// Two stub flavours:
//   - `oracle`  : echoes the ground-truth perfectly. Verifies the metrics
//                 module: F1=1.0, hallucination=0, citation validity=1.0.
//   - `noisy`   : drops a critical, swaps a severity, hallucinates one
//                 issue, leaves a citation invalid. Verifies the metrics
//                 actually penalise the right things.
//
// The runner picks one via the --stub flag. Production pipeline (Day 9)
// replaces this entirely.

import type { GroundTruth, PipelineOutput, PipelineIssue } from './types.js'

export type StubMode = 'oracle' | 'noisy'

export interface StubOptions {
  mode: StubMode
}

// Produce a PipelineOutput for a given GroundTruth. Deterministic.
export function runStubPipeline(gt: GroundTruth, opts: StubOptions): PipelineOutput {
  if (opts.mode === 'oracle') return oracleOutput(gt)
  return noisyOutput(gt)
}

function oracleOutput(gt: GroundTruth): PipelineOutput {
  const issues: PipelineIssue[] = gt.expected_issues.map((e) => ({
    clause_id: e.clause_id,
    severity: e.severity,
    confidence: e.expected_confidence ?? (e.severity === 'critical' ? 'high' : 'medium'),
    // Short string (< 12 chars) bypasses the hallucination-substring check.
    // The oracle stub doesn't have access to real source text.
    current_position: '—',
    recommended_position: `Stub-oracle recommendation for ${e.clause_id}`,
    reasoning: e.description,
    citations: (gt.expected_citations ?? []).map((c) => ({
      source: c.source,
      id: c.id,
      section: c.section,
      validated: true,
    })),
  }))
  return {
    filename: gt.filename,
    identified_clauses: gt.expected_issues.map((e) => ({
      clause_id: e.clause_id,
      source_text: '—',
      confidence: e.expected_confidence ?? 'high',
    })),
    issues,
    citations: (gt.expected_citations ?? []).map((c) => ({
      source: c.source,
      id: c.id,
      section: c.section,
      validated: true,
    })),
    stage_timings_ms: { stub: 1 },
    total_tokens: 0,
  }
}

function noisyOutput(gt: GroundTruth): PipelineOutput {
  // Drop the first critical, swap a severity, add a fake issue, mark one
  // citation invalid.
  const expected = gt.expected_issues
  const firstCriticalIdx = expected.findIndex((e) => e.severity === 'critical')
  const issues: PipelineIssue[] = []
  for (let i = 0; i < expected.length; i++) {
    if (i === firstCriticalIdx) continue   // dropped
    const e = expected[i]!
    // Severity swap on the second issue we keep
    const swap = i === (firstCriticalIdx === 0 ? 1 : 0)
    const sev = swap ? swapSeverity(e.severity) : e.severity
    issues.push({
      clause_id: e.clause_id,
      severity: sev,
      confidence: e.expected_confidence ?? 'medium',
      current_position: `Stub-noisy echo for ${e.clause_id}`,
      recommended_position: `Stub-noisy recommendation for ${e.clause_id}`,
      reasoning: e.description,
      citations: [],
    })
  }
  // Hallucinated issue
  issues.push({
    clause_id: 'fabricated_clause',
    severity: 'minor',
    confidence: 'medium',
    current_position: 'This sentence does not appear in the source document and should be flagged as a hallucination',
    recommended_position: 'n/a',
    reasoning: 'Stub-noisy hallucinated issue',
    citations: [],
  })
  return {
    filename: gt.filename,
    identified_clauses: [],
    issues,
    citations: [
      // Valid citation
      ...(gt.expected_citations ?? []).slice(0, 1).map((c) => ({
        source: c.source,
        id: c.id,
        section: c.section,
        validated: true,
      })),
      // Invalid citation marker
      { source: 'kenya-statute', id: 'fake-act-9999', validated: false },
    ],
    stage_timings_ms: { stub: 1 },
    total_tokens: 0,
  }
}

function swapSeverity(s: 'critical' | 'material' | 'minor'): 'critical' | 'material' | 'minor' {
  if (s === 'critical') return 'material'
  if (s === 'material') return 'minor'
  return 'material'
}
