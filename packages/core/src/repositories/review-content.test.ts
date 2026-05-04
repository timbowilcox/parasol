import { describe, it, expect, vi } from 'vitest'
import {
  ExtractedClauseRepository,
  IssueRepository,
  CitationRepository,
} from './review-content'
import type { SupabaseClient } from './types'

interface FakeChain {
  insertedRow: unknown
  insertResult: { data: unknown[]; error: Error | null }
}

function buildInsertClient(cfg: FakeChain) {
  const select = vi.fn().mockResolvedValue({ data: cfg.insertResult.data, error: cfg.insertResult.error })
  const insert = vi.fn().mockImplementation((rows: unknown) => {
    cfg.insertedRow = rows
    return { select }
  })
  const from = vi.fn().mockReturnValue({ insert })
  return { client: { from } as unknown as SupabaseClient, insert, from }
}

describe('ExtractedClauseRepository.insertMany', () => {
  it('returns [] without hitting Supabase when given an empty array', async () => {
    const { client, from } = buildInsertClient({ insertedRow: null, insertResult: { data: [], error: null } })
    const repo = new ExtractedClauseRepository(client)
    const result = await repo.insertMany([])
    expect(result).toEqual([])
    expect(from).not.toHaveBeenCalled()
  })

  it('inserts rows and returns the inserted data', async () => {
    const inserted = [{ id: 'c-1', clause_id: 'governing_law', display_name: 'Governing law' }]
    const { client } = buildInsertClient({ insertedRow: null, insertResult: { data: inserted, error: null } })
    const repo = new ExtractedClauseRepository(client)
    const out = await repo.insertMany([{
      review_id: 'r-1',
      clause_id: 'governing_law',
      display_name: 'Governing law',
      raw_text: 'This Agreement is governed by the laws of Kenya.',
      clause_order: 0,
    }])
    expect(out).toHaveLength(1)
    expect(out[0]!.id).toBe('c-1')
  })

  it('throws when Supabase reports an error', async () => {
    const { client } = buildInsertClient({
      insertedRow: null,
      insertResult: { data: [], error: new Error('insert failed') },
    })
    const repo = new ExtractedClauseRepository(client)
    await expect(repo.insertMany([{
      review_id: 'r-1',
      clause_id: 'c1',
      display_name: 'd',
      raw_text: 't',
      clause_order: 0,
    }])).rejects.toThrow('insert failed')
  })
})

describe('IssueRepository.insertMany', () => {
  it('returns the inserted rows so the caller can attach citations by id', async () => {
    const inserted = [
      { id: 'i-1', clause_id: 'governing_law', severity: 'critical' },
      { id: 'i-2', clause_id: 'data_protection', severity: 'material' },
    ]
    const { client } = buildInsertClient({ insertedRow: null, insertResult: { data: inserted, error: null } })
    const repo = new IssueRepository(client)
    const out = await repo.insertMany([
      {
        review_id: 'r-1', clause_id: 'governing_law', severity: 'critical',
        confidence: 'high', current_position: 'cp', recommended_position: 'rp',
        reasoning: 'r', issue_order: 0,
      },
      {
        review_id: 'r-1', clause_id: 'data_protection', severity: 'material',
        confidence: 'medium', current_position: 'cp', recommended_position: 'rp',
        reasoning: 'r', issue_order: 1,
      },
    ])
    expect(out).toHaveLength(2)
    expect(out[0]!.id).toBe('i-1')
    expect(out[1]!.id).toBe('i-2')
  })
})

describe('CitationRepository.listForIssues', () => {
  it('returns [] when given no issue ids without hitting Supabase', async () => {
    const from = vi.fn()
    const repo = new CitationRepository({ from } as unknown as SupabaseClient)
    expect(await repo.listForIssues([])).toEqual([])
    expect(from).not.toHaveBeenCalled()
  })

  it('queries with .in("issue_id", [...])', async () => {
    const inResult = vi.fn().mockResolvedValue({ data: [{ id: 'cit-1', issue_id: 'i-1' }], error: null })
    const inFn = vi.fn().mockReturnValue(inResult())
    const select = vi.fn().mockReturnValue({ in: inFn })
    const from = vi.fn().mockReturnValue({ select })
    const repo = new CitationRepository({ from } as unknown as SupabaseClient)
    const out = await repo.listForIssues(['i-1'])
    expect(from).toHaveBeenCalledWith('citations')
    expect(inFn).toHaveBeenCalledWith('issue_id', ['i-1'])
    expect(out).toEqual([{ id: 'cit-1', issue_id: 'i-1' }])
  })
})
