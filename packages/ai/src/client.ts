// Anthropic SDK wrapper.
//
// All Anthropic calls in Parasol go through this module per CLAUDE.md.
// Direct instantiation of `Anthropic` elsewhere is forbidden — keep the
// surface area thin so swap-outs (model pinning, observability, retry,
// alternative endpoints) only happen here.

import Anthropic from '@anthropic-ai/sdk'
import type { Message, MessageParam, TextBlockParam } from '@anthropic-ai/sdk/resources/messages'
import type { ModelRole } from '@parasol/core'
import { resolveModel, type ModelEnv } from './types.js'

// ─── Client singleton ────────────────────────────────────────────────────────

let _client: Anthropic | null = null

function getClient(): Anthropic {
  if (_client) return _client
  const apiKey = process.env['ANTHROPIC_API_KEY']
  if (!apiKey) {
    throw new Error(
      'ANTHROPIC_API_KEY not configured. See .env.example for setup.',
    )
  }
  _client = new Anthropic({ apiKey })
  return _client
}

// Test hook: replace the SDK client (e.g. with a vi.fn-based stub). Resets
// on subsequent calls to getClient unless overrideClient is invoked again.
export function overrideClient(client: Anthropic | null): void {
  _client = client
}

// ─── createMessage: the canonical call site ──────────────────────────────────

export interface CreateMessageInput {
  modelRole: ModelRole
  // Either a plain system prompt string, or an array of cacheable text blocks.
  // Use the array form when you want prompt caching: each block can declare
  // cache_control: 'ephemeral' to be cached for ~5 minutes (Anthropic default).
  // Cache blocks must come first; only the first ~4 blocks are cached.
  system?: string | TextBlockParam[]
  messages: MessageParam[]
  maxTokens?: number
  temperature?: number
  // Optional override for the resolved model id (set by Stage runtime when
  // workspace tier or A/B config wants a non-default model).
  modelEnv?: ModelEnv
}

export async function createMessage(input: CreateMessageInput): Promise<Message> {
  const client = getClient()
  const model = resolveModel(input.modelRole, input.modelEnv)
  const maxTokens = input.maxTokens ?? Number(process.env['ANTHROPIC_DEFAULT_MAX_TOKENS'] ?? 8192)

  return client.messages.create({
    model,
    max_tokens: maxTokens,
    temperature: input.temperature,
    system: input.system,
    messages: input.messages,
  })
}

// ─── Cache-control helpers ───────────────────────────────────────────────────

// Build a cache-controlled system block. Use for long, stable context such
// as a playbook or the system prompt itself. Anthropic caches the prefix of
// system blocks marked ephemeral; keep cacheable content at the front.
export function cachedTextBlock(text: string): TextBlockParam {
  return {
    type: 'text',
    text,
    cache_control: { type: 'ephemeral' },
  }
}

// Build an uncached system block. Use for per-call dynamic content that
// shouldn't pollute the cache prefix.
export function plainTextBlock(text: string): TextBlockParam {
  return { type: 'text', text }
}
