import { describe, it, expect, vi } from 'vitest'
import {
  scoreNda,
  aggregate,
  checkAcceptanceBar,
  buildRunResult,
  normaliseForSubstringMatch,
} from './metrics.js'
import type {
  GroundTruth,
  PipelineOutput,
  PipelineIssue,
  PerNdaScore,
} from './types.js'
import { SPRINT_1_ACCEPTANCE_BAR } from './types.js'

const baseGt = (issues: GroundTruth['expected_issues'] = [], citations: GroundTruth['expected_citations'] = []): GroundTruth => ({
  filename: 'nda-test.pdf',
  annotated_at: '2026-05-04',
  annotated_by: 'parasol-internal-draft',
  expected_issues: issues,
  expected_citations: citations,
})

const baseOut = (issues: PipelineIssue[] = []): PipelineOutput => ({
  filename: 'nda-test.pdf',
  identified_clauses: [],
  issues,
  citations: [],
})

const issue = (clause_id: string, severity: 'critical' | 'material' | 'minor' = 'critical'): PipelineIssue => ({
  clause_id,
  severity,
  confidence: 'high',
  current_position: 'as written in the source',
  recommended_position: 'recommended',
  reasoning: 'reasoning',
  citations: [],
})

// ─── normaliseForSubstringMatch ──────────────────────────────────────────────

describe('normaliseForSubstringMatch', () => {
  it('lowercases and collapses whitespace', () => {
    expect(normaliseForSubstringMatch('  Hello   WORLD\n')).toBe('hello world')
    expect(normaliseForSubstringMatch('A\tB\n\nC')).toBe('a b c')
  })
})

// ─── scoreNda — clause identification ────────────────────────────────────────

describe('scoreNda — perfect match', () => {
  it('F1=1, recall=1, precision=1 when actual == expected', async () => {
    const gt = baseGt([
      { clause_id: 'governing_law', severity: 'critical', description: 'x' },
      { clause_id: 'data_protection', severity: 'critical', description: 'y' },
    ])
    const out = baseOut([issue('governing_law'), issue('data_protection')])
    const r = await scoreNda({
      groundTruth: gt,
      pipelineOutput: out,
      sourceText: 'as written in the source verbatim text',
      resolveCitation: null,
    })
    expect(r.clause_identification_f1).toBe(1)
    expect(r.clause_identification_precision).toBe(1)
    expect(r.clause_identification_recall).toBe(1)
    expect(r.diagnostics.matched_issues).toHaveLength(2)
    expect(r.diagnostics.missed_issues).toHaveLength(0)
    expect(r.diagnostics.extra_issues).toHaveLength(0)
  })
})

describe('scoreNda — clause-id mismatch', () => {
  it('penalises false negatives (missed)', async () => {
    const gt = baseGt([
      { clause_id: 'a', severity: 'critical', description: 'x' },
      { clause_id: 'b', severity: 'critical', description: 'y' },
    ])
    const out = baseOut([issue('a')])
    const r = await scoreNda({ groundTruth: gt, pipelineOutput: out, sourceText: 'as written in the source verbatim text', resolveCitation: null })
    expect(r.clause_identification_recall).toBeCloseTo(0.5, 5)
    expect(r.clause_identification_precision).toBe(1)
    expect(r.diagnostics.missed_issues).toHaveLength(1)
  })

  it('penalises false positives (extra)', async () => {
    const gt = baseGt([{ clause_id: 'a', severity: 'critical', description: 'x' }])
    const out = baseOut([issue('a'), issue('z')])
    const r = await scoreNda({ groundTruth: gt, pipelineOutput: out, sourceText: 'as written in the source verbatim text', resolveCitation: null })
    expect(r.clause_identification_precision).toBeCloseTo(0.5, 5)
    expect(r.clause_identification_recall).toBe(1)
    expect(r.diagnostics.extra_issues).toHaveLength(1)
  })
})

describe('scoreNda — severity mismatch', () => {
  it('treats severity mismatch as a miss + extra (strict by design)', async () => {
    const gt = baseGt([{ clause_id: 'a', severity: 'critical', description: 'x' }])
    const out = baseOut([issue('a', 'material')])
    const r = await scoreNda({ groundTruth: gt, pipelineOutput: out, sourceText: 'as written in the source verbatim text', resolveCitation: null })
    expect(r.clause_identification_precision).toBe(0)
    expect(r.clause_identification_recall).toBe(0)
    expect(r.diagnostics.missed_issues[0]?.severity).toBe('critical')
    expect(r.diagnostics.extra_issues[0]?.severity).toBe('material')
  })
})

// ─── scoreNda — citation validity ────────────────────────────────────────────

describe('scoreNda — citation validity', () => {
  it('passes 1.0 when there are no citations', async () => {
    const r = await scoreNda({
      groundTruth: baseGt(),
      pipelineOutput: baseOut(),
      sourceText: null,
      resolveCitation: vi.fn(),
    })
    expect(r.citation_validity_rate).toBe(1)
  })

  it('uses resolver to compute fraction valid', async () => {
    const out = baseOut()
    out.citations = [
      { source: 'kenya-statute', id: '2019/24', validated: true },
      { source: 'kenya-statute', id: 'made-up', validated: true },   // resolver will say no
    ]
    const resolver = vi.fn(async (_s: string, id: string) => id === '2019/24')
    const r = await scoreNda({ groundTruth: baseGt(), pipelineOutput: out, sourceText: null, resolveCitation: resolver })
    expect(r.citation_validity_rate).toBe(0.5)
    expect(r.diagnostics.invalid_citations).toEqual([{ source: 'kenya-statute', id: 'made-up' }])
  })

  it('falls back to validated flag when no resolver supplied', async () => {
    const out = baseOut()
    out.citations = [
      { source: 'kenya-statute', id: '2019/24', validated: true },
      { source: 'kenya-statute', id: 'fake', validated: false },
    ]
    const r = await scoreNda({ groundTruth: baseGt(), pipelineOutput: out, sourceText: null, resolveCitation: null })
    expect(r.citation_validity_rate).toBe(0.5)
  })

  it('de-duplicates citations across issues + top-level before scoring', async () => {
    const out = baseOut([
      { ...issue('a'), citations: [{ source: 'kenya-statute', id: '2019/24', validated: true }] },
    ])
    out.citations = [{ source: 'kenya-statute', id: '2019/24', validated: true }]
    const resolver = vi.fn(async () => true)
    await scoreNda({
      groundTruth: baseGt([{ clause_id: 'a', severity: 'critical', description: 'x' }]),
      pipelineOutput: out,
      sourceText: 'as written in the source verbatim text',
      resolveCitation: resolver,
    })
    expect(resolver).toHaveBeenCalledTimes(1)  // dedup
  })
})

// ─── scoreNda — hallucination rate ───────────────────────────────────────────

describe('scoreNda — hallucination rate', () => {
  it('zero when every issue text appears in source', async () => {
    const gt = baseGt([{ clause_id: 'a', severity: 'critical', description: 'x' }])
    const out = baseOut([issue('a')])
    const r = await scoreNda({
      groundTruth: gt,
      pipelineOutput: out,
      sourceText: 'as written in the source verbatim text',
      resolveCitation: null,
    })
    expect(r.hallucination_rate).toBe(0)
  })

  it('1.0 when all issue text is fabricated', async () => {
    const out = baseOut([
      { ...issue('a'), current_position: 'this fabricated sentence does not exist anywhere in the source document text' },
    ])
    const r = await scoreNda({
      groundTruth: baseGt([{ clause_id: 'a', severity: 'critical', description: 'x' }]),
      pipelineOutput: out,
      sourceText: 'totally unrelated source content',
      resolveCitation: null,
    })
    expect(r.hallucination_rate).toBe(1)
  })

  it('skips check when sourceText is null', async () => {
    const out = baseOut([
      { ...issue('a'), current_position: 'fabricated sentence not in source anywhere' },
    ])
    const r = await scoreNda({
      groundTruth: baseGt([{ clause_id: 'a', severity: 'critical', description: 'x' }]),
      pipelineOutput: out,
      sourceText: null,
      resolveCitation: null,
    })
    expect(r.hallucination_rate).toBe(0)  // not penalised
  })

  it('does not penalise short / empty current_position strings', async () => {
    const out = baseOut([{ ...issue('a'), current_position: 'short' }])
    const r = await scoreNda({
      groundTruth: baseGt([{ clause_id: 'a', severity: 'critical', description: 'x' }]),
      pipelineOutput: out,
      sourceText: 'unrelated source',
      resolveCitation: null,
    })
    expect(r.hallucination_rate).toBe(0)
  })
})

// ─── aggregate ───────────────────────────────────────────────────────────────

describe('aggregate', () => {
  const score = (overrides: Partial<PerNdaScore> = {}): PerNdaScore => ({
    filename: 'x',
    clause_identification_precision: 0.8,
    clause_identification_recall: 0.8,
    clause_identification_f1: 0.8,
    citation_validity_rate: 1,
    hallucination_rate: 0,
    diagnostics: { matched_issues: [], extra_issues: [], missed_issues: [], invalid_citations: [] },
    ...overrides,
  })

  it('returns a zero-aggregate for empty input', () => {
    const a = aggregate([])
    expect(a.cases).toBe(0)
    expect(a.clause_identification_f1).toBe(0)
  })

  it('averages numeric fields across cases', () => {
    const a = aggregate([
      score({ clause_identification_f1: 1, hallucination_rate: 0 }),
      score({ clause_identification_f1: 0.5, hallucination_rate: 0.1 }),
    ])
    expect(a.cases).toBe(2)
    expect(a.clause_identification_f1).toBeCloseTo(0.75, 5)
    expect(a.hallucination_rate).toBeCloseTo(0.05, 5)
  })

  it('only includes rated cases in redline_appropriateness mean', () => {
    const a = aggregate([
      score({ redline_appropriateness: 4 }),
      score(),
      score({ redline_appropriateness: 3 }),
    ])
    expect(a.redline_appropriateness).toBe(3.5)
    expect(a.rated_subset_size).toBe(2)
  })
})

// ─── checkAcceptanceBar ──────────────────────────────────────────────────────

describe('checkAcceptanceBar', () => {
  const passing = {
    cases: 5,
    clause_identification_precision: 0.9,
    clause_identification_recall: 0.9,
    clause_identification_f1: 0.9,
    citation_validity_rate: 1,
    hallucination_rate: 0.01,
  }

  it('passes when all bars met', () => {
    expect(checkAcceptanceBar(passing, SPRINT_1_ACCEPTANCE_BAR).passed).toBe(true)
  })

  it('fails on F1 below bar', () => {
    const r = checkAcceptanceBar({ ...passing, clause_identification_f1: 0.7 }, SPRINT_1_ACCEPTANCE_BAR)
    expect(r.passed).toBe(false)
    expect(r.failures.some((f) => f.includes('F1'))).toBe(true)
  })

  it('fails on hallucination above bar', () => {
    const r = checkAcceptanceBar({ ...passing, hallucination_rate: 0.05 }, SPRINT_1_ACCEPTANCE_BAR)
    expect(r.passed).toBe(false)
    expect(r.failures.some((f) => f.includes('hallucination'))).toBe(true)
  })

  it('fails on citation validity < 1', () => {
    const r = checkAcceptanceBar({ ...passing, citation_validity_rate: 0.99 }, SPRINT_1_ACCEPTANCE_BAR)
    expect(r.passed).toBe(false)
    expect(r.failures.some((f) => f.includes('citation'))).toBe(true)
  })

  it('only enforces redline appropriateness when present', () => {
    expect(checkAcceptanceBar(passing, SPRINT_1_ACCEPTANCE_BAR).passed).toBe(true)
    const failing = checkAcceptanceBar(
      { ...passing, redline_appropriateness: 2 /* /5 = 0.4 < 0.8 */ },
      SPRINT_1_ACCEPTANCE_BAR,
    )
    expect(failing.passed).toBe(false)
    expect(failing.failures.some((f) => f.includes('redline'))).toBe(true)
  })
})

// ─── buildRunResult ──────────────────────────────────────────────────────────

describe('buildRunResult', () => {
  it('assembles a complete EvalRunResult with timestamp and aggregate', () => {
    const r = buildRunResult({
      sprint: 'sprint-1',
      pipeline: 'stub',
      models: { sonnet: 'claude-sonnet-test' },
      perNda: [],
      gitSha: 'abc1234',
    })
    expect(r.sprint).toBe('sprint-1')
    expect(r.pipeline).toBe('stub')
    expect(r.git_sha).toBe('abc1234')
    expect(r.aggregate.cases).toBe(0)
    expect(r.ran_at).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })
})
