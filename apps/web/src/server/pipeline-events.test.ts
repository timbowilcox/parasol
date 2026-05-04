import { describe, it, expect, vi } from 'vitest'
import { bindEventsToReview } from './pipeline-events'
import type { PipelineEvent } from '@parasol/ai'

// We pass a hand-built fake supabase client. The repository under test only
// calls `.from('pipeline_events').insert(row)` — covered by the chain mock.

interface FakeSupabaseConfig {
  insertBehaviour?: () => Promise<{ error: unknown }>
}

type InsertedRow = Record<string, unknown>
function makeFakeSupabase(cfg: FakeSupabaseConfig = {}) {
  const insert = vi.fn(
    async (_row: InsertedRow) => (cfg.insertBehaviour ? cfg.insertBehaviour() : { error: null }),
  )
  return {
    insert,
    client: { from: vi.fn(() => ({ insert })) },
  }
}

const baseEvent: PipelineEvent = {
  stage: 'triage',
  status: 'completed',
  modelRole: 'haiku',
  modelId: 'claude-haiku-4-5-20251001',
  promptVersion: '0.1.0',
  inputTokens: 1234,
  outputTokens: 56,
  durationMs: 712,
}

describe('bindEventsToReview', () => {
  it('returns a function that persists events to pipeline_events', async () => {
    const fake = makeFakeSupabase()
    const emit = bindEventsToReview({
      supabase: fake.client as never,
      reviewId: 'r-1',
    })

    emit(baseEvent)
    // The emit is fire-and-forget, so the insert is queued microtask-style.
    // Wait one tick before asserting.
    await new Promise((r) => setTimeout(r, 0))

    expect(fake.insert).toHaveBeenCalledTimes(1)
    const row = fake.insert.mock.calls[0]![0]
    expect(row.review_id).toBe('r-1')
    expect(row.stage).toBe('triage')
    expect(row.status).toBe('completed')
    expect(row.model_role).toBe('haiku')
    expect(row.input_tokens).toBe(1234)
    expect(row.duration_ms).toBe(712)
    expect(row.retry_count).toBe(0)
  })

  it('forwards persistence errors to onPersistError instead of throwing', async () => {
    const fake = makeFakeSupabase({
      insertBehaviour: async () => ({ error: new Error('connection refused') }),
    })
    const onError = vi.fn()
    const emit = bindEventsToReview({
      supabase: fake.client as never,
      reviewId: 'r-2',
      onPersistError: onError,
    })

    emit(baseEvent)
    await new Promise((r) => setTimeout(r, 0))

    expect(onError).toHaveBeenCalledTimes(1)
    expect(onError.mock.calls[0]![0]).toEqual(baseEvent)
    const cause = onError.mock.calls[0]![1] as Error
    expect(cause.message).toBe('connection refused')
  })

  it('writes nullable fields as null when missing', async () => {
    const fake = makeFakeSupabase()
    const emit = bindEventsToReview({
      supabase: fake.client as never,
      reviewId: 'r-3',
    })
    emit({ stage: 'assemble-output', status: 'started' })
    await new Promise((r) => setTimeout(r, 0))

    const row = fake.insert.mock.calls[0]![0]
    expect(row.model_role).toBeNull()
    expect(row.input_tokens).toBeNull()
    expect(row.error_message).toBeNull()
    expect(row.retry_count).toBe(0)
  })
})
