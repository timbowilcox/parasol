// Ingestion orchestrator.
//
// Coordinates: source slug → fetch documents → normalise → chunk → embed →
// tag → persist. Writes a corpus_ingestion_runs row at start, updates it with
// per-document outcomes, and finalises status at completion.
//
// Idempotency: a document is "added" if no prior corpus_documents row exists
// for (source_type, jurisdiction, canonical_id), otherwise it's "updated"
// (the new row is created and the previous version is marked superseded).
// Re-running with no source changes still inserts a new retrieved_at row;
// callers wanting strict skip semantics should pass `skipUnchanged: true`.

import type { Scraper } from './scrapers/types.js'
import type { CorpusRepository } from './repository.js'
import type {
  IngestedDocumentResult,
  IngestionRunResult,
} from './types.js'
import { normalise } from './normaliser.js'
import { chunk as chunkDocument } from './chunker.js'
import { embedChunks } from './embedder.js'
import { tagChunks, type TagOptions } from './tagger.js'

export interface IngestOptions {
  scraper: Scraper
  repository: CorpusRepository
  // Optional: cap how many documents this run touches (Sprint 1 default = small).
  limit?: number
  // Optional: if true, skip a document when its full_text is byte-identical to
  // the existing latest row's full_text. Saves embed/tag cost on no-op runs.
  skipUnchanged?: boolean
  // Tagger configuration (cache, mock LLM for tests, etc.).
  tagOptions?: TagOptions
  // Triggered-by user id (null for automated runs).
  triggeredBy?: string | null
  // Skip embedding entirely (e.g. when VOYAGE_API_KEY isn't configured for a
  // smoke test). Chunks land in the DB with embedding = null. Sprint-1-only
  // escape hatch.
  skipEmbedding?: boolean
  // Skip tagging entirely. Chunks land with empty clauseTypes/areaOfLaw.
  skipTagging?: boolean
  // Optional progress callback for CLI/UX surfaces.
  onProgress?: (event: ProgressEvent) => void
}

export type ProgressEvent =
  | { type: 'run_started'; runId: string; sourceSlug: string }
  | { type: 'document_started'; canonicalId: string }
  | { type: 'document_completed'; result: IngestedDocumentResult }
  | { type: 'run_completed'; result: IngestionRunResult }

export async function ingestSource(opts: IngestOptions): Promise<IngestionRunResult> {
  const source = await opts.repository.getSourceBySlug(opts.scraper.slug)
  const run = await opts.repository.createRun({
    sourceId: source.id,
    triggeredBy: opts.triggeredBy ?? null,
  })
  await opts.repository.updateSourceStatus(source.id, 'running')
  opts.onProgress?.({ type: 'run_started', runId: run.id, sourceSlug: source.slug })

  const startedAt = new Date()
  const results: IngestedDocumentResult[] = []
  const errors: Array<{ canonicalId: string; message: string }> = []
  let documentsAdded = 0
  let documentsUpdated = 0

  try {
    const ids: string[] = []
    for await (const id of opts.scraper.listAvailable(opts.limit)) {
      ids.push(id)
      if (opts.limit && ids.length >= opts.limit) break
    }

    for (const canonicalId of ids) {
      opts.onProgress?.({ type: 'document_started', canonicalId })
      const docStart = Date.now()
      try {
        const result = await ingestOneDocument(canonicalId, opts)
        result.durationMs = Date.now() - docStart
        results.push(result)
        if (result.outcome === 'added') documentsAdded++
        if (result.outcome === 'updated') documentsUpdated++
        if (result.outcome === 'failed' && result.reason) {
          errors.push({ canonicalId, message: result.reason })
        }
        opts.onProgress?.({ type: 'document_completed', result })
      } catch (cause) {
        const message = (cause as Error).message
        errors.push({ canonicalId, message })
        const failed: IngestedDocumentResult = {
          canonicalId,
          outcome: 'failed',
          reason: message,
          durationMs: Date.now() - docStart,
        }
        results.push(failed)
        opts.onProgress?.({ type: 'document_completed', result: failed })
      }
    }

    await opts.repository.completeRun(run.id, {
      status: errors.length > 0 && documentsAdded + documentsUpdated === 0
        ? 'failed'
        : 'completed',
      documentsProcessed: results.length,
      documentsAdded,
      documentsUpdated,
      errors,
    })
    const finalStatus = errors.length === 0
      ? 'healthy'
      : (documentsAdded + documentsUpdated > 0 ? 'warning' : 'error')
    await opts.repository.updateSourceStatus(source.id, finalStatus, {
      lastRunAt: new Date(),
      documentCount: source.document_count + documentsAdded,
    })

    const completedAt = new Date()
    const result: IngestionRunResult = {
      runId: run.id,
      sourceId: source.id,
      sourceSlug: source.slug,
      startedAt,
      completedAt,
      status: 'completed',
      documentsProcessed: results.length,
      documentsAdded,
      documentsUpdated,
      errors,
      results,
    }
    opts.onProgress?.({ type: 'run_completed', result })
    return result
  } catch (cause) {
    const message = (cause as Error).message
    await opts.repository.completeRun(run.id, {
      status: 'failed',
      documentsProcessed: results.length,
      documentsAdded,
      documentsUpdated,
      errors: [...errors, { canonicalId: '<run>', message }],
    })
    await opts.repository.updateSourceStatus(source.id, 'error', { lastRunAt: new Date() })
    throw cause
  }
}

async function ingestOneDocument(
  canonicalId: string,
  opts: IngestOptions,
): Promise<IngestedDocumentResult> {
  const raw = await opts.scraper.fetchDocument(canonicalId)
  if (!raw) {
    return { canonicalId, outcome: 'skipped', reason: 'not_found_at_source', durationMs: 0 }
  }

  const normalised = normalise(raw)

  // Idempotency: optionally skip when text hasn't changed
  const existing = await opts.repository.findLatestDocument(
    normalised.sourceType,
    normalised.jurisdiction,
    normalised.canonicalId,
  )
  if (opts.skipUnchanged && existing && existing.full_text === normalised.fullText) {
    return {
      canonicalId,
      outcome: 'skipped',
      documentId: existing.id,
      reason: 'unchanged',
      durationMs: 0,
    }
  }

  const chunks = chunkDocument(normalised)
  if (!opts.skipTagging) {
    await tagChunks(chunks, opts.tagOptions ?? {})
  }
  if (!opts.skipEmbedding) {
    await embedChunks(chunks)
  }

  const newDoc = await opts.repository.createDocument({
    source_id: null,  // bound to scraper slug, not source row, for now
    source_type: normalised.sourceType,
    jurisdiction: normalised.jurisdiction,
    canonical_id: normalised.canonicalId,
    title: normalised.title,
    full_text: normalised.fullText,
    source_url: normalised.sourceUrl,
    retrieved_at: normalised.retrievedAt.toISOString(),
    effective_date: normalised.effectiveDate?.toISOString().slice(0, 10) ?? null,
    metadata: normalised.metadata as never,  // jsonb; Json type covers it but TS infer is loose
  })

  await opts.repository.insertChunks(newDoc.id, chunks)

  if (existing) {
    await opts.repository.markSuperseded(existing.id, newDoc.id)
    return {
      canonicalId,
      outcome: 'updated',
      documentId: newDoc.id,
      chunkCount: chunks.length,
      durationMs: 0,
    }
  }
  return {
    canonicalId,
    outcome: 'added',
    documentId: newDoc.id,
    chunkCount: chunks.length,
    durationMs: 0,
  }
}
