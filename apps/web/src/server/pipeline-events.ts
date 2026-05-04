// Pipeline-events binder — converts orchestrator-emitted PipelineEvents into
// pipeline_events DB rows.
//
// The orchestrator (`@parasol/ai`) emits events through a callback the caller
// supplies. We construct that callback here, bound to a specific reviewId and
// the workspace's PipelineEventRepository. Persistence failures are caught
// and logged: an observability write failing must not abort the actual review.
//
// Returned shape mirrors `OrchestratorContext.emitEvent`'s signature
// (`(event: PipelineEvent) => void`), so the caller can pass it straight into
// `runOrchestrator({ ..., emitEvent })`.

import type { PipelineEvent } from '@parasol/ai'
import { PipelineEventRepository } from '@parasol/core'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@parasol/core'

export interface BindEventsInput {
  supabase: SupabaseClient<Database>
  reviewId: string
  // Optional sink for failed persistence — used by tests. Defaults to
  // console.error so production gets stderr output captured by the host.
  onPersistError?: (event: PipelineEvent, cause: unknown) => void
}

export function bindEventsToReview(input: BindEventsInput): (event: PipelineEvent) => void {
  const repo = new PipelineEventRepository(input.supabase)
  const onError = input.onPersistError ?? defaultOnError

  return (event) => {
    // Fire-and-forget: orchestrator emits synchronously; we don't want to
    // block the pipeline on the DB write. Errors surface via onError.
    void repo
      .append({
        reviewId: input.reviewId,
        stage: event.stage,
        status: event.status,
        modelRole: event.modelRole ?? null,
        modelId: event.modelId ?? null,
        promptVersion: event.promptVersion ?? null,
        inputTokens: event.inputTokens ?? null,
        outputTokens: event.outputTokens ?? null,
        cacheReadTokens: event.cacheReadTokens ?? null,
        cacheWriteTokens: event.cacheWriteTokens ?? null,
        durationMs: event.durationMs ?? null,
        retryCount: event.retryCount ?? 0,
        errorMessage: event.errorMessage ?? null,
      })
      .catch((cause) => onError(event, cause))
  }
}

function defaultOnError(event: PipelineEvent, cause: unknown): void {
  console.error('pipeline_events.persist_failed', {
    stage: event.stage,
    status: event.status,
    error: cause instanceof Error ? cause.message : String(cause),
  })
}
