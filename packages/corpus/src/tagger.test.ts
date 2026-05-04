import { describe, it, expect } from 'vitest'
import {
  tagChunkText,
  tagChunks,
  parseTagResponse,
  contentHash,
  InMemoryTagCache,
  __testing,
} from './tagger'
import type { Chunk } from './types'

describe('contentHash', () => {
  it('is deterministic and changes on input change', () => {
    expect(contentHash('hello')).toBe(contentHash('hello'))
    expect(contentHash('hello')).not.toBe(contentHash('Hello'))
    expect(contentHash('hello')).toMatch(/^[0-9a-f]{64}$/)
  })
})

describe('parseTagResponse', () => {
  it('parses raw JSON', () => {
    const r = parseTagResponse('{"clause_types":["confidentiality_term"],"area_of_law":["commercial"]}')
    expect(r.clauseTypes).toEqual(['confidentiality_term'])
    expect(r.areaOfLaw).toEqual(['commercial'])
  })

  it('strips ```json fences', () => {
    const r = parseTagResponse('```json\n{"clause_types":["governing_law"],"area_of_law":[]}\n```')
    expect(r.clauseTypes).toEqual(['governing_law'])
    expect(r.areaOfLaw).toEqual([])
  })

  it('extracts JSON object from prose-wrapped response', () => {
    const r = parseTagResponse('Sure, here is the result: {"clause_types":["data_protection"],"area_of_law":["data_protection"]} done.')
    expect(r.clauseTypes).toEqual(['data_protection'])
    expect(r.areaOfLaw).toEqual(['data_protection'])
  })

  it('returns empty tags on unparseable response', () => {
    const r = parseTagResponse('not json at all')
    expect(r.clauseTypes).toEqual([])
    expect(r.areaOfLaw).toEqual([])
  })

  it('returns empty tags when values are out of vocabulary', () => {
    const r = parseTagResponse('{"clause_types":["made_up_clause"],"area_of_law":["not_a_real_area"]}')
    expect(r.clauseTypes).toEqual([])
    expect(r.areaOfLaw).toEqual([])
  })

  it('passes through valid subsets', () => {
    const r = parseTagResponse('{"clause_types":["confidentiality_term","governing_law"],"area_of_law":["commercial","data_protection"]}')
    expect(r.clauseTypes).toEqual(['confidentiality_term', 'governing_law'])
    expect(r.areaOfLaw).toEqual(['commercial', 'data_protection'])
  })
})

describe('vocabulary integrity', () => {
  it('CLAUSE_TYPES list is non-empty and unique', () => {
    const set = new Set(__testing.CLAUSE_TYPES)
    expect(set.size).toBe(__testing.CLAUSE_TYPES.length)
    expect(__testing.CLAUSE_TYPES.length).toBeGreaterThan(30)
  })
  it('AREAS_OF_LAW list is non-empty and unique', () => {
    const set = new Set(__testing.AREAS_OF_LAW)
    expect(set.size).toBe(__testing.AREAS_OF_LAW.length)
    expect(__testing.AREAS_OF_LAW.length).toBeGreaterThan(5)
  })
  it('SYSTEM_PROMPT mentions both vocabularies', () => {
    expect(__testing.SYSTEM_PROMPT).toContain('confidentiality_term')
    expect(__testing.SYSTEM_PROMPT).toContain('commercial')
  })
})

describe('tagChunkText with mock LLM', () => {
  it('returns the LLM result and writes to cache', async () => {
    const cache = new InMemoryTagCache()
    let callCount = 0
    const result = await tagChunkText('text about confidentiality', {
      cache,
      callLlm: async () => {
        callCount++
        return { clauseTypes: ['confidentiality_term' as const], areaOfLaw: ['commercial' as const] }
      },
    })
    expect(result.clauseTypes).toEqual(['confidentiality_term'])
    expect(callCount).toBe(1)
  })

  it('returns cached result on second call without re-invoking LLM', async () => {
    const cache = new InMemoryTagCache()
    let callCount = 0
    const callLlm = async () => {
      callCount++
      return { clauseTypes: ['confidentiality_term' as const], areaOfLaw: ['commercial' as const] }
    }
    await tagChunkText('text about confidentiality', { cache, callLlm })
    await tagChunkText('text about confidentiality', { cache, callLlm })
    expect(callCount).toBe(1)
  })

  it('treats different text as different cache entries', async () => {
    const cache = new InMemoryTagCache()
    let callCount = 0
    const callLlm = async () => {
      callCount++
      return { clauseTypes: [], areaOfLaw: [] }
    }
    await tagChunkText('text A', { cache, callLlm })
    await tagChunkText('text B', { cache, callLlm })
    expect(callCount).toBe(2)
  })
})

describe('tagChunks', () => {
  it('mutates each chunk with its tag result', async () => {
    const chunks: Chunk[] = [
      { chunkIndex: 0, hierarchy: [], text: 'a', textWithContext: 'a', clauseTypes: [], areaOfLaw: [], embedding: null },
      { chunkIndex: 1, hierarchy: [], text: 'b', textWithContext: 'b', clauseTypes: [], areaOfLaw: [], embedding: null },
    ]
    let i = 0
    await tagChunks(chunks, {
      callLlm: async () => {
        const tag = i++ === 0
          ? { clauseTypes: ['confidentiality_term' as const], areaOfLaw: ['commercial' as const] }
          : { clauseTypes: ['governing_law' as const], areaOfLaw: ['commercial' as const] }
        return tag
      },
    })
    expect(chunks[0]!.clauseTypes).toEqual(['confidentiality_term'])
    expect(chunks[1]!.clauseTypes).toEqual(['governing_law'])
  })
})
