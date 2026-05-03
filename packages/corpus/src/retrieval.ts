// Hybrid retrieval over the corpus.
//
// Stages:
//   1. Embed the query (Voyage-3 query-mode)
//   2. BM25 retrieval (Postgres FTS via bm25_corpus_chunks RPC)
//   3. Dense retrieval (pgvector cosine via match_corpus_chunks RPC)
//   4. Reciprocal Rank Fusion merge of the two ranked lists
//   5. Voyage rerank-2 on the top-30 RRF results (optional but default-on)
//   6. Return top K with full chunk text, hierarchy, document metadata, score
//
// BM25 over-favours lexical matches; dense over-favours semantic. RRF mediates
// at low cost; the reranker mediates more precisely on the top slice.

import { VoyageAIClient } from 'voyageai'
import { CorpusError } from '@parasol/core'
import type {
  SupabaseClient,
  CorpusChunkSearchResult,
  CorpusChunkBm25Result,
  Jurisdiction,
  ClauseType,
  DocumentType,
} from '@parasol/core'
import { embedTexts } from './embedder.js'

// ─── Public API ──────────────────────────────────────────────────────────────

export interface RetrievalOptions {
  jurisdictions: Jurisdiction[]
  clauseTypes?: ClauseType[]
  documentTypes?: DocumentType[]
  // Total results to return after rerank. Default: 10.
  topK?: number
  // Per-source candidate pool size before fusion. Default: 50.
  candidateK?: number
  // Reciprocal-rank-fusion constant. Default: 60 (per the original paper).
  rrfK?: number
  // Skip the Voyage rerank step. Default: false (rerank by default).
  skipRerank?: boolean
  // Maximum candidates to send to the reranker. Default: 30.
  rerankPoolSize?: number
}

export interface AuthorityResult {
  chunkId: string
  documentId: string
  documentCanonicalId: string
  documentTitle: string
  documentSourceType: string
  documentJurisdiction: string
  documentSourceUrl: string
  hierarchy: string[]
  text: string
  textWithContext: string
  clauseTypes: string[]
  areaOfLaw: string[]
  // Final relevance score after rerank (or RRF score if rerank skipped).
  // Higher is better. Not directly comparable across queries.
  score: number
  // Provenance: did this chunk surface via BM25, dense, or both?
  matchedVia: ('bm25' | 'dense')[]
}

export interface RetrievalContext {
  supabase: SupabaseClient
  voyage?: VoyageAIClient  // optional override; lazy-init from env otherwise
}

let _voyage: VoyageAIClient | null = null

function getVoyage(): VoyageAIClient {
  if (_voyage) return _voyage
  const apiKey = process.env['VOYAGE_API_KEY']
  if (!apiKey) {
    throw new CorpusError(
      'VOYAGE_API_KEY not configured; required for Voyage rerank in retrieval.',
      'voyage',
    )
  }
  _voyage = new VoyageAIClient({ apiKey })
  return _voyage
}

// Test hook.
export function overrideVoyageClient(client: VoyageAIClient | null): void {
  _voyage = client
}

// ─── retrieveAuthority ──────────────────────────────────────────────────────

export async function retrieveAuthority(
  query: string,
  options: RetrievalOptions,
  ctx: RetrievalContext,
): Promise<AuthorityResult[]> {
  if (options.jurisdictions.length === 0) {
    throw new CorpusError('retrieveAuthority requires at least one jurisdiction')
  }

  const candidateK = options.candidateK ?? 50
  const topK = options.topK ?? 10
  const rrfK = options.rrfK ?? 60
  const rerankPoolSize = options.rerankPoolSize ?? 30

  // Sprint 1 only supports a single jurisdiction per call (the RPC takes a
  // single text param, not an array). Multi-jurisdiction queries are deferred
  // to v2 — if one is requested, we use the first jurisdiction and note the
  // limitation in HANDOFF rather than silently returning an empty result.
  const jurisdiction = options.jurisdictions[0]!

  // Stages 1-3 in parallel: query embedding + BM25 + (vector waits on embed).
  const [queryEmbedding, bm25Results] = await Promise.all([
    embedQuery(query),
    runBm25(ctx.supabase, query, candidateK, jurisdiction, options),
  ])
  const vectorResults = await runVector(
    ctx.supabase,
    queryEmbedding,
    candidateK,
    jurisdiction,
    options,
  )

  // Stage 4: RRF merge.
  const fused = reciprocalRankFusion(bm25Results, vectorResults, rrfK)

  // Stage 5: rerank (optional). Only the top `rerankPoolSize` candidates are
  // sent to Voyage; the long tail is dropped.
  let final = fused.slice(0, rerankPoolSize)
  if (!options.skipRerank && final.length > 0) {
    final = await voyageRerank(query, final, ctx.voyage)
  }

  return final.slice(0, topK)
}

// ─── Stages ──────────────────────────────────────────────────────────────────

async function embedQuery(query: string): Promise<number[]> {
  const [vec] = await embedTexts([query], { inputType: 'query' })
  if (!vec) throw new CorpusError('Voyage returned no embedding for query')
  return vec
}

async function runBm25(
  supabase: SupabaseClient,
  queryText: string,
  matchCount: number,
  jurisdiction: Jurisdiction,
  options: RetrievalOptions,
): Promise<CorpusChunkBm25Result[]> {
  const { data, error } = await supabase.rpc('bm25_corpus_chunks', {
    query_text: queryText,
    match_count: matchCount,
    jurisdiction_filter: jurisdiction,
    source_type_filter: options.documentTypes ?? null,
    clause_types_filter: options.clauseTypes ?? null,
  })
  if (error) throw new CorpusError(`bm25_corpus_chunks failed: ${error.message}`)
  return data ?? []
}

async function runVector(
  supabase: SupabaseClient,
  queryEmbedding: number[],
  matchCount: number,
  jurisdiction: Jurisdiction,
  options: RetrievalOptions,
): Promise<CorpusChunkSearchResult[]> {
  const { data, error } = await supabase.rpc('match_corpus_chunks', {
    query_embedding: queryEmbedding,
    match_count: matchCount,
    jurisdiction_filter: jurisdiction,
    source_type_filter: options.documentTypes ?? null,
    clause_types_filter: options.clauseTypes ?? null,
  })
  if (error) throw new CorpusError(`match_corpus_chunks failed: ${error.message}`)
  return data ?? []
}

// Reciprocal Rank Fusion. Pure function; testable without a DB.
//
// score(d) = sum over rankings of 1 / (k + rank_in_ranking(d))
//
// Items present in both rankings score higher than items in only one. The
// constant `k` (default 60 per the original paper) dampens the influence of
// top-ranked items so a single first-place result doesn't dominate.
//
// Each input list is assumed to be already sorted by its native score. Order
// in the array determines rank (index 0 = rank 1).
export function reciprocalRankFusion(
  bm25: CorpusChunkBm25Result[],
  vector: CorpusChunkSearchResult[],
  k = 60,
): AuthorityResult[] {
  type Acc = {
    row: AuthorityResult
    bm25Rank: number | null
    vectorRank: number | null
  }
  const map = new Map<string, Acc>()

  for (let i = 0; i < bm25.length; i++) {
    const r = bm25[i]!
    map.set(r.id, {
      row: rowFromBm25(r),
      bm25Rank: i + 1,
      vectorRank: null,
    })
  }
  for (let i = 0; i < vector.length; i++) {
    const r = vector[i]!
    const existing = map.get(r.id)
    if (existing) {
      existing.vectorRank = i + 1
    } else {
      map.set(r.id, {
        row: rowFromVector(r),
        bm25Rank: null,
        vectorRank: i + 1,
      })
    }
  }

  const fused: AuthorityResult[] = []
  for (const acc of map.values()) {
    let score = 0
    const matchedVia: ('bm25' | 'dense')[] = []
    if (acc.bm25Rank !== null) {
      score += 1 / (k + acc.bm25Rank)
      matchedVia.push('bm25')
    }
    if (acc.vectorRank !== null) {
      score += 1 / (k + acc.vectorRank)
      matchedVia.push('dense')
    }
    fused.push({ ...acc.row, score, matchedVia })
  }

  fused.sort((a, b) => b.score - a.score)
  return fused
}

function rowFromBm25(r: CorpusChunkBm25Result): AuthorityResult {
  return {
    chunkId: r.id,
    documentId: r.document_id,
    documentCanonicalId: r.document_canonical_id,
    documentTitle: r.document_title,
    documentSourceType: r.document_source_type,
    documentJurisdiction: r.document_jurisdiction,
    documentSourceUrl: r.document_source_url,
    hierarchy: r.hierarchy,
    text: r.text,
    textWithContext: r.text_with_context,
    clauseTypes: r.clause_types,
    areaOfLaw: r.area_of_law,
    score: 0,
    matchedVia: [],
  }
}

function rowFromVector(r: CorpusChunkSearchResult): AuthorityResult {
  return {
    chunkId: r.id,
    documentId: r.document_id,
    documentCanonicalId: r.document_canonical_id,
    documentTitle: r.document_title,
    documentSourceType: r.document_source_type,
    documentJurisdiction: r.document_jurisdiction,
    documentSourceUrl: r.document_source_url,
    hierarchy: r.hierarchy,
    text: r.text,
    textWithContext: r.text_with_context,
    clauseTypes: r.clause_types,
    areaOfLaw: r.area_of_law,
    score: 0,
    matchedVia: [],
  }
}

// Send the candidates to Voyage rerank-2; reorder by the returned relevance
// scores. Preserves all other AuthorityResult fields.
async function voyageRerank(
  query: string,
  candidates: AuthorityResult[],
  voyageOverride?: VoyageAIClient,
): Promise<AuthorityResult[]> {
  if (candidates.length === 0) return candidates
  const client = voyageOverride ?? getVoyage()
  const model = process.env['VOYAGE_RERANK_MODEL'] ?? 'rerank-2'

  const response = await client.rerank({
    query,
    documents: candidates.map((c) => c.text),
    model,
  })
  const results = response.data
  if (!results) {
    // Reranker returned nothing; fall back to the RRF order rather than
    // dropping the request entirely.
    return candidates
  }

  // Voyage returns { index, relevance_score } per candidate.
  return results
    .map((r) => {
      if (typeof r.index !== 'number') return null
      const original = candidates[r.index]
      if (!original) return null
      return { ...original, score: r.relevanceScore ?? 0 }
    })
    .filter((r): r is AuthorityResult => r !== null)
}
