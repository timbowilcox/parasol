import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ForbiddenError, UnauthorisedError } from '@parasol/core'

const requireAdminMock = vi.fn(async () => ({
  id: 'admin-1', workspaceId: 'ws-1', role: 'owner' as const, isParasolAdmin: true,
}))
vi.mock('@/server/auth', () => ({
  requireAdmin: () => requireAdminMock(),
}))

vi.mock('@/lib/supabase/server', () => ({
  createServerClient: vi.fn(async () => ({})),
}))

const listSourcesMock = vi.fn(async () => [
  { id: 's-1', slug: 'kenya-acts', name: 'Kenya Acts', status: 'healthy' },
])
vi.mock('@parasol/corpus', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@parasol/corpus')>()
  return {
    ...actual,
    CorpusRepository: vi.fn().mockImplementation(() => ({
      listSources: listSourcesMock,
    })),
  }
})

import { GET, POST } from './route'
import { NextRequest } from 'next/server'

const buildRequest = () => new NextRequest('http://localhost/api/admin/corpus/sources')

beforeEach(() => {
  vi.clearAllMocks()
})

describe('GET /api/admin/corpus/sources', () => {
  it('returns the source list to authenticated admins', async () => {
    const res = await GET(buildRequest())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.sources).toHaveLength(1)
    expect(body.sources[0].slug).toBe('kenya-acts')
  })

  it('returns 404 (not 403) when the caller is not signed in', async () => {
    requireAdminMock.mockRejectedValueOnce(new UnauthorisedError())
    const res = await GET(buildRequest())
    expect(res.status).toBe(404)
    expect(listSourcesMock).not.toHaveBeenCalled()
  })

  it('returns 404 when the caller is signed in but not parasol_admin', async () => {
    requireAdminMock.mockRejectedValueOnce(new ForbiddenError())
    const res = await GET(buildRequest())
    expect(res.status).toBe(404)
  })
})

describe('POST /api/admin/corpus/sources', () => {
  it('returns 501 — source creation is deferred to Sprint 2', async () => {
    const res = await POST(buildRequest())
    expect(res.status).toBe(501)
  })
})
