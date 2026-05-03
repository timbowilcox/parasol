import { describe, it, expect, vi } from 'vitest'
import { WorkspaceRepository, type Workspace } from './workspaces.js'
import { NotFoundError } from '../errors/index.js'
import type { SupabaseClient } from './types.js'

const sampleWorkspace: Workspace = {
  id: 'ws-1',
  slug: 'acme',
  name: 'Acme Legal',
  tier: 'team',
  seat_limit: 5,
  allowed_sender_domains: ['acme.com'],
  timezone: 'Africa/Nairobi',
  created_at: '2026-05-04T00:00:00Z',
  updated_at: '2026-05-04T00:00:00Z',
}

// Build a SupabaseClient mock where .from('workspaces').select('*').eq(...).maybeSingle()
// resolves to the supplied result. Captures the .eq() arguments for assertion.
function buildClient(result: { data: Workspace | null; error: Error | null }) {
  const eq = vi.fn().mockReturnValue({
    maybeSingle: vi.fn().mockResolvedValue(result),
  })
  const select = vi.fn().mockReturnValue({ eq })
  const from = vi.fn().mockReturnValue({ select })
  return {
    client: { from } as unknown as SupabaseClient,
    spies: { from, select, eq },
  }
}

describe('WorkspaceRepository.getById', () => {
  it('returns the workspace when found', async () => {
    const { client, spies } = buildClient({ data: sampleWorkspace, error: null })
    const repo = new WorkspaceRepository(client)

    const result = await repo.getById('ws-1')

    expect(result).toEqual(sampleWorkspace)
    expect(spies.from).toHaveBeenCalledWith('workspaces')
    expect(spies.select).toHaveBeenCalledWith('*')
    expect(spies.eq).toHaveBeenCalledWith('id', 'ws-1')
  })

  it('throws NotFoundError when no row matches', async () => {
    const { client } = buildClient({ data: null, error: null })
    const repo = new WorkspaceRepository(client)

    await expect(repo.getById('missing')).rejects.toBeInstanceOf(NotFoundError)
  })

  it('rethrows the underlying error when supabase reports one', async () => {
    const dbError = new Error('connection lost')
    const { client } = buildClient({ data: null, error: dbError })
    const repo = new WorkspaceRepository(client)

    await expect(repo.getById('ws-1')).rejects.toBe(dbError)
  })
})

describe('WorkspaceRepository.getBySlug', () => {
  it('queries by slug and returns the workspace', async () => {
    const { client, spies } = buildClient({ data: sampleWorkspace, error: null })
    const repo = new WorkspaceRepository(client)

    const result = await repo.getBySlug('acme')

    expect(result).toEqual(sampleWorkspace)
    expect(spies.eq).toHaveBeenCalledWith('slug', 'acme')
  })

  it('throws NotFoundError when slug not found', async () => {
    const { client } = buildClient({ data: null, error: null })
    const repo = new WorkspaceRepository(client)

    await expect(repo.getBySlug('missing')).rejects.toBeInstanceOf(NotFoundError)
  })
})

describe('WorkspaceRepository.findBySlug', () => {
  it('returns null instead of throwing when slug not found', async () => {
    const { client } = buildClient({ data: null, error: null })
    const repo = new WorkspaceRepository(client)

    const result = await repo.findBySlug('missing')

    expect(result).toBeNull()
  })
})
