// Voyage-3 embedder.
//
// Reads VOYAGE_API_KEY at first call. Embeds in batches of `batchSize`
// (default 128, the Voyage hard cap is 128 inputs / 320k tokens per request).
// Uses the model name from VOYAGE_EMBEDDING_MODEL or 'voyage-3' default.
//
// Embeds `textWithContext` (hierarchy-prefixed) per docs/corpus-pipeline.md.

import { VoyageAIClient } from 'voyageai'
import { EmbeddingError } from '@parasol/core'
import type { Chunk } from './types'

const DEFAULT_MODEL = 'voyage-3'
const DEFAULT_BATCH_SIZE = 128

let _client: VoyageAIClient | null = null

function getClient(): VoyageAIClient {
  if (_client) return _client
  const apiKey = process.env['VOYAGE_API_KEY']
  if (!apiKey) {
    throw new EmbeddingError(
      'VOYAGE_API_KEY not configured. See .env.example for setup.',
    )
  }
  _client = new VoyageAIClient({ apiKey })
  return _client
}

// Test hook — replace the SDK client with a stub.
export function overrideEmbedderClient(client: VoyageAIClient | null): void {
  _client = client
}

export interface EmbedOptions {
  model?: string
  batchSize?: number
  // 'document' for corpus chunks (default), 'query' for retrieval-time queries.
  inputType?: 'document' | 'query'
}

// Embed a list of strings; returns the embeddings in the same order.
// Splits into batches transparently.
export async function embedTexts(
  texts: string[],
  opts: EmbedOptions = {},
): Promise<number[][]> {
  if (texts.length === 0) return []
  const model = opts.model ?? process.env['VOYAGE_EMBEDDING_MODEL'] ?? DEFAULT_MODEL
  const batchSize = opts.batchSize ?? DEFAULT_BATCH_SIZE
  const inputType = opts.inputType ?? 'document'
  const client = getClient()

  const out: number[][] = []
  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize)
    let response
    try {
      response = await client.embed({
        input: batch,
        model,
        inputType,
      })
    } catch (cause) {
      throw new EmbeddingError(
        `Voyage embed failed for batch starting at index ${i}: ${(cause as Error).message}`,
      )
    }
    const data = response.data
    if (!data || data.length !== batch.length) {
      throw new EmbeddingError(
        `Voyage returned ${data?.length ?? 0} embeddings for batch of ${batch.length}`,
      )
    }
    for (const item of data) {
      if (!item.embedding) {
        throw new EmbeddingError('Voyage response missing embedding field')
      }
      out.push(item.embedding)
    }
  }
  return out
}

// Mutates each chunk's `embedding` field in place. Returns the same array
// for fluent chaining.
export async function embedChunks(
  chunks: Chunk[],
  opts: EmbedOptions = {},
): Promise<Chunk[]> {
  if (chunks.length === 0) return chunks
  const texts = chunks.map((c) => c.textWithContext)
  const embeddings = await embedTexts(texts, opts)
  for (let i = 0; i < chunks.length; i++) {
    chunks[i]!.embedding = embeddings[i]!
  }
  return chunks
}
