import { describe, it, expect } from 'vitest'
import { assembleOutput } from './assemble-output'
import type {
  ExtractedClauseDraft,
  PipelineIssue,
  TriageOutput,
  DefinedTermIssue,
} from './stages/types'

const triage = (overrides: Partial<TriageOutput> = {}): TriageOutput => ({
  contractType: 'nda',
  jurisdiction: 'kenya',
  parties: [
    { role: 'Disclosing Party', name: 'Acme Ltd' },
    { role: 'Receiving Party', name: 'Beta Inc' },
  ],
  confidence: 'high',
  reasoning: 'Standard mutual NDA structure with Kenya governing law.',
  ...overrides,
})

const issue = (overrides: Partial<PipelineIssue> = {}): PipelineIssue => ({
  clauseId: 'governing_law',
  severity: 'critical',
  confidence: 'high',
  currentPosition: 'Delaware-governed.',
  recommendedPosition: 'Kenya-governed.',
  reasoning: 'Delaware is outside the playbook hard-limit set.',
  redlineText: 'This Agreement shall be governed by the laws of Kenya.',
  citations: [
    { source: 'kenya-statute', id: '1995/4', section: 's.36', validated: true },
  ],
  ...overrides,
})

const baseClause: ExtractedClauseDraft = {
  clauseId: 'governing_law',
  displayName: 'Governing law',
  rawText: 'This Agreement is governed by the laws of Delaware.',
  clauseOrder: 0,
}

const baseInput = {
  reviewId: 'review-001',
  triage: triage(),
  clauses: [baseClause],
  issues: [issue()],
  definedTerms: [] as DefinedTermIssue[],
  fullText: 'Section 12. This Agreement is governed by the laws of Delaware.\n\nSection 13. Notices.',
}

// ─── Web view ──────────────────────────────────────────────────────────────

describe('assembleOutput — web view', () => {
  it('includes reviewId, contract type, jurisdiction, parties, summary', async () => {
    const out = await assembleOutput(baseInput)
    expect(out.webView.reviewId).toBe('review-001')
    expect(out.webView.contractType).toBe('nda')
    expect(out.webView.jurisdiction).toBe('kenya')
    expect(out.webView.parties).toHaveLength(2)
    expect(out.webView.summary.critical).toBe(1)
    expect(out.webView.summary.material).toBe(0)
    expect(out.webView.summary.minor).toBe(0)
  })

  it('citationValidityRate counts non-corpus citations as trusted', async () => {
    const out = await assembleOutput({
      ...baseInput,
      issues: [issue({
        citations: [
          { source: 'kenya-statute', id: '1995/4', validated: true },     // resolved
          { source: 'kenya-statute', id: 'fake', validated: false },       // unresolved
          { source: 'market-norm', id: 'parasol-internal', validated: false }, // trusted (non-corpus)
        ],
      })],
    })
    expect(out.webView.summary.citationValidityRate).toBeCloseTo(2 / 3, 5)
  })

  it('passes through severity counts across multiple issues', async () => {
    const out = await assembleOutput({
      ...baseInput,
      issues: [
        issue({ severity: 'critical' }),
        issue({ severity: 'critical', clauseId: 'data_protection' }),
        issue({ severity: 'material', clauseId: 'remedies' }),
        issue({ severity: 'minor', clauseId: 'notices' }),
      ],
    })
    expect(out.webView.summary).toMatchObject({ critical: 2, material: 1, minor: 1 })
  })

  it('includes definedTerms', async () => {
    const out = await assembleOutput({
      ...baseInput,
      definedTerms: [
        { term: 'Permitted Recipients', kind: 'undefined_use', description: 'Never defined.' },
      ],
    })
    expect(out.webView.definedTerms).toHaveLength(1)
    expect(out.webView.definedTerms[0]!.kind).toBe('undefined_use')
  })
})

// ─── Email body ────────────────────────────────────────────────────────────

describe('assembleOutput — email body', () => {
  it('subject suffix includes severity counts', async () => {
    const out = await assembleOutput(baseInput)
    expect(out.email.subjectSuffix).toContain('1 critical')
    expect(out.email.subjectSuffix).toContain('Parasol review')
  })

  it('plain text contains issue clause id, current/recommended, citations', async () => {
    const out = await assembleOutput(baseInput)
    expect(out.email.plainText).toContain('governing_law')
    expect(out.email.plainText).toContain('Delaware-governed')
    expect(out.email.plainText).toContain('Kenya-governed')
    expect(out.email.plainText).toContain('kenya-statute/1995/4')
  })

  it('flags unverified citations in plain text', async () => {
    const out = await assembleOutput({
      ...baseInput,
      issues: [issue({
        citations: [{ source: 'kenya-statute', id: 'fake', validated: false }],
      })],
    })
    expect(out.email.plainText).toContain('[unverified]')
  })

  it('includes citation-validity note when not 100%', async () => {
    const out = await assembleOutput({
      ...baseInput,
      issues: [issue({
        citations: [{ source: 'kenya-statute', id: 'fake', validated: false }],
      })],
    })
    expect(out.email.plainText).toContain('% of citations resolved')
  })

  it('does NOT include citation-validity note when 100%', async () => {
    const out = await assembleOutput(baseInput)  // single resolved citation
    expect(out.email.plainText).not.toContain('% of citations resolved')
  })

  it('html version contains structured issue blocks + escapes html chars', async () => {
    const out = await assembleOutput({
      ...baseInput,
      issues: [issue({
        clauseId: 'governing_law',
        currentPosition: 'Delaware <script>alert(1)</script>.',
      })],
    })
    expect(out.email.html).toContain('<!doctype html>')
    expect(out.email.html).toContain('governing_law')
    expect(out.email.html).toContain('&lt;script&gt;')
    expect(out.email.html).not.toContain('<script>alert')
  })
})

// ─── Redline DOCX ──────────────────────────────────────────────────────────

describe('assembleOutput — redline DOCX', () => {
  it('produces a valid base64-encoded DOCX (zip starting with PK)', async () => {
    const out = await assembleOutput(baseInput)
    expect(out.redlineDocxBase64).toBeTypeOf('string')
    expect(out.redlineDocxBase64.length).toBeGreaterThan(100)
    const bytes = Buffer.from(out.redlineDocxBase64, 'base64')
    // DOCX is a zip; first two bytes are PK (0x50, 0x4B).
    expect(bytes[0]).toBe(0x50)
    expect(bytes[1]).toBe(0x4B)
  })

  it('produces output even with empty issues + empty fullText', async () => {
    const out = await assembleOutput({
      ...baseInput,
      issues: [],
      fullText: '',
    })
    const bytes = Buffer.from(out.redlineDocxBase64, 'base64')
    expect(bytes.length).toBeGreaterThan(100)
  })
})
