import { describe, it, expect } from 'vitest'
import { groundTruthSchema } from './schema.js'

const minimalGt = {
  filename: 'nda-001.pdf',
  annotated_at: '2026-05-04',
  annotated_by: 'parasol-internal-draft',
  expected_issues: [
    {
      clause_id: 'governing_law',
      severity: 'critical' as const,
      description: 'Delaware-governed; outside Kenya hard-limit set.',
    },
  ],
}

describe('groundTruthSchema', () => {
  it('parses a minimal valid annotation', () => {
    const r = groundTruthSchema.parse(minimalGt)
    expect(r.filename).toBe('nda-001.pdf')
    expect(r.expected_issues).toHaveLength(1)
    expect(r.expected_citations).toEqual([])
  })

  it('requires filename, annotated_at, annotated_by', () => {
    expect(groundTruthSchema.safeParse({ ...minimalGt, filename: undefined }).success).toBe(false)
    expect(groundTruthSchema.safeParse({ ...minimalGt, annotated_at: undefined }).success).toBe(false)
    expect(groundTruthSchema.safeParse({ ...minimalGt, annotated_by: '' }).success).toBe(false)
  })

  it('rejects malformed annotated_at', () => {
    expect(groundTruthSchema.safeParse({ ...minimalGt, annotated_at: 'May 4 2026' }).success).toBe(false)
    expect(groundTruthSchema.safeParse({ ...minimalGt, annotated_at: '2026-5-4' }).success).toBe(false)
  })

  it('rejects unknown severity', () => {
    const broken = {
      ...minimalGt,
      expected_issues: [{ ...minimalGt.expected_issues[0], severity: 'urgent' }],
    }
    expect(groundTruthSchema.safeParse(broken).success).toBe(false)
  })

  it('accepts optional fields on issue (required, expected_confidence)', () => {
    const r = groundTruthSchema.parse({
      ...minimalGt,
      expected_issues: [
        {
          ...minimalGt.expected_issues[0],
          required: false,
          expected_confidence: 'medium',
        },
      ],
    })
    expect(r.expected_issues[0]!.required).toBe(false)
    expect(r.expected_issues[0]!.expected_confidence).toBe('medium')
  })

  it('rejects unknown citation source', () => {
    const broken = {
      ...minimalGt,
      expected_citations: [{ source: 'made-up-source', id: 'x' }],
    }
    expect(groundTruthSchema.safeParse(broken).success).toBe(false)
  })

  it('accepts known citation sources with optional section', () => {
    const r = groundTruthSchema.parse({
      ...minimalGt,
      expected_citations: [
        { source: 'kenya-statute', id: '2019/24', section: 's.49' },
        { source: 'odpc-determination', id: 'odpc-2024-1' },
      ],
    })
    expect(r.expected_citations).toHaveLength(2)
  })
})
