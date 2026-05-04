import { describe, it, expect, vi } from 'vitest'
import { validatePlaybook, type CitationResolver } from './validator.js'

const buildPlaybook = (overrides: Record<string, unknown> = {}) => ({
  schema_version: '1.0',
  jurisdiction: 'kenya',
  contract_type: 'nda',
  display_name: 'NDA',
  description: 'Mutual NDA',
  applicable_industries: ['all'],
  authored_by: 'Test',
  reviewed_at: null,
  language: 'en',
  last_updated: '2026-05-04',
  clauses: [
    {
      id: 'confidentiality_term',
      display_name: 'Term',
      importance: 'critical',
      standard: { position: '3y', rationale: 'norm' },
      fallback: { position: '2y', rationale: 'ok' },
      hard_limit: { position: '1y', rationale: 'min' },
      citations: [{ source: 'kenya-statute', id: 'dpa-2019' }],
    },
  ],
  ...overrides,
})

describe('validatePlaybook — schema layer', () => {
  it('returns valid for a well-formed playbook', async () => {
    const r = await validatePlaybook(buildPlaybook())
    expect(r.valid).toBe(true)
  })

  it('returns invalid with structured issues for schema failures', async () => {
    const r = await validatePlaybook({ schema_version: 'wrong' })
    expect(r.valid).toBe(false)
    if (!r.valid) {
      expect(r.issues.length).toBeGreaterThan(0)
      expect(r.issues[0]!.severity).toBe('error')
    }
  })
})

describe('validatePlaybook — critical-clause citation rule', () => {
  it('flags critical clause with no citations as error', async () => {
    const broken = buildPlaybook({
      clauses: [
        {
          id: 'gov_law',
          display_name: 'Governing law',
          importance: 'critical',
          standard: { position: 'Kenya', rationale: 'r' },
          fallback: { position: 'Kenya/UK', rationale: 'r' },
          hard_limit: { position: 'Kenya/UK/Singapore', rationale: 'r' },
          citations: [],
        },
      ],
    })
    const r = await validatePlaybook(broken)
    expect(r.valid).toBe(false)
    if (!r.valid) {
      expect(r.issues.some((i) => i.message.includes('critical') && i.message.includes('at least one citation'))).toBe(true)
    }
  })

  it('does NOT flag material/minor clauses with no citations', async () => {
    const ok = buildPlaybook({
      clauses: [
        {
          id: 'notices',
          display_name: 'Notices',
          importance: 'minor',
          standard: { position: 'p', rationale: 'r' },
          fallback: { position: 'p', rationale: 'r' },
          hard_limit: { position: 'p', rationale: 'r' },
          citations: [],
        },
      ],
    })
    const r = await validatePlaybook(ok)
    expect(r.valid).toBe(true)
  })

  it('warns when a critical clause has only market-norm citations and resolver is active', async () => {
    const playbook = buildPlaybook({
      clauses: [
        {
          id: 'confidentiality_term',
          display_name: 'Term',
          importance: 'critical',
          standard: { position: '3y', rationale: 'norm' },
          fallback: { position: '2y', rationale: 'ok' },
          hard_limit: { position: '1y', rationale: 'min' },
          citations: [{ source: 'market-norm', id: 'parasol-internal-2026q1' }],
        },
      ],
    })
    const resolver: CitationResolver = vi.fn(async () => true)
    const r = await validatePlaybook(playbook, { resolveCitation: resolver })
    expect(r.valid).toBe(true)
    if (r.valid) {
      expect(r.warnings.some((w) => w.message.includes('only references non-corpus sources'))).toBe(true)
    }
  })
})

describe('validatePlaybook — corpus resolution', () => {
  it('reports unresolved corpus citations as errors', async () => {
    const resolver: CitationResolver = vi.fn(async () => false)
    const r = await validatePlaybook(buildPlaybook(), { resolveCitation: resolver })
    expect(r.valid).toBe(false)
    if (!r.valid) {
      expect(r.issues.some((i) => i.message.includes('did not resolve in corpus'))).toBe(true)
    }
    expect(resolver).toHaveBeenCalledWith('kenya-statute', 'dpa-2019')
  })

  it('passes when resolver finds the citation', async () => {
    const resolver: CitationResolver = vi.fn(async () => true)
    const r = await validatePlaybook(buildPlaybook(), { resolveCitation: resolver })
    expect(r.valid).toBe(true)
  })

  it('skips resolver for market-norm / parasol-internal sources', async () => {
    const resolver: CitationResolver = vi.fn(async () => true)
    await validatePlaybook(
      buildPlaybook({
        clauses: [
          {
            id: 'confidentiality_term',
            display_name: 'Term',
            importance: 'material',
            standard: { position: '3y', rationale: 'norm' },
            fallback: { position: '2y', rationale: 'ok' },
            hard_limit: { position: '1y', rationale: 'min' },
            citations: [
              { source: 'market-norm', id: 'parasol-internal-2026q1' },
              { source: 'parasol-internal', id: 'survey-x' },
            ],
          },
        ],
      }),
      { resolveCitation: resolver },
    )
    expect(resolver).not.toHaveBeenCalled()
  })

  it('skips corpus check when no resolver supplied', async () => {
    const r = await validatePlaybook(buildPlaybook())
    expect(r.valid).toBe(true)
    if (r.valid) expect(r.corpusChecked).toBe(false)
  })
})

describe('validatePlaybook — draft status', () => {
  it('warns on draft when allowDraft=true (default)', async () => {
    const r = await validatePlaybook(buildPlaybook({ status: 'draft' }))
    expect(r.valid).toBe(true)
    if (r.valid) {
      expect(r.warnings.some((w) => w.message.includes('draft'))).toBe(true)
    }
  })

  it('errors on draft when allowDraft=false', async () => {
    const r = await validatePlaybook(buildPlaybook({ status: 'draft' }), { allowDraft: false })
    expect(r.valid).toBe(false)
  })

  it('passes silently on production status', async () => {
    const r = await validatePlaybook(
      buildPlaybook({ status: 'production', reviewed_at: '2026-04-15' }),
    )
    expect(r.valid).toBe(true)
    if (r.valid) {
      expect(r.warnings.find((w) => w.message.includes('draft'))).toBeUndefined()
    }
  })
})
