import { createHash } from 'node:crypto'
import { BaseRepository } from './base.js'
import type { Json, Tables, TablesInsert } from './types.js'

export type AuditLog = Tables<'audit_log'>
type AuditLogInsertRow = TablesInsert<'audit_log'>

// Genesis hash for an empty chain — SHA256 of the empty string.
// Stable, well-known constant; do not change without a chain migration.
export const GENESIS_HASH = createHash('sha256').update('').digest('hex')

export interface AppendEventInput {
  workspaceId: string | null  // null = system-level event (e.g. cron jobs)
  actorId: string | null       // null = automated/system action
  action: string               // namespaced: 'review.created', 'admin.corpus.run_triggered', ...
  resourceType?: string | null
  resourceId?: string | null
  payload?: Json
  ipAddress?: string | null
  userAgent?: string | null
}

export interface ChainLink {
  id: string
  actorId: string | null
  action: string
  payload: Json
  previousHash: string
}

// Pure, deterministic hash function for an audit chain link.
// Exported for use by both the repository (on write) and verification tooling
// (on read / chain integrity audit). The formula matches the migration comment:
//   SHA256(id || actor_id || action || payload || previous_hash)
//
// Notes on determinism:
//   - actor_id null → empty string (must match for verifier reproducibility)
//   - payload serialised via stableStringify to be order-independent; otherwise
//     a re-serialised object with the same keys but different insertion order
//     would hash differently and break chain verification.
export function computeChainHash(link: ChainLink): string {
  const actor = link.actorId ?? ''
  const payloadText = stableStringify(link.payload)
  const input = link.id + actor + link.action + payloadText + link.previousHash
  return createHash('sha256').update(input).digest('hex')
}

// Order-independent JSON serialisation. Object keys are sorted; arrays
// preserve order (semantically meaningful). Identical to JSON.stringify on
// primitives and arrays; differs on objects.
export function stableStringify(value: Json): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) {
    return '[' + value.map((v) => stableStringify(v)).join(',') + ']'
  }
  const keys = Object.keys(value).sort()
  const parts = keys.map((k) => {
    const v = value[k]
    if (v === undefined) return null
    return JSON.stringify(k) + ':' + stableStringify(v as Json)
  }).filter((p): p is string => p !== null)
  return '{' + parts.join(',') + '}'
}

export class AuditRepository extends BaseRepository {
  // RACE CONDITION NOTE: this implementation uses a read-then-write pattern.
  // Two concurrent appendEvent calls for the same workspace can produce two
  // rows that both reference the same previous_hash, breaking strict chain
  // integrity. Acceptable for Sprint 1 (audit volume is low: review create /
  // complete + admin actions). Sprint 5 (audit log UI, DEF-044) will add a
  // Postgres `append_audit_event` RPC that does SELECT...FOR UPDATE inside a
  // transaction to make appends atomic per workspace.
  async appendEvent(input: AppendEventInput): Promise<AuditLog> {
    const id = crypto.randomUUID()
    const previousHash = await this.getLatestHash(input.workspaceId)
    const payload: Json = input.payload ?? {}

    const hash = computeChainHash({
      id,
      actorId: input.actorId,
      action: input.action,
      payload,
      previousHash,
    })

    const row: AuditLogInsertRow = {
      id,
      workspace_id: input.workspaceId,
      actor_id: input.actorId,
      action: input.action,
      resource_type: input.resourceType ?? null,
      resource_id: input.resourceId ?? null,
      payload,
      ip_address: input.ipAddress ?? null,
      user_agent: input.userAgent ?? null,
      previous_hash: previousHash,
      hash,
    }

    const { data, error } = await this.supabase
      .from('audit_log')
      .insert(row)
      .select('*')
      .single()

    if (error) throw error
    return data
  }

  // Returns the most recent hash for the given workspace's chain, or
  // GENESIS_HASH if no entries exist yet.
  async getLatestHash(workspaceId: string | null): Promise<string> {
    const base = this.supabase.from('audit_log').select('hash')
    const filtered = workspaceId === null
      ? base.is('workspace_id', null)
      : base.eq('workspace_id', workspaceId)

    const { data, error } = await filtered
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(1)

    if (error) throw error
    return data?.[0]?.hash ?? GENESIS_HASH
  }

  // Verifies chain integrity for a workspace by recomputing every hash from
  // genesis. Returns the index of the first broken link, or null if intact.
  // Sprint 5 audit UI will surface this; Sprint 1 ships the function for tests.
  async verifyChain(workspaceId: string | null): Promise<{ valid: true } | { valid: false; brokenAt: number }> {
    const base = this.supabase
      .from('audit_log')
      .select('id, actor_id, action, payload, previous_hash, hash')
    const filtered = workspaceId === null
      ? base.is('workspace_id', null)
      : base.eq('workspace_id', workspaceId)

    const { data, error } = await filtered
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })

    if (error) throw error
    if (!data) return { valid: true }

    let expectedPrevious = GENESIS_HASH
    for (let i = 0; i < data.length; i++) {
      const row = data[i]!
      if (row.previous_hash !== expectedPrevious) return { valid: false, brokenAt: i }
      const expectedHash = computeChainHash({
        id: row.id,
        actorId: row.actor_id,
        action: row.action,
        payload: row.payload,
        previousHash: row.previous_hash,
      })
      if (row.hash !== expectedHash) return { valid: false, brokenAt: i }
      expectedPrevious = row.hash
    }
    return { valid: true }
  }
}
