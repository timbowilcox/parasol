import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  retrieveAuthority,
  reciprocalRankFusion,
  overrideVoyageClient,
} from './retrieval.js'
import { overrideEmbedderClient } from './embedder.js'
import type {
  CorpusChunkBm25Result,
  CorpusChunkSearchResult,
  SupabaseClient,
} from '@parasol/core'

const baseRow = (id: string): CorpusChunkBm25Result => ({
  id,
  document_id: `doc-${id}`,
  chunk_index: 0,
  hierarchy: ['Some Act', 'Section 1'],
  text: `chunk text ${id}`,
  text_with_context: `Some Act → Section 1: chunk text ${id}`,
  clause_types: [],
  area_of_law: [],
  rank: 0.5,
  document_canonical_id: `canon-${id}`,
  document_title: `Doc ${id}`,
  document_source_type: 'statute',
  document_jurisdiction: 'kenya',
  document_source_url: `https://example.test/${id}`,
})

const baseVectorRow = (id: string, similarity = 0.8): CorpusChunkSearchResult => ({
  ...baseRow(id),
  similarity,
} as CorpusChunkSearchResult)

// ─── reciprocalRankFusion (pure function) ────────────────────────────────────

describe('reciprocalRankFusion', () => {
  it('returns empty for two empty inputs', () => {
    expect(reciprocalRankFusion([], [])).toEqual([])
  })

  it('preserves single-source results with monotonic score', () => {
    const fused = reciprocalRankFusion(
      [baseRow('a'), baseRow('b'), baseRow('c')],
      [],
    )
    expect(fused).toHaveLength(3)
    expect(fused[0]!.chunkId).toBe('a')
    expect(fused[0]!.score).toBeGreaterThan(fused[1]!.score)
    expect(fused[1]!.score).toBeGreaterThan(fused[2]!.score)
    expect(fused[0]!.matchedVia).toEqual(['bm25'])
  })

  it('boosts items present in both rankings', () => {
    const fused = reciprocalRankFusion(
      [baseRow('a'), baseRow('b'), baseRow('c')],
      [baseVectorRow('c'), baseVectorRow('a'), baseVectorRow('b')],
    )
    // 'a' is rank 1 in BM25, rank 2 in vector — high combined
    // 'c' is rank 3 in BM25, rank 1 in vector — also high
    // 'b' is rank 2 in BM25, rank 3 in vector — middle
    const a = fused.find((r) => r.chunkId === 'a')!
    const b = fused.find((r) => r.chunkId === 'b')!
    const c = fused.find((r) => r.chunkId === 'c')!
    expect(a.matchedVia).toEqual(['bm25', 'dense'])
    expect(b.matchedVia).toEqual(['bm25', 'dense'])
    expect(c.matchedVia).toEqual(['bm25', 'dense'])
    // 'a' should be ranked first (best combined position)
    expect(fused[0]!.chunkId).toBe('a')
  })

  it('matchedVia="dense" only for items present only in vector rankings', () => {
    const fused = reciprocalRankFusion([baseRow('a')], [baseVectorRow('z')])
    const z = fused.find((r) => r.chunkId === 'z')!
    expect(z.matchedVia).toEqual(['dense'])
  })

  it('respects custom k constant', () => {
    const lowK = reciprocalRankFusion([baseRow('a')], [], 1)
    const highK = reciprocalRankFusion([baseRow('a')], [], 1000)
    // With higher k, scores are lower (less weight to top results)
    expect(lowK[0]!.score).toBeGreaterThan(highK[0]!.score)
  })

  it('sorts result by score descending', () => {
    const fused = reciprocalRankFusion(
      [baseRow('a'), baseRow('b'), baseRow('c'), baseRow('d')],
      [baseVectorRow('d'), baseVectorRow('c'), baseVectorRow('b'), baseVectorRow('a')],
    )
    for (let i = 0; i < fused.length - 1; i++) {
      expect(fused[i]!.score).toBeGreaterThanOrEqual(fused[i + 1]!.score)
    }
  })

  it('preserves chunk and document fields from BM25 row when only present there', () => {
    const fused = reciprocalRankFusion([baseRow('a')], [])
    expect(fused[0]!.documentTitle).toBe('Doc a')
    expect(fused[0]!.documentSourceUrl).toBe('https://example.test/a')
    expect(fused[0]!.hierarchy).toEqual(['Some Act', 'Section 1'])
  })
})

// ─── retrieveAuthority orchestration (mocked Supabase + Voyage) ──────────────

interface MockedSupabase {
  rpc: ReturnType<typeof vi.fn>
}

const mockSupabase = (handlers: {
  bm25: CorpusChunkBm25Result[]
  vector: CorpusChunkSearchResult[]
}): MockedSupabase => ({
  rpc: vi.fn(async (fn: string) => {
    if (fn === 'bm25_corpus_chunks') return { data: handlers.bm25, error: null }
    if (fn === 'match_corpus_chunks') return { data: handlers.vector, error: null }
    return { data: null, error: { message: `unexpected rpc: ${fn}` } }
  }),
})

const mockEmbedder = () => ({
  embed: vi.fn(async ({ input }: { input: string[] }) => ({
    data: input.map(() => ({ embedding: Array(1024).fill(0.01) })),
  })),
})

const mockVoyageRerank = (handler: (n: number) => Array<{ index: number; relevanceScore: number }>) => ({
  rerank: vi.fn(async ({ documents }: { documents: string[] }) => ({
    data: handler(documents.length),
  })),
})

beforeEach(() => {
  process.env['VOYAGE_API_KEY'] = 'test-key'
  overrideEmbedderClient(mockEmbedder() as never)
})

afterEach(() => {
  overrideEmbedderClient(null)
  overrideVoyageClient(null)
})

describe('retrieveAuthority', () => {
  it('runs BM25 + vector + RRF + rerank end to end', async () => {
    const supabase = mockSupabase({
      bm25: [baseRow('a'), baseRow('b')],
      vector: [baseVectorRow('b'), baseVectorRow('c')],
    })
    // Rerank reverses the input order
    const voyage = mockVoyageRerank((n) =>
      Array.from({ length: n }, (_, i) => ({ index: n - 1 - i, relevanceScore: 1 - i * 0.1 })),
    )

    const results = await retrieveAuthority(
      'data protection',
      { jurisdictions: ['kenya'], topK: 10 },
      { supabase: supabase as unknown as SupabaseClient, voyage: voyage as never },
    )

    expect(supabase.rpc).toHaveBeenCalledTimes(2)
    expect(supabase.rpc).toHaveBeenCalledWith('bm25_corpus_chunks', expect.any(Object))
    expect(supabase.rpc).toHaveBeenCalledWith('match_corpus_chunks', expect.any(Object))
    expect(voyage.rerank).toHaveBeenCalledTimes(1)
    expect(results.length).toBeGreaterThan(0)
  })

  it('respects topK and trims after rerank', async () => {
    const supabase = mockSupabase({
      bm25: ['a', 'b', 'c', 'd', 'e'].map(baseRow),
      vector: ['a', 'b', 'c', 'd', 'e'].map((id) => baseVectorRow(id)),
    })
    const voyage = mockVoyageRerank((n) =>
      Array.from({ length: n }, (_, i) => ({ index: i, relevanceScore: 1 - i * 0.1 })),
    )

    const results = await retrieveAuthority(
      'q',
      { jurisdictions: ['kenya'], topK: 3 },
      { supabase: supabase as unknown as SupabaseClient, voyage: voyage as never },
    )
    expect(results).toHaveLength(3)
  })

  it('passes filters through to both RPCs', async () => {
    const supabase = mockSupabase({ bm25: [], vector: [] })
    const voyage = mockVoyageRerank(() => [])

    await retrieveAuthority(
      'q',
      {
        jurisdictions: ['kenya'],
        clauseTypes: ['data_protection'],
        documentTypes: ['statute', 'regulation'],
        topK: 5,
      },
      { supabase: supabase as unknown as SupabaseClient, voyage: voyage as never },
    )

    const bm25Args = supabase.rpc.mock.calls.find((c) => c[0] === 'bm25_corpus_chunks')![1]
    const vecArgs = supabase.rpc.mock.calls.find((c) => c[0] === 'match_corpus_chunks')![1]
    expect(bm25Args).toMatchObject({
      jurisdiction_filter: 'kenya',
      clause_types_filter: ['data_protection'],
      source_type_filter: ['statute', 'regulation'],
    })
    expect(vecArgs).toMatchObject({
      jurisdiction_filter: 'kenya',
      clause_types_filter: ['data_protection'],
      source_type_filter: ['statute', 'regulation'],
    })
  })

  it('skips rerank when skipRerank=true', async () => {
    const supabase = mockSupabase({
      bm25: [baseRow('a'), baseRow('b')],
      vector: [],
    })
    const voyage = mockVoyageRerank(() => [])

    const results = await retrieveAuthority(
      'q',
      { jurisdictions: ['kenya'], skipRerank: true },
      { supabase: supabase as unknown as SupabaseClient, voyage: voyage as never },
    )
    expect(voyage.rerank).not.toHaveBeenCalled()
    expect(results.length).toBe(2)
  })

  it('throws CorpusError when no jurisdiction supplied', async () => {
    const supabase = mockSupabase({ bm25: [], vector: [] })
    await expect(
      retrieveAuthority(
        'q',
        { jurisdictions: [] },
        { supabase: supabase as unknown as SupabaseClient },
      ),
    ).rejects.toThrow('jurisdiction')
  })

  it('throws CorpusError when an RPC fails', async () => {
    const supabase: MockedSupabase = {
      rpc: vi.fn(async () => ({ data: null, error: { message: 'pg fail' } })),
    }
    await expect(
      retrieveAuthority(
        'q',
        { jurisdictions: ['kenya'] },
        { supabase: supabase as unknown as SupabaseClient },
      ),
    ).rejects.toThrow(/pg fail/)
  })

  it('falls back to RRF order if reranker returns no data', async () => {
    const supabase = mockSupabase({
      bm25: [baseRow('a'), baseRow('b'), baseRow('c')],
      vector: [],
    })
    const voyage = {
      rerank: vi.fn(async () => ({ data: null })),
    }
    const results = await retrieveAuthority(
      'q',
      { jurisdictions: ['kenya'] },
      { supabase: supabase as unknown as SupabaseClient, voyage: voyage as never },
    )
    // Should still return the RRF-fused list
    expect(results.length).toBe(3)
    expect(results[0]!.chunkId).toBe('a')
  })
})
