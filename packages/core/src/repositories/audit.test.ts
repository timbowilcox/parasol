import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createHash } from 'node:crypto'
import {
  AuditRepository,
  GENESIS_HASH,
  computeChainHash,
  stableStringify,
} from './audit'
import type { SupabaseClient } from './types'

// ─── Pure-function tests (no mock needed) ────────────────────────────────────

describe('GENESIS_HASH', () => {
  it('is the SHA256 hash of the empty string', () => {
    const expected = createHash('sha256').update('').digest('hex')
    expect(GENESIS_HASH).toBe(expected)
    expect(GENESIS_HASH).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    )
  })
})

describe('stableStringify', () => {
  it('handles primitives like JSON.stringify', () => {
    expect(stableStringify(null)).toBe('null')
    expect(stableStringify(42)).toBe('42')
    expect(stableStringify('hello')).toBe('"hello"')
    expect(stableStringify(true)).toBe('true')
  })

  it('preserves array order', () => {
    expect(stableStringify([3, 1, 2])).toBe('[3,1,2]')
  })

  it('sorts object keys alphabetically', () => {
    const a = stableStringify({ b: 1, a: 2, c: 3 })
    const b = stableStringify({ c: 3, a: 2, b: 1 })
    expect(a).toBe(b)
    expect(a).toBe('{"a":2,"b":1,"c":3}')
  })

  it('recurses into nested objects', () => {
    const a = stableStringify({ x: { b: 1, a: 2 }, y: [{ q: 1, p: 2 }] })
    const b = stableStringify({ y: [{ p: 2, q: 1 }], x: { a: 2, b: 1 } })
    expect(a).toBe(b)
  })

  it('omits undefined values (matches JSON.stringify semantics)', () => {
    expect(stableStringify({ a: 1, b: undefined as unknown as null } as never))
      .toBe('{"a":1}')
  })
})

describe('computeChainHash', () => {
  const baseLink = {
    id: '11111111-1111-1111-1111-111111111111',
    actorId: '22222222-2222-2222-2222-222222222222',
    action: 'review.created',
    payload: { reviewId: 'r1' },
    previousHash: GENESIS_HASH,
  }

  it('is deterministic for identical inputs', () => {
    expect(computeChainHash(baseLink)).toBe(computeChainHash(baseLink))
  })

  it('changes when any field changes', () => {
    const base = computeChainHash(baseLink)
    expect(computeChainHash({ ...baseLink, id: 'x' })).not.toBe(base)
    expect(computeChainHash({ ...baseLink, actorId: 'x' })).not.toBe(base)
    expect(computeChainHash({ ...baseLink, action: 'x' })).not.toBe(base)
    expect(computeChainHash({ ...baseLink, payload: { reviewId: 'r2' } })).not.toBe(base)
    expect(computeChainHash({ ...baseLink, previousHash: 'x' })).not.toBe(base)
  })

  it('treats null actorId as empty string', () => {
    const fromNull = computeChainHash({ ...baseLink, actorId: null })
    const fromEmpty = computeChainHash({ ...baseLink, actorId: '' as unknown as string })
    expect(fromNull).toBe(fromEmpty)
  })

  it('produces same hash for equivalent payloads with different key order', () => {
    const a = computeChainHash({ ...baseLink, payload: { x: 1, y: 2 } })
    const b = computeChainHash({ ...baseLink, payload: { y: 2, x: 1 } })
    expect(a).toBe(b)
  })

  it('matches the migration formula explicitly', () => {
    const expected = createHash('sha256')
      .update(
        baseLink.id +
          baseLink.actorId +
          baseLink.action +
          stableStringify(baseLink.payload) +
          baseLink.previousHash,
      )
      .digest('hex')
    expect(computeChainHash(baseLink)).toBe(expected)
  })
})

// ─── Repository integration with a mocked SupabaseClient ─────────────────────

interface MockState {
  rows: Array<{
    id: string
    workspace_id: string | null
    actor_id: string | null
    action: string
    payload: unknown
    previous_hash: string
    hash: string
    created_at: string
  }>
}

// Build a SupabaseClient-shaped object that simulates a single audit_log
// table backed by an in-memory array. Returns thenables matching the methods
// the AuditRepository actually calls.
function buildMockClient(state: MockState): SupabaseClient {
  const insert = vi.fn((row: MockState['rows'][number]) => {
    state.rows.push({
      ...row,
      created_at: row.created_at ?? new Date().toISOString(),
    })
    const inserted = state.rows[state.rows.length - 1]!
    return {
      select: () => ({
        single: () => Promise.resolve({ data: inserted, error: null }),
      }),
    }
  })

  const buildSelect = (cols: string) => {
    const filters: Array<(r: MockState['rows'][number]) => boolean> = []
    const orderings: Array<{ key: string; ascending: boolean }> = []
    let limitN: number | null = null

    const builder = {
      eq(col: string, val: unknown) {
        filters.push((r) => (r as Record<string, unknown>)[col] === val)
        return builder
      },
      is(col: string, val: unknown) {
        filters.push((r) => (r as Record<string, unknown>)[col] === val)
        return builder
      },
      order(col: string, opts?: { ascending?: boolean }) {
        orderings.push({ key: col, ascending: opts?.ascending !== false })
        return builder
      },
      limit(n: number) {
        limitN = n
        return resolveQuery()
      },
      then<T>(onFulfilled: (v: { data: unknown; error: null }) => T) {
        return resolveQuery().then(onFulfilled)
      },
    }

    function resolveQuery() {
      let rows = state.rows.filter((r) => filters.every((f) => f(r)))
      for (const o of [...orderings].reverse()) {
        rows = [...rows].sort((a, b) => {
          const av = (a as Record<string, unknown>)[o.key] as string | number
          const bv = (b as Record<string, unknown>)[o.key] as string | number
          if (av === bv) return 0
          return (av < bv ? -1 : 1) * (o.ascending ? 1 : -1)
        })
      }
      if (limitN !== null) rows = rows.slice(0, limitN)
      const projected = cols === '*' ? rows : rows.map((r) => {
        const cs = cols.split(',').map((c) => c.trim())
        const out: Record<string, unknown> = {}
        for (const c of cs) out[c] = (r as Record<string, unknown>)[c]
        return out
      })
      return Promise.resolve({ data: projected, error: null })
    }

    return builder
  }

  return {
    from(table: string) {
      if (table !== 'audit_log') throw new Error(`unexpected table: ${table}`)
      return {
        insert,
        select: (cols: string) => buildSelect(cols),
      }
    },
  } as unknown as SupabaseClient
}

describe('AuditRepository.appendEvent', () => {
  let state: MockState
  let repo: AuditRepository

  beforeEach(() => {
    state = { rows: [] }
    repo = new AuditRepository(buildMockClient(state))
  })

  it('uses GENESIS_HASH as previous_hash for the first entry', async () => {
    const result = await repo.appendEvent({
      workspaceId: 'ws-1',
      actorId: 'u-1',
      action: 'review.created',
      payload: { reviewId: 'r1' },
    })
    expect(result.previous_hash).toBe(GENESIS_HASH)
    expect(result.hash).toBe(
      computeChainHash({
        id: result.id,
        actorId: 'u-1',
        action: 'review.created',
        payload: { reviewId: 'r1' },
        previousHash: GENESIS_HASH,
      }),
    )
  })

  it('chains subsequent entries to the previous hash', async () => {
    const a = await repo.appendEvent({
      workspaceId: 'ws-1',
      actorId: 'u-1',
      action: 'review.created',
      payload: { i: 1 },
    })
    // Microsleep so created_at differs deterministically in the mock
    await new Promise((r) => setTimeout(r, 5))
    const b = await repo.appendEvent({
      workspaceId: 'ws-1',
      actorId: 'u-1',
      action: 'review.completed',
      payload: { i: 2 },
    })
    expect(b.previous_hash).toBe(a.hash)
  })

  it('keeps separate chains per workspace', async () => {
    const a = await repo.appendEvent({
      workspaceId: 'ws-1',
      actorId: null,
      action: 'review.created',
    })
    const b = await repo.appendEvent({
      workspaceId: 'ws-2',
      actorId: null,
      action: 'review.created',
    })
    // Both start from genesis because they are independent chains
    expect(a.previous_hash).toBe(GENESIS_HASH)
    expect(b.previous_hash).toBe(GENESIS_HASH)
  })

  it('keeps system events (workspace_id null) on their own chain', async () => {
    const sys1 = await repo.appendEvent({
      workspaceId: null,
      actorId: null,
      action: 'system.cron.tick',
    })
    await new Promise((r) => setTimeout(r, 5))
    const sys2 = await repo.appendEvent({
      workspaceId: null,
      actorId: null,
      action: 'system.cron.tick',
    })
    expect(sys1.previous_hash).toBe(GENESIS_HASH)
    expect(sys2.previous_hash).toBe(sys1.hash)
  })

  it('verifyChain returns valid for an intact chain', async () => {
    await repo.appendEvent({ workspaceId: 'ws-1', actorId: null, action: 'a' })
    await new Promise((r) => setTimeout(r, 5))
    await repo.appendEvent({ workspaceId: 'ws-1', actorId: null, action: 'b' })
    await new Promise((r) => setTimeout(r, 5))
    await repo.appendEvent({ workspaceId: 'ws-1', actorId: null, action: 'c' })
    const result = await repo.verifyChain('ws-1')
    expect(result).toEqual({ valid: true })
  })

  it('verifyChain detects tampering with a payload', async () => {
    await repo.appendEvent({ workspaceId: 'ws-1', actorId: null, action: 'a', payload: { v: 1 } })
    await new Promise((r) => setTimeout(r, 5))
    await repo.appendEvent({ workspaceId: 'ws-1', actorId: null, action: 'b', payload: { v: 2 } })
    // Tamper: mutate the payload of the first row in place
    state.rows[0]!.payload = { v: 999 }
    const result = await repo.verifyChain('ws-1')
    expect(result).toEqual({ valid: false, brokenAt: 0 })
  })

  it('verifyChain detects tampering with a previous_hash link', async () => {
    await repo.appendEvent({ workspaceId: 'ws-1', actorId: null, action: 'a' })
    await new Promise((r) => setTimeout(r, 5))
    await repo.appendEvent({ workspaceId: 'ws-1', actorId: null, action: 'b' })
    // Tamper: break the link by overwriting the second row's previous_hash
    state.rows[1]!.previous_hash = GENESIS_HASH
    const result = await repo.verifyChain('ws-1')
    expect(result).toEqual({ valid: false, brokenAt: 1 })
  })
})
