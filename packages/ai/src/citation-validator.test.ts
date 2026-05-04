import { describe, it, expect, vi } from 'vitest'
import {
  validateCitations,
  degradeConfidence,
  countTrustedCitations,
  __testing,
} from './citation-validator.js'
import type { PipelineIssue, PipelineCitation } from './stages/types.js'

const issue = (overrides: Partial<PipelineIssue> = {}): PipelineIssue => ({
  clauseId: 'governing_law',
  severity: 'critical',
  confidence: 'high',
  currentPosition: 'Delaware law',
  recommendedPosition: 'Kenya law',
  reasoning: 'Hard-limit jurisdiction violation',
  redlineText: 'This Agreement is governed by the laws of Kenya.',
  citations: [],
  ...overrides,
})

const corpusCitation = (overrides: Partial<PipelineCitation> = {}): PipelineCitation => ({
  source: 'kenya-statute',
  id: '2019/24',
  section: 's.49',
  validated: false,
  ...overrides,
})

const marketNormCitation = (): PipelineCitation => ({
  source: 'market-norm',
  id: 'parasol-internal-2026q1',
  validated: false,
})

// ─── degradeConfidence ──────────────────────────────────────────────────────

describe('degradeConfidence', () => {
  it('high → medium', () => {
    expect(degradeConfidence('high')).toBe('medium')
  })
  it('medium → manual_review_recommended', () => {
    expect(degradeConfidence('medium')).toBe('manual_review_recommended')
  })
  it('manual_review_recommended → unchanged (already at floor)', () => {
    expect(degradeConfidence('manual_review_recommended')).toBe('manual_review_recommended')
  })
})

// ─── countTrustedCitations ──────────────────────────────────────────────────

describe('countTrustedCitations', () => {
  it('counts non-corpus sources as trusted regardless of validated flag', () => {
    const i = issue({ citations: [marketNormCitation()] })
    expect(countTrustedCitations(i)).toBe(1)
  })
  it('counts corpus-source citations only when validated=true', () => {
    const i = issue({
      citations: [
        corpusCitation({ validated: true }),
        corpusCitation({ id: '2015/17', validated: false }),
      ],
    })
    expect(countTrustedCitations(i)).toBe(1)
  })
  it('mixed sources tally correctly', () => {
    const i = issue({
      citations: [
        marketNormCitation(),
        corpusCitation({ validated: true }),
        corpusCitation({ id: 'fake', validated: false }),
      ],
    })
    expect(countTrustedCitations(i)).toBe(2)
  })
})

// ─── validateCitations — resolver path ──────────────────────────────────────

describe('validateCitations — resolver path', () => {
  it('marks resolved corpus citations validated=true and unresolved validated=false', async () => {
    const resolver = vi.fn(async (_s: string, id: string) => id === '2019/24')
    const out = await validateCitations(
      [
        issue({
          citations: [
            corpusCitation({ id: '2019/24' }),
            corpusCitation({ id: 'fake-act' }),
          ],
        }),
      ],
      { resolveCitation: resolver },
    )
    expect(out.issues[0]!.citations[0]!.validated).toBe(true)
    expect(out.issues[0]!.citations[1]!.validated).toBe(false)
    expect(out.totalCitations).toBe(2)
    expect(out.resolvedCitations).toBe(1)
    expect(out.unresolvedCitations).toBe(1)
    expect(out.issuesWithFailures).toBe(1)
  })

  it('skips resolver call for non-corpus sources (market-norm, parasol-internal)', async () => {
    const resolver = vi.fn(async () => true)
    await validateCitations(
      [
        issue({
          citations: [marketNormCitation(), { source: 'parasol-internal', id: 'survey', validated: false }],
        }),
      ],
      { resolveCitation: resolver },
    )
    expect(resolver).not.toHaveBeenCalled()
  })

  it('treats resolver throw as unresolved (conservative-safe)', async () => {
    const resolver = vi.fn(async () => { throw new Error('db down') })
    const out = await validateCitations(
      [issue({ citations: [corpusCitation()] })],
      { resolveCitation: resolver },
    )
    expect(out.issues[0]!.citations[0]!.validated).toBe(false)
    expect(out.issuesWithFailures).toBe(1)
  })

  it('falls back to model-supplied validated flag when no resolver', async () => {
    const out = await validateCitations(
      [
        issue({
          citations: [
            corpusCitation({ validated: true }),
            corpusCitation({ id: 'unverified', validated: false }),
          ],
        }),
      ],
    )
    expect(out.issues[0]!.citations[0]!.validated).toBe(true)
    expect(out.issues[0]!.citations[1]!.validated).toBe(false)
    expect(out.unresolvedCitations).toBe(1)
  })
})

// ─── validateCitations — confidence calibration ─────────────────────────────

describe('validateCitations — confidence calibration', () => {
  it('drops high → medium when ANY citation in the issue fails', async () => {
    const resolver = vi.fn(async () => false)
    const out = await validateCitations(
      [
        issue({
          confidence: 'high',
          citations: [corpusCitation({ id: 'a' }), corpusCitation({ id: 'b' })],
        }),
      ],
      { resolveCitation: resolver },
    )
    expect(out.issues[0]!.confidence).toBe('medium')
  })

  it('drops medium → manual_review_recommended on failure', async () => {
    const resolver = vi.fn(async () => false)
    const out = await validateCitations(
      [issue({ confidence: 'medium', citations: [corpusCitation()] })],
      { resolveCitation: resolver },
    )
    expect(out.issues[0]!.confidence).toBe('manual_review_recommended')
  })

  it('keeps confidence unchanged when all citations resolve', async () => {
    const resolver = vi.fn(async () => true)
    const out = await validateCitations(
      [issue({ confidence: 'high', citations: [corpusCitation()] })],
      { resolveCitation: resolver },
    )
    expect(out.issues[0]!.confidence).toBe('high')
  })

  it('does NOT degrade confidence when issue has only non-corpus citations', async () => {
    const resolver = vi.fn(async () => true)
    const out = await validateCitations(
      [issue({ confidence: 'high', citations: [marketNormCitation()] })],
      { resolveCitation: resolver },
    )
    expect(out.issues[0]!.confidence).toBe('high')
  })
})

// ─── validateCitations — empty + edge cases ────────────────────────────────

describe('validateCitations — edge cases', () => {
  it('returns 0 counts for an issue with no citations', async () => {
    const out = await validateCitations([issue({ citations: [] })])
    expect(out.totalCitations).toBe(0)
    expect(out.issuesWithFailures).toBe(0)
  })

  it('returns empty issues array for empty input', async () => {
    const out = await validateCitations([])
    expect(out.issues).toEqual([])
    expect(out.totalCitations).toBe(0)
  })
})

// ─── Vocabulary integrity ───────────────────────────────────────────────────

describe('CORPUS_BACKED_SOURCES', () => {
  it('mirrors the playbook citation source enum (excluding market-norm + parasol-internal)', () => {
    const corpus = __testing.CORPUS_BACKED_SOURCES
    expect(corpus.has('kenya-statute')).toBe(true)
    expect(corpus.has('odpc-determination')).toBe(true)
    expect(corpus.has('market-norm')).toBe(false)
    expect(corpus.has('parasol-internal')).toBe(false)
  })
})
