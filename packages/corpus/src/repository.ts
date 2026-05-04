// Corpus database operations.
//
// Wraps `corpus_sources`, `corpus_ingestion_runs`, `corpus_documents`,
// `corpus_chunks`. Hosted in @parasol/corpus rather than @parasol/core
// because all four tables are corpus-specific; @parasol/core hosts only
// platform-shared entities (workspaces, profiles, reviews, audit_log).

import { BaseRepository, type Tables, type TablesInsert } from '@parasol/core'
import { NotFoundError } from '@parasol/core'
import type { Chunk } from './types'

export type CorpusSource = Tables<'corpus_sources'>
export type CorpusDocument = Tables<'corpus_documents'>
export type CorpusIngestionRun = Tables<'corpus_ingestion_runs'>
export type CorpusChunkRow = Tables<'corpus_chunks'>

type DocumentInsertRow = TablesInsert<'corpus_documents'>
type ChunkInsertRow = TablesInsert<'corpus_chunks'>
type RunInsertRow = TablesInsert<'corpus_ingestion_runs'>

export class CorpusRepository extends BaseRepository {
  // ─── Sources ────────────────────────────────────────────────────────────

  async listSources(): Promise<CorpusSource[]> {
    const { data, error } = await this.supabase
      .from('corpus_sources')
      .select('*')
      .order('jurisdiction')
      .order('name')
    if (error) throw error
    return data ?? []
  }

  async getSourceBySlug(slug: string): Promise<CorpusSource> {
    const { data, error } = await this.supabase
      .from('corpus_sources')
      .select('*')
      .eq('slug', slug)
      .maybeSingle()
    if (error) throw error
    if (!data) throw new NotFoundError('CorpusSource', slug)
    return data
  }

  async updateSourceStatus(
    sourceId: string,
    status: CorpusSource['status'],
    extras: { lastRunAt?: Date; documentCount?: number } = {},
  ): Promise<void> {
    const update: Partial<TablesInsert<'corpus_sources'>> = {
      status,
      updated_at: new Date().toISOString(),
    }
    if (extras.lastRunAt) update.last_run_at = extras.lastRunAt.toISOString()
    if (typeof extras.documentCount === 'number') {
      update.document_count = extras.documentCount
    }
    const { error } = await this.supabase
      .from('corpus_sources')
      .update(update)
      .eq('id', sourceId)
    if (error) throw error
  }

  // ─── Ingestion runs ─────────────────────────────────────────────────────

  async createRun(input: {
    sourceId: string
    triggeredBy: string | null
  }): Promise<CorpusIngestionRun> {
    const row: RunInsertRow = {
      source_id: input.sourceId,
      triggered_by: input.triggeredBy,
      status: 'running',
      started_at: new Date().toISOString(),
    }
    const { data, error } = await this.supabase
      .from('corpus_ingestion_runs')
      .insert(row)
      .select('*')
      .single()
    if (error) throw error
    return data
  }

  async completeRun(
    runId: string,
    summary: {
      status: 'completed' | 'failed'
      documentsProcessed: number
      documentsAdded: number
      documentsUpdated: number
      errors: Array<{ canonicalId: string; message: string }>
    },
  ): Promise<void> {
    const { error } = await this.supabase
      .from('corpus_ingestion_runs')
      .update({
        status: summary.status,
        completed_at: new Date().toISOString(),
        documents_processed: summary.documentsProcessed,
        documents_added: summary.documentsAdded,
        documents_updated: summary.documentsUpdated,
        errors: summary.errors,
      })
      .eq('id', runId)
    if (error) throw error
  }

  // List recent ingestion runs across all sources, newest first. Used by
  // the /admin/corpus dashboard's recent-runs panel. The default limit (50)
  // covers the last week or so of activity at Sprint 1 cadence; callers can
  // narrow further with `sourceId`.
  async listRuns(options: {
    limit?: number
    sourceId?: string
  } = {}): Promise<CorpusIngestionRun[]> {
    let query = this.supabase
      .from('corpus_ingestion_runs')
      .select('*')
      .order('started_at', { ascending: false })
      .limit(options.limit ?? 50)
    if (options.sourceId) {
      query = query.eq('source_id', options.sourceId)
    }
    const { data, error } = await query
    if (error) throw error
    return data ?? []
  }

  // Aggregate health metrics for the admin dashboard's summary card.
  // Counts are exact (Postgres `count: 'exact', head: true` returns the
  // total without payload). Cheaper than `select('*').length` because no
  // rows are streamed.
  async healthSummary(): Promise<{
    totalDocuments: number
    totalChunks: number
    healthySources: number
    erroredSources: number
  }> {
    const [docs, chunks, sources] = await Promise.all([
      this.supabase.from('corpus_documents').select('*', { count: 'exact', head: true }),
      this.supabase.from('corpus_chunks').select('*', { count: 'exact', head: true }),
      this.supabase.from('corpus_sources').select('status'),
    ])
    if (docs.error) throw docs.error
    if (chunks.error) throw chunks.error
    if (sources.error) throw sources.error

    const sourceRows = (sources.data ?? []) as Array<{ status: string }>
    const healthy = sourceRows.filter((s) => s.status === 'healthy' || s.status === 'idle').length
    const errored = sourceRows.filter((s) => s.status === 'error' || s.status === 'warning').length

    return {
      totalDocuments: docs.count ?? 0,
      totalChunks: chunks.count ?? 0,
      healthySources: healthy,
      erroredSources: errored,
    }
  }

  // ─── Documents ──────────────────────────────────────────────────────────

  // Returns the existing document for (source_type, jurisdiction, canonical_id)
  // if one exists at any retrieved_at, ordered by latest retrieval first.
  async findLatestDocument(
    sourceType: string,
    jurisdiction: string,
    canonicalId: string,
  ): Promise<CorpusDocument | null> {
    const { data, error } = await this.supabase
      .from('corpus_documents')
      .select('*')
      .eq('source_type', sourceType)
      .eq('jurisdiction', jurisdiction)
      .eq('canonical_id', canonicalId)
      .order('retrieved_at', { ascending: false })
      .limit(1)
    if (error) throw error
    return data?.[0] ?? null
  }

  async createDocument(input: Omit<DocumentInsertRow, 'created_at' | 'id'>): Promise<CorpusDocument> {
    const { data, error } = await this.supabase
      .from('corpus_documents')
      .insert(input)
      .select('*')
      .single()
    if (error) throw error
    return data
  }

  // Mark a document superseded by a newer revision. Used by re-ingestion.
  async markSuperseded(oldId: string, newId: string): Promise<void> {
    const { error } = await this.supabase
      .from('corpus_documents')
      .update({
        superseded_at: new Date().toISOString(),
        superseded_by_id: newId,
      })
      .eq('id', oldId)
    if (error) throw error
  }

  // ─── Chunks ─────────────────────────────────────────────────────────────

  async insertChunks(documentId: string, chunks: Chunk[]): Promise<void> {
    if (chunks.length === 0) return
    const rows: ChunkInsertRow[] = chunks.map((c) => ({
      document_id: documentId,
      chunk_index: c.chunkIndex,
      hierarchy: c.hierarchy,
      text: c.text,
      text_with_context: c.textWithContext,
      clause_types: c.clauseTypes,
      area_of_law: c.areaOfLaw,
      embedding: c.embedding,
    }))
    // Insert in batches of 100 to stay under PostgREST default request size.
    for (let i = 0; i < rows.length; i += 100) {
      const batch = rows.slice(i, i + 100)
      const { error } = await this.supabase.from('corpus_chunks').insert(batch)
      if (error) throw error
    }
  }

  async deleteChunksForDocument(documentId: string): Promise<void> {
    const { error } = await this.supabase
      .from('corpus_chunks')
      .delete()
      .eq('document_id', documentId)
    if (error) throw error
  }
}
