import { describe, it, expect, beforeEach, vi } from 'vitest'

const appendEventMock = vi.fn(async (_input: Record<string, unknown>) => ({ id: 'audit-1' }))

vi.mock('@parasol/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@parasol/core')>()
  return {
    ...actual,
    AuditRepository: vi.fn().mockImplementation(() => ({
      appendEvent: appendEventMock,
    })),
  }
})

import { logAdminEvent, extractRequestContext } from './audit'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('logAdminEvent', () => {
  it('forwards the input to AuditRepository.appendEvent', async () => {
    await logAdminEvent({
      supabase: {} as never,
      actorId: 'admin-1',
      workspaceId: null,
      action: 'admin.corpus.run_triggered',
      resourceType: 'corpus_source',
      resourceId: 'src-1',
      payload: { sourceSlug: 'kenya-acts' },
      ipAddress: '203.0.113.1',
      userAgent: 'Mozilla/5.0',
    })
    expect(appendEventMock).toHaveBeenCalledTimes(1)
    expect(appendEventMock.mock.calls[0]?.[0]).toMatchObject({
      workspaceId: null,
      actorId: 'admin-1',
      action: 'admin.corpus.run_triggered',
      resourceType: 'corpus_source',
      resourceId: 'src-1',
      ipAddress: '203.0.113.1',
      userAgent: 'Mozilla/5.0',
    })
  })

  it('swallows errors from AuditRepository — audit-write failure must not abort the operation', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    appendEventMock.mockRejectedValueOnce(new Error('connection refused'))

    await expect(logAdminEvent({
      supabase: {} as never,
      actorId: 'admin-1',
      workspaceId: null,
      action: 'admin.corpus.run_triggered',
    })).resolves.toBeUndefined()

    expect(errorSpy).toHaveBeenCalled()
    errorSpy.mockRestore()
  })

  it('defaults nullable fields when not supplied', async () => {
    await logAdminEvent({
      supabase: {} as never,
      actorId: 'a-1',
      workspaceId: 'ws-1',
      action: 'admin.corpus.run_completed',
    })
    const lastIdx = appendEventMock.mock.calls.length - 1
    const call = appendEventMock.mock.calls[lastIdx]?.[0]
    expect(call).toBeDefined()
    expect(call?.resourceType).toBeNull()
    expect(call?.resourceId).toBeNull()
    expect(call?.ipAddress).toBeNull()
    expect(call?.userAgent).toBeNull()
  })
})

describe('extractRequestContext', () => {
  it('pulls IP from the first X-Forwarded-For entry and the User-Agent header', () => {
    const headers = new Headers({
      'x-forwarded-for': '203.0.113.1, 10.0.0.5',
      'user-agent': 'TestAgent/1.0',
    })
    expect(extractRequestContext({ headers })).toEqual({
      ipAddress: '203.0.113.1',
      userAgent: 'TestAgent/1.0',
    })
  })

  it('returns nulls when neither header is set', () => {
    expect(extractRequestContext({ headers: new Headers() })).toEqual({
      ipAddress: null, userAgent: null,
    })
  })

  it('handles single-IP X-Forwarded-For without a comma', () => {
    const headers = new Headers({ 'x-forwarded-for': '198.51.100.42' })
    expect(extractRequestContext({ headers }).ipAddress).toBe('198.51.100.42')
  })
})
