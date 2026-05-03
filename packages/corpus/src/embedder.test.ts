import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { embedTexts, embedChunks, overrideEmbedderClient } from './embedder.js'
import { EmbeddingError } from '@parasol/core'
import type { Chunk } from './types.js'

interface FakeClient {
  embed: ReturnType<typeof vi.fn>
}

const fakeClient = (handler: (input: string[]) => Array<{ embedding: number[] }>): FakeClient => ({
  embed: vi.fn(async ({ input }: { input: string[] }) => ({
    data: handler(input),
  })),
})

const installClient = (c: FakeClient) => overrideEmbedderClient(c as unknown as Parameters<typeof overrideEmbedderClient>[0])

beforeEach(() => {
  process.env['VOYAGE_API_KEY'] = 'test-key'
  overrideEmbedderClient(null)
})

afterEach(() => {
  overrideEmbedderClient(null)
})

describe('embedTexts', () => {
  it('returns empty array for empty input without calling SDK', async () => {
    const client = fakeClient(() => [])
    installClient(client)
    const out = await embedTexts([])
    expect(out).toEqual([])
    expect(client.embed).not.toHaveBeenCalled()
  })

  it('forwards a single small batch and preserves order', async () => {
    const client = fakeClient((input) =>
      input.map((s, i) => ({ embedding: [s.length, i] })),
    )
    installClient(client)
    const out = await embedTexts(['a', 'bb', 'ccc'])
    expect(out).toEqual([
      [1, 0],
      [2, 1],
      [3, 2],
    ])
    expect(client.embed).toHaveBeenCalledTimes(1)
  })

  it('splits input into batches of batchSize', async () => {
    const client = fakeClient((input) => input.map(() => ({ embedding: [0] })))
    installClient(client)
    await embedTexts(['a', 'b', 'c', 'd', 'e'], { batchSize: 2 })
    expect(client.embed).toHaveBeenCalledTimes(3)
    const calls = client.embed.mock.calls.map((c) => (c[0] as { input: string[] }).input)
    expect(calls).toEqual([['a', 'b'], ['c', 'd'], ['e']])
  })

  it('throws EmbeddingError when SDK call fails', async () => {
    const client: FakeClient = {
      embed: vi.fn(async () => {
        throw new Error('voyage 500')
      }),
    }
    installClient(client)
    await expect(embedTexts(['a'])).rejects.toBeInstanceOf(EmbeddingError)
  })

  it('throws EmbeddingError when response length mismatches input', async () => {
    const client = fakeClient(() => [{ embedding: [1] }])  // returns 1 always
    installClient(client)
    await expect(embedTexts(['a', 'b'])).rejects.toBeInstanceOf(EmbeddingError)
  })

  it('uses model env or default', async () => {
    const client = fakeClient(() => [{ embedding: [0] }])
    installClient(client)
    process.env['VOYAGE_EMBEDDING_MODEL'] = 'voyage-3-test'
    await embedTexts(['x'])
    const call = client.embed.mock.calls[0]![0] as { model: string }
    expect(call.model).toBe('voyage-3-test')
  })
})

describe('embedChunks', () => {
  it('mutates each chunk embedding in place', async () => {
    const client = fakeClient((input) =>
      input.map((s) => ({ embedding: [s.length] })),
    )
    installClient(client)

    const chunks: Chunk[] = [
      { chunkIndex: 0, hierarchy: [], text: 't1', textWithContext: 'ctx-text-one', clauseTypes: [], areaOfLaw: [], embedding: null },
      { chunkIndex: 1, hierarchy: [], text: 't2', textWithContext: 'ctx-text-two', clauseTypes: [], areaOfLaw: [], embedding: null },
    ]
    await embedChunks(chunks)
    expect(chunks[0]!.embedding).toEqual([12])
    expect(chunks[1]!.embedding).toEqual([12])
    // Verify it was textWithContext that got embedded, not raw text
    const call = client.embed.mock.calls[0]![0] as { input: string[] }
    expect(call.input).toEqual(['ctx-text-one', 'ctx-text-two'])
  })

  it('returns empty array unchanged for no chunks', async () => {
    const out = await embedChunks([])
    expect(out).toEqual([])
  })
})

describe('embedder requires VOYAGE_API_KEY', () => {
  it('throws EmbeddingError when key is missing on cold init', async () => {
    delete process.env['VOYAGE_API_KEY']
    overrideEmbedderClient(null)
    await expect(embedTexts(['a'])).rejects.toBeInstanceOf(EmbeddingError)
  })
})
