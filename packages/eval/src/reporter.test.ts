import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { writeJson, formatSummary, DEFAULT_RESULTS_DIR } from './reporter.js'
import type { EvalRunResult } from './types.js'

const sampleResult: EvalRunResult = {
  ran_at: '2026-05-04T10:00:00.000Z',
  sprint: 'unit-test',
  pipeline: 'stub',
  git_sha: 'abc1234',
  models: { sonnet: 'claude-sonnet-4-7' },
  per_nda: [
    {
      filename: 'nda-001.pdf',
      clause_identification_precision: 1,
      clause_identification_recall: 1,
      clause_identification_f1: 1,
      citation_validity_rate: 1,
      hallucination_rate: 0,
      diagnostics: { matched_issues: [], extra_issues: [], missed_issues: [], invalid_citations: [] },
    },
    {
      filename: 'nda-002.pdf',
      clause_identification_precision: 0.5,
      clause_identification_recall: 0.5,
      clause_identification_f1: 0.5,
      citation_validity_rate: 0.5,
      hallucination_rate: 0.2,
      diagnostics: {
        matched_issues: [],
        extra_issues: [{ clause_id: 'fake', severity: 'minor' }],
        missed_issues: [{ clause_id: 'governing_law', severity: 'critical' }],
        invalid_citations: [{ source: 'kenya-statute', id: 'fake' }],
      },
    },
  ],
  aggregate: {
    cases: 2,
    clause_identification_precision: 0.75,
    clause_identification_recall: 0.75,
    clause_identification_f1: 0.75,
    citation_validity_rate: 0.75,
    hallucination_rate: 0.1,
  },
}

describe('writeJson', () => {
  let dir: string
  beforeAll(async () => {
    dir = await mkdtemp(resolve(tmpdir(), 'parasol-eval-out-'))
  })
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('writes the result JSON to <sprint>.json in the supplied dir', async () => {
    const path = await writeJson(sampleResult, dir)
    expect(path).toBe(resolve(dir, 'unit-test.json'))
    const text = await readFile(path, 'utf8')
    const parsed = JSON.parse(text)
    expect(parsed.sprint).toBe('unit-test')
    expect(parsed.aggregate.cases).toBe(2)
  })

  it('exports a default results dir constant', () => {
    expect(DEFAULT_RESULTS_DIR).toContain('results')
  })
})

describe('formatSummary', () => {
  it('includes all per-NDA filenames and aggregate row', () => {
    const out = formatSummary(sampleResult)
    expect(out).toContain('nda-001.pdf')
    expect(out).toContain('nda-002.pdf')
    expect(out).toContain('AGGREGATE')
  })

  it('shows acceptance-bar verdict', () => {
    const out = formatSummary(sampleResult)
    // F1=0.75 below 0.85 bar → FAIL
    expect(out).toContain('Acceptance bar: FAIL')
  })

  it('lists per-NDA diagnostics for cases with miss/extra/invalid', () => {
    const out = formatSummary(sampleResult)
    expect(out).toContain('Diagnostics')
    expect(out).toContain('missed   :')
    expect(out).toContain('governing_law/critical')
    expect(out).toContain('extra    :')
    expect(out).toContain('invalid  :')
  })

  it('reports models and git_sha when present', () => {
    const out = formatSummary(sampleResult)
    expect(out).toContain('git_sha : abc1234')
    expect(out).toContain('sonnet=claude-sonnet-4-7')
  })

  it('shows PASS verdict when aggregate clears the bar', () => {
    const passing: EvalRunResult = {
      ...sampleResult,
      per_nda: [],
      aggregate: {
        cases: 5,
        clause_identification_precision: 0.95,
        clause_identification_recall: 0.95,
        clause_identification_f1: 0.95,
        citation_validity_rate: 1,
        hallucination_rate: 0.005,
      },
    }
    const out = formatSummary(passing)
    expect(out).toContain('Acceptance bar: PASS')
  })
})
