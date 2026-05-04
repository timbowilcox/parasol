// Haiku-assisted tagger for corpus chunks.
//
// For each chunk, asks Haiku to identify which clause types and areas of law
// the text covers. Output is a structured JSON list constrained to the
// controlled vocabulary in @parasol/core.
//
// Tagging is cached by content hash: if the same chunk text is re-embedded
// (e.g. after a chunker tweak that didn't actually change text), tagging
// is not re-run. The cache is in-process by default; production runs should
// pass a persistent cache (Redis or Postgres) once Sprint 4 wires that.

import { createHash } from 'node:crypto'
import { z } from 'zod'
import { createMessage } from '@parasol/ai'
import type { ClauseType } from '@parasol/core'
import type { Chunk, AreaOfLaw } from './types'

// ─── Vocabulary ──────────────────────────────────────────────────────────────
// Mirror these in the prompt and the Zod schema below to make the model's
// output validatable. Drift between core types and this list breaks tagging
// silently — the test suite asserts the lists match.

const CLAUSE_TYPES: readonly ClauseType[] = [
  'assignment', 'audit_rights', 'change_of_control', 'confidentiality_term',
  'counterparts_and_execution', 'data_protection',
  'definition_of_confidential_information', 'delivery', 'dispute_resolution',
  'entire_agreement', 'exclusions_from_confidentiality', 'force_majeure',
  'governing_law', 'indemnification', 'intellectual_property',
  'intellectual_property_ownership', 'license_grant', 'limitation_of_liability',
  'no_obligation_to_proceed', 'no_waiver', 'non_compete', 'non_solicitation',
  'notices', 'payment_terms', 'price_and_fees', 'remedies', 'renewal',
  'representations', 'return_or_destruction', 'severability', 'sla',
  'step_in_rights', 'subcontracting', 'survival', 'term_and_termination',
  'termination_for_cause', 'termination_for_convenience', 'waiver', 'warranty',
] as const

const AREAS_OF_LAW: readonly AreaOfLaw[] = [
  'commercial', 'employment', 'data_protection', 'tax', 'regulatory',
  'corporate', 'litigation', 'intellectual_property', 'real_estate',
  'banking_finance', 'competition', 'constitutional',
] as const

// ─── Output schema ───────────────────────────────────────────────────────────

const tagOutputSchema = z.object({
  clause_types: z.array(z.enum(CLAUSE_TYPES as unknown as [ClauseType, ...ClauseType[]])).default([]),
  area_of_law: z.array(z.enum(AREAS_OF_LAW as unknown as [AreaOfLaw, ...AreaOfLaw[]])).default([]),
})

export interface TagResult {
  clauseTypes: ClauseType[]
  areaOfLaw: AreaOfLaw[]
}

// ─── Cache ───────────────────────────────────────────────────────────────────

export interface TagCache {
  get(key: string): Promise<TagResult | null>
  set(key: string, value: TagResult): Promise<void>
}

export class InMemoryTagCache implements TagCache {
  private readonly map = new Map<string, TagResult>()
  async get(key: string): Promise<TagResult | null> {
    return this.map.get(key) ?? null
  }
  async set(key: string, value: TagResult): Promise<void> {
    this.map.set(key, value)
  }
}

export function contentHash(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

// ─── Tagger ──────────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a Kenyan legal taxonomy assistant. Given a chunk of legal text from a statute, regulation, or judgment, identify which clause types and areas of law the text addresses.

Constraints:
- Only return values from the supplied controlled vocabularies.
- Tag generously when the chunk discusses a clause type, but only when the topic is meaningfully present (not a passing mention).
- Return strict JSON matching the supplied schema. No prose, no markdown.

Clause types vocabulary: ${CLAUSE_TYPES.join(', ')}.
Areas of law vocabulary: ${AREAS_OF_LAW.join(', ')}.`

const USER_TEMPLATE = (text: string) =>
  `Tag this chunk:\n\n---\n${text}\n---\n\nReturn JSON: {"clause_types": [...], "area_of_law": [...]}`

export interface TagOptions {
  cache?: TagCache
  // Test hook: replace the LLM call entirely (e.g. for deterministic unit tests).
  callLlm?: (text: string) => Promise<TagResult>
}

export async function tagChunkText(text: string, opts: TagOptions = {}): Promise<TagResult> {
  const cache = opts.cache
  const key = contentHash(text)
  if (cache) {
    const hit = await cache.get(key)
    if (hit) return hit
  }
  const result = opts.callLlm
    ? await opts.callLlm(text)
    : await callHaiku(text)
  if (cache) await cache.set(key, result)
  return result
}

async function callHaiku(text: string): Promise<TagResult> {
  const response = await createMessage({
    modelRole: 'haiku',
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: USER_TEMPLATE(text) }],
    maxTokens: 512,
  })
  const block = response.content.find((b) => b.type === 'text')
  if (!block || block.type !== 'text') {
    return { clauseTypes: [], areaOfLaw: [] }
  }
  return parseTagResponse(block.text)
}

// Parse a Haiku response and validate against the schema. Tolerates extra
// JSON fences and surrounding prose; failure modes return empty tags rather
// than throwing so a tagger error doesn't kill the whole ingestion.
export function parseTagResponse(raw: string): TagResult {
  // Strip ```json fences if present
  const json = raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim()
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    // Try to extract a JSON object from within the response
    const match = raw.match(/\{[\s\S]*\}/)
    if (!match) return { clauseTypes: [], areaOfLaw: [] }
    try {
      parsed = JSON.parse(match[0])
    } catch {
      return { clauseTypes: [], areaOfLaw: [] }
    }
  }
  const result = tagOutputSchema.safeParse(parsed)
  if (!result.success) return { clauseTypes: [], areaOfLaw: [] }
  return {
    clauseTypes: result.data.clause_types,
    areaOfLaw: result.data.area_of_law,
  }
}

// Tag every chunk in a batch. Mutates each chunk's clauseTypes / areaOfLaw
// in place. Returns the same array.
export async function tagChunks(chunks: Chunk[], opts: TagOptions = {}): Promise<Chunk[]> {
  for (const c of chunks) {
    const tags = await tagChunkText(c.text, opts)
    c.clauseTypes = tags.clauseTypes
    c.areaOfLaw = tags.areaOfLaw
  }
  return chunks
}

// Exported for tests.
export const __testing = { CLAUSE_TYPES, AREAS_OF_LAW, SYSTEM_PROMPT }
