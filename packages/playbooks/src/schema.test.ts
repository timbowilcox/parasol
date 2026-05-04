import { describe, it, expect } from 'vitest'
import { playbookSchema, citationSchema, clauseSchema } from './schema.js'

const minimalClause = {
  id: 'confidentiality_term',
  display_name: 'Term of confidentiality',
  importance: 'critical' as const,
  standard: { position: 'three years', rationale: 'market norm' },
  fallback: { position: 'two years', rationale: 'acceptable' },
  hard_limit: { position: 'one year', rationale: 'absolute floor' },
  citations: [],
}

const minimalPlaybook = {
  schema_version: '1.0' as const,
  jurisdiction: 'kenya' as const,
  contract_type: 'nda' as const,
  display_name: 'NDA',
  description: 'Mutual NDA',
  applicable_industries: ['all'],
  authored_by: 'Test author',
  reviewed_at: null,
  language: 'en' as const,
  last_updated: '2026-05-04',
  clauses: [minimalClause],
}

describe('citationSchema', () => {
  it('accepts a minimal valid citation', () => {
    expect(citationSchema.parse({ source: 'kenya-statute', id: 'dpa-2019' })).toMatchObject({
      source: 'kenya-statute',
      id: 'dpa-2019',
    })
  })
  it('rejects empty id', () => {
    expect(citationSchema.safeParse({ source: 'kenya-statute', id: '' }).success).toBe(false)
  })
  it('rejects unknown source', () => {
    expect(citationSchema.safeParse({ source: 'made-up', id: 'x' }).success).toBe(false)
  })
  it('accepts optional section / note / url', () => {
    const r = citationSchema.parse({
      source: 'kenya-statute',
      id: 'dpa-2019',
      section: 's.49',
      note: 'cross-border transfer',
      url: 'https://new.kenyalaw.org/akn/ke/act/2019/24',
    })
    expect(r.section).toBe('s.49')
    expect(r.url).toContain('kenyalaw')
  })
  it('rejects malformed url', () => {
    expect(citationSchema.safeParse({ source: 'kenya-statute', id: 'x', url: 'not-a-url' }).success).toBe(false)
  })
})

describe('clauseSchema', () => {
  it('requires snake_case id', () => {
    expect(clauseSchema.safeParse({ ...minimalClause, id: 'CamelCase' }).success).toBe(false)
    expect(clauseSchema.safeParse({ ...minimalClause, id: 'has-hyphen' }).success).toBe(false)
    expect(clauseSchema.safeParse({ ...minimalClause, id: '1_starts_with_digit' }).success).toBe(false)
    expect(clauseSchema.safeParse({ ...minimalClause, id: 'ok_id_2' }).success).toBe(true)
  })
  it('rejects empty position text or rationale', () => {
    const broken = { ...minimalClause, standard: { position: '', rationale: 'r' } }
    expect(clauseSchema.safeParse(broken).success).toBe(false)
  })
  it('aliases default to []', () => {
    const c = clauseSchema.parse(minimalClause)
    expect(c.aliases).toEqual([])
  })
  it('citations default to []', () => {
    const c = clauseSchema.parse({ ...minimalClause, citations: undefined })
    expect(c.citations).toEqual([])
  })
})

describe('playbookSchema', () => {
  it('parses a minimal valid playbook', () => {
    const r = playbookSchema.parse(minimalPlaybook)
    expect(r.jurisdiction).toBe('kenya')
    expect(r.contract_type).toBe('nda')
    expect(r.status).toBe('draft')  // default
  })

  it('defaults status to draft when omitted', () => {
    const r = playbookSchema.parse(minimalPlaybook)
    expect(r.status).toBe('draft')
  })

  it('rejects status: production with reviewed_at: null', () => {
    const r = playbookSchema.safeParse({
      ...minimalPlaybook,
      status: 'production',
      reviewed_at: null,
    })
    expect(r.success).toBe(false)
    if (!r.success) {
      expect(r.error.issues.some((i) => i.message.includes('reviewed_at'))).toBe(true)
    }
  })

  it('accepts status: production when reviewed_at is set', () => {
    const r = playbookSchema.parse({
      ...minimalPlaybook,
      status: 'production',
      reviewed_at: '2026-04-15',
    })
    expect(r.status).toBe('production')
  })

  it('rejects malformed last_updated date', () => {
    expect(playbookSchema.safeParse({ ...minimalPlaybook, last_updated: 'May 4 2026' }).success).toBe(false)
    expect(playbookSchema.safeParse({ ...minimalPlaybook, last_updated: '2026-5-4' }).success).toBe(false)
    expect(playbookSchema.safeParse({ ...minimalPlaybook, last_updated: '2026-05-04' }).success).toBe(true)
  })

  it('rejects duplicate clause ids', () => {
    const r = playbookSchema.safeParse({
      ...minimalPlaybook,
      clauses: [minimalClause, minimalClause],
    })
    expect(r.success).toBe(false)
    if (!r.success) {
      expect(r.error.issues.some((i) => i.message.includes('duplicate'))).toBe(true)
    }
  })

  it('rejects empty clauses array', () => {
    expect(playbookSchema.safeParse({ ...minimalPlaybook, clauses: [] }).success).toBe(false)
  })

  it('rejects unknown jurisdiction', () => {
    expect(playbookSchema.safeParse({ ...minimalPlaybook, jurisdiction: 'germany' }).success).toBe(false)
  })

  it('rejects unknown contract_type', () => {
    expect(playbookSchema.safeParse({ ...minimalPlaybook, contract_type: 'will' }).success).toBe(false)
  })
})
