import { describe, it, expect, beforeEach, vi } from 'vitest'
import { UnauthorisedError } from '@parasol/core'

const requireAdminMock = vi.fn(async () => ({
  id: 'admin-1', workspaceId: 'ws-1', role: 'owner' as const, isParasolAdmin: true,
}))
vi.mock('@/server/auth', () => ({
  requireAdmin: () => requireAdminMock(),
}))

vi.mock('@/lib/supabase/server', () => ({
  createServerClient: vi.fn(async () => ({})),
}))

const listRunsMock = vi.fn(async (_opts: { limit?: number; sourceId?: string }) => [
  { id: 'run-1', source_id: 's-1', status: 'completed' },
])
vi.mock('@parasol/corpus', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@parasol/corpus')>()
  return {
    ...actual,
    CorpusRepository: vi.fn().mockImplementation(() => ({
      listRuns: listRunsMock,
    })),
  }
})

import { GET } from './route'
import { NextRequest } from 'next/server'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('GET /api/admin/corpus/runs', () => {
  it('returns recent runs with the default limit when no query is given', async () => {
    const res = await GET(new NextRequest('http://localhost/api/admin/corpus/runs'))
    expect(res.status).toBe(200)
    expect(listRunsMock).toHaveBeenCalledWith({ limit: 50, sourceId: undefined })
    const body = await res.json()
    expect(body.runs).toHaveLength(1)
  })

  it('passes ?source= and ?limit= through to the repository', async () => {
    await GET(new NextRequest('http://localhost/api/admin/corpus/runs?source=s-1&limit=10'))
    expect(listRunsMock).toHaveBeenCalledWith({ limit: 10, sourceId: 's-1' })
  })

  it('clamps limit to a sane upper bound', async () => {
    await GET(new NextRequest('http://localhost/api/admin/corpus/runs?limit=10000'))
    expect(listRunsMock).toHaveBeenCalledWith({ limit: 200, sourceId: undefined })
  })

  it('returns 404 when the caller is not an admin', async () => {
    requireAdminMock.mockRejectedValueOnce(new UnauthorisedError())
    const res = await GET(new NextRequest('http://localhost/api/admin/corpus/runs'))
    expect(res.status).toBe(404)
  })
})
