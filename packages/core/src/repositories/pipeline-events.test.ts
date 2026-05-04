import { describe, it, expect, vi } from 'vitest'
import { PipelineEventRepository, type PipelineEvent } from './pipeline-events.js'
import type { SupabaseClient } from './types.js'

const sampleRow: PipelineEvent = {
  id: 'pe-1',
  review_id: 'r-1',
  stage: 'triage',
  status: 'completed',
  model_role: 'haiku',
  model_id: 'claude-haiku-4-5-20251001',
  prompt_version: '0.1.0',
  input_tokens: 200,
  output_tokens: 50,
  cache_read_tokens: 0,
  cache_write_tokens: 0,
  duration_ms: 1234,
  retry_count: 0,
  error_message: null,
  created_at: '2026-05-04T12:00:00Z',
}

function buildInsertClient() {
  const insert = vi.fn().mockResolvedValue({ error: null })
  const from = vi.fn().mockReturnValue({ insert })
  return {
    client: { from } as unknown as SupabaseClient,
    spies: { from, insert },
  }
}

function buildSelectClient(result: { data: PipelineEvent[] | null; error: Error | null }) {
  const order = vi.fn().mockResolvedValue(result)
  const eq = vi.fn().mockReturnValue({ order })
  const select = vi.fn().mockReturnValue({ eq })
  const from = vi.fn().mockReturnValue({ select })
  return {
    client: { from } as unknown as SupabaseClient,
    spies: { from, select, eq, order },
  }
}

describe('PipelineEventRepository.append', () => {
  it('writes a row with all common fields populated', async () => {
    const { client, spies } = buildInsertClient()
    const repo = new PipelineEventRepository(client)

    await repo.append({
      reviewId: 'r-1',
      stage: 'triage',
      status: 'completed',
      modelRole: 'haiku',
      modelId: 'claude-haiku-4-5-20251001',
      promptVersion: '0.1.0',
      inputTokens: 200,
      outputTokens: 50,
      durationMs: 1234,
    })

    expect(spies.from).toHaveBeenCalledWith('pipeline_events')
    const row = spies.insert.mock.calls[0]![0] as Record<string, unknown>
    expect(row.review_id).toBe('r-1')
    expect(row.stage).toBe('triage')
    expect(row.status).toBe('completed')
    expect(row.model_role).toBe('haiku')
    expect(row.input_tokens).toBe(200)
    expect(row.duration_ms).toBe(1234)
  })

  it('defaults retry_count to 0 when omitted', async () => {
    const { client, spies } = buildInsertClient()
    const repo = new PipelineEventRepository(client)
    await repo.append({ reviewId: 'r-1', stage: 'triage', status: 'started' })
    const row = spies.insert.mock.calls[0]![0] as Record<string, unknown>
    expect(row.retry_count).toBe(0)
  })

  it('passes nulls for unset optional fields', async () => {
    const { client, spies } = buildInsertClient()
    const repo = new PipelineEventRepository(client)
    await repo.append({ reviewId: 'r-1', stage: 'extract-clauses', status: 'failed' })
    const row = spies.insert.mock.calls[0]![0] as Record<string, unknown>
    expect(row.model_role).toBeNull()
    expect(row.model_id).toBeNull()
    expect(row.prompt_version).toBeNull()
    expect(row.input_tokens).toBeNull()
    expect(row.error_message).toBeNull()
  })

  it('rethrows the supabase error so callers see the failure', async () => {
    const insert = vi.fn().mockResolvedValue({ error: new Error('db down') })
    const from = vi.fn().mockReturnValue({ insert })
    const repo = new PipelineEventRepository({ from } as unknown as SupabaseClient)
    await expect(repo.append({ reviewId: 'r-1', stage: 'x', status: 'started' })).rejects.toThrow('db down')
  })
})

describe('PipelineEventRepository.listForReview', () => {
  it('orders by created_at ascending', async () => {
    const { client, spies } = buildSelectClient({ data: [sampleRow], error: null })
    const repo = new PipelineEventRepository(client)
    const rows = await repo.listForReview('r-1')
    expect(rows).toHaveLength(1)
    expect(spies.eq).toHaveBeenCalledWith('review_id', 'r-1')
    expect(spies.order).toHaveBeenCalledWith('created_at', { ascending: true })
  })

  it('returns [] when supabase returns no data', async () => {
    const { client } = buildSelectClient({ data: null, error: null })
    const repo = new PipelineEventRepository(client)
    expect(await repo.listForReview('missing')).toEqual([])
  })

  it('rethrows the supabase error', async () => {
    const { client } = buildSelectClient({ data: null, error: new Error('rls denied') })
    const repo = new PipelineEventRepository(client)
    await expect(repo.listForReview('r-1')).rejects.toThrow('rls denied')
  })
})
