import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ForbiddenError } from '@parasol/core'

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
const ingestSourceMock = vi.fn(async (_opts: unknown) => ({
  documentsAdded: 2, documentsUpdated: 0, errors: [], documentsProcessed: 2, documents: [],
}))

vi.mock('@parasol/corpus', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@parasol/corpus')>()
  return {
    ...actual,
    CorpusRepository: vi.fn().mockImplementation(() => ({
      listSources: listSourcesMock,
    })),
    ingestSource: (opts: unknown) => ingestSourceMock(opts as never),
    KenyaLawScraper: vi.fn().mockImplementation(() => ({ slug: 'kenya-acts' })),
  }
})

const logAdminEventMock = vi.fn(async (_input: unknown) => undefined)
vi.mock('@/server/audit', () => ({
  logAdminEvent: (input: unknown) => logAdminEventMock(input as never),
  extractRequestContext: () => ({ ipAddress: null, userAgent: null }),
}))

vi.mock('next/server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/server')>()
  return {
    ...actual,
    after: (cb: () => Promise<void> | void) => { void cb() },
  }
})

import { POST } from './route'
import { NextRequest } from 'next/server'

const buildRequest = () => new NextRequest('http://localhost/api/admin/corpus/sources/s-1/run', { method: 'POST' })

beforeEach(() => {
  vi.clearAllMocks()
  ingestSourceMock.mockResolvedValue({
    documentsAdded: 2, documentsUpdated: 0, errors: [], documentsProcessed: 2, documents: [],
  } as never)
})

describe('POST /api/admin/corpus/sources/[id]/run', () => {
  it('logs run_triggered, calls ingestSource, and logs run_completed on success', async () => {
    const res = await POST(buildRequest(), { params: Promise.resolve({ id: 's-1' }) })
    expect(res.status).toBe(202)
    const body = await res.json()
    expect(body.accepted).toBe(true)

    // run_triggered audit row written before the response.
    const triggered = logAdminEventMock.mock.calls.find(
      (c) => (c[0] as { action: string } | undefined)?.action === 'admin.corpus.run_triggered',
    )?.[0] as { action: string } | undefined
    expect(triggered?.action).toBe('admin.corpus.run_triggered')

    // Background work has run by now (the next/server.after mock invokes
    // the callback synchronously); ingestSource was invoked.
    await new Promise((r) => setTimeout(r, 0))
    expect(ingestSourceMock).toHaveBeenCalledTimes(1)

    const completed = logAdminEventMock.mock.calls.find(
      (c) => (c[0] as { action: string } | undefined)?.action === 'admin.corpus.run_completed',
    )?.[0] as { payload: { documentsAdded: number } } | undefined
    expect(completed?.payload.documentsAdded).toBe(2)
  })

  it('returns 404 when the source id is unknown', async () => {
    listSourcesMock.mockResolvedValueOnce([])
    const res = await POST(buildRequest(), { params: Promise.resolve({ id: 's-missing' }) })
    expect(res.status).toBe(404)
    expect(ingestSourceMock).not.toHaveBeenCalled()
  })

  it('returns 422 when no scraper is registered for the source slug', async () => {
    listSourcesMock.mockResolvedValueOnce([
      { id: 's-2', slug: 'odpc-determinations', name: 'ODPC', status: 'idle' } as never,
    ])
    const res = await POST(buildRequest(), { params: Promise.resolve({ id: 's-2' }) })
    expect(res.status).toBe(422)
    expect(ingestSourceMock).not.toHaveBeenCalled()
  })

  it('logs run_failed when ingestSource throws', async () => {
    ingestSourceMock.mockRejectedValueOnce(new Error('voyage rate limit'))
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    await POST(buildRequest(), { params: Promise.resolve({ id: 's-1' }) })
    await new Promise((r) => setTimeout(r, 0))

    const failed = logAdminEventMock.mock.calls.find(
      (c) => (c[0] as { action: string } | undefined)?.action === 'admin.corpus.run_failed',
    )?.[0] as { payload: { error: string } } | undefined
    expect(failed?.payload.error).toContain('voyage rate limit')
    errorSpy.mockRestore()
  })

  it('returns 404 when the caller is not an admin', async () => {
    requireAdminMock.mockRejectedValueOnce(new ForbiddenError())
    const res = await POST(buildRequest(), { params: Promise.resolve({ id: 's-1' }) })
    expect(res.status).toBe(404)
    expect(ingestSourceMock).not.toHaveBeenCalled()
  })
})
