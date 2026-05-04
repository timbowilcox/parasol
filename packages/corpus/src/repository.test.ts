import { describe, it, expect, vi } from 'vitest'
import { CorpusRepository } from './repository.js'
import type { SupabaseClient } from '@parasol/core'

// listRuns and healthSummary are read-only and take a small set of
// Supabase chains. We hand-build minimal fake clients per test rather
// than mock @supabase/supabase-js wholesale.

describe('CorpusRepository.listRuns', () => {
  it('orders by started_at desc and applies the default limit of 50', async () => {
    let appliedOrderBy: { column: string; ascending: boolean } | null = null
    let appliedLimit: number | null = null
    let appliedFilter: { column: string; value: string } | null = null

    const limit = vi.fn().mockResolvedValue({
      data: [{ id: 'run-1', started_at: '2026-05-04T10:00:00Z' }],
      error: null,
    })
    const eq = vi.fn().mockImplementation((column: string, value: string) => {
      appliedFilter = { column, value }
      return { limit: (n: number) => { appliedLimit = n; return limit() } }
    })
    const order = vi.fn().mockImplementation((column: string, options: { ascending: boolean }) => {
      appliedOrderBy = { column, ascending: options.ascending }
      return { limit: (n: number) => { appliedLimit = n; return limit() }, eq }
    })
    const select = vi.fn().mockReturnValue({ order })
    const from = vi.fn().mockReturnValue({ select })
    const repo = new CorpusRepository({ from } as unknown as SupabaseClient)

    const runs = await repo.listRuns()
    expect(from).toHaveBeenCalledWith('corpus_ingestion_runs')
    expect(appliedOrderBy).toEqual({ column: 'started_at', ascending: false })
    expect(appliedLimit).toBe(50)
    expect(appliedFilter).toBeNull()
    expect(runs).toHaveLength(1)
  })

  it('applies the source filter when sourceId is provided', async () => {
    const final = vi.fn().mockResolvedValue({ data: [], error: null })
    const eq = vi.fn().mockReturnValue(final())
    const order = vi.fn().mockReturnValue({ limit: () => ({ eq }) })
    const select = vi.fn().mockReturnValue({ order })
    const from = vi.fn().mockReturnValue({ select })
    const repo = new CorpusRepository({ from } as unknown as SupabaseClient)

    await repo.listRuns({ sourceId: 'src-1', limit: 10 })
    expect(eq).toHaveBeenCalledWith('source_id', 'src-1')
  })

  it('throws when Supabase reports an error', async () => {
    const order = vi.fn().mockReturnValue({
      limit: vi.fn().mockResolvedValue({ data: null, error: new Error('db down') }),
    })
    const select = vi.fn().mockReturnValue({ order })
    const from = vi.fn().mockReturnValue({ select })
    const repo = new CorpusRepository({ from } as unknown as SupabaseClient)
    await expect(repo.listRuns()).rejects.toThrow('db down')
  })
})

describe('CorpusRepository.healthSummary', () => {
  it('aggregates counts and bucket-classifies sources by status', async () => {
    const calls: string[] = []
    const from = vi.fn().mockImplementation((table: string) => {
      calls.push(table)
      if (table === 'corpus_documents') {
        return { select: () => Promise.resolve({ data: null, count: 158, error: null }) }
      }
      if (table === 'corpus_chunks') {
        return { select: () => Promise.resolve({ data: null, count: 4221, error: null }) }
      }
      if (table === 'corpus_sources') {
        return {
          select: () => Promise.resolve({
            data: [
              { status: 'healthy' }, { status: 'healthy' },
              { status: 'idle' }, { status: 'error' },
              { status: 'warning' }, { status: 'running' },
            ],
            error: null,
          }),
        }
      }
      throw new Error(`unexpected table ${table}`)
    })
    const repo = new CorpusRepository({ from } as unknown as SupabaseClient)
    const result = await repo.healthSummary()
    expect(result.totalDocuments).toBe(158)
    expect(result.totalChunks).toBe(4221)
    // healthy + idle = 3; error + warning = 2; 'running' counts as neither.
    expect(result.healthySources).toBe(3)
    expect(result.erroredSources).toBe(2)
  })

  it('throws when any of the three queries fails', async () => {
    const from = vi.fn().mockImplementation((table: string) => {
      if (table === 'corpus_documents') {
        return { select: () => Promise.resolve({ data: null, count: 0, error: null }) }
      }
      if (table === 'corpus_chunks') {
        return { select: () => Promise.resolve({ data: null, count: 0, error: new Error('chunks query failed') }) }
      }
      return { select: () => Promise.resolve({ data: [], error: null }) }
    })
    const repo = new CorpusRepository({ from } as unknown as SupabaseClient)
    await expect(repo.healthSummary()).rejects.toThrow('chunks query failed')
  })
})
