import { BaseRepository } from './base.js'
import type { Tables, TablesInsert } from './types.js'

// Note: the type Tables<'pipeline_events'> is re-exported from db.ts as
// PipelineEventRow; we re-export the row type here under a name that won't
// collide with the global db.ts re-export.
export type PipelineEvent = Tables<'pipeline_events'>
type PipelineEventInsertRow = TablesInsert<'pipeline_events'>

// Per-stage observability writes. The orchestrator emits PipelineEvents
// (in @parasol/ai/types.ts) at every stage transition; the route handler
// converts them to DB rows via this repository.
export class PipelineEventRepository extends BaseRepository {
  // Append a single event. Used by the orchestrator's emitEvent wire-up.
  async append(input: {
    reviewId: string
    stage: string
    status: 'started' | 'completed' | 'failed' | 'retried'
    modelRole?: string | null
    modelId?: string | null
    promptVersion?: string | null
    inputTokens?: number | null
    outputTokens?: number | null
    cacheReadTokens?: number | null
    cacheWriteTokens?: number | null
    durationMs?: number | null
    retryCount?: number
    errorMessage?: string | null
  }): Promise<void> {
    const row: PipelineEventInsertRow = {
      review_id: input.reviewId,
      stage: input.stage,
      status: input.status,
      model_role: input.modelRole ?? null,
      model_id: input.modelId ?? null,
      prompt_version: input.promptVersion ?? null,
      input_tokens: input.inputTokens ?? null,
      output_tokens: input.outputTokens ?? null,
      cache_read_tokens: input.cacheReadTokens ?? null,
      cache_write_tokens: input.cacheWriteTokens ?? null,
      duration_ms: input.durationMs ?? null,
      retry_count: input.retryCount ?? 0,
      error_message: input.errorMessage ?? null,
    }
    const { error } = await this.supabase.from('pipeline_events').insert(row)
    if (error) throw error
  }

  // List all events for a review in created_at order. Used by the admin
  // observability dashboard (Sprint 5+) and by Day-13 latency analysis.
  async listForReview(reviewId: string): Promise<PipelineEvent[]> {
    const { data, error } = await this.supabase
      .from('pipeline_events')
      .select('*')
      .eq('review_id', reviewId)
      .order('created_at', { ascending: true })
    if (error) throw error
    return data ?? []
  }
}
