import { describe, it, expect, vi } from 'vitest'
import { ReviewRepository, type Review } from './reviews.js'
import { NotFoundError, ValidationError } from '../errors/index.js'
import type { SupabaseClient } from './types.js'

const sampleReview: Review = {
  id: 'r-1',
  workspace_id: 'ws-1',
  created_by: 'u-1',
  contract_type: 'nda',
  jurisdiction: 'kenya',
  status: 'pending',
  playbook_version: null,
  corpus_version: null,
  intake_source: 'web',
  sender_email: null,
  original_filename: 'nda.pdf',
  error_message: null,
  created_at: '2026-05-04T00:00:00Z',
  updated_at: '2026-05-04T00:00:00Z',
}

// Mock for .insert(...).select('*').single()
function buildInsertClient(result: { data: Review | null; error: Error | null }) {
  const single = vi.fn().mockResolvedValue(result)
  const select = vi.fn().mockReturnValue({ single })
  const insert = vi.fn().mockReturnValue({ select })
  const from = vi.fn().mockReturnValue({ insert })
  return {
    client: { from } as unknown as SupabaseClient,
    spies: { from, insert, select, single },
  }
}

// Mock for .select('*').eq(...).maybeSingle()
function buildSelectClient(result: { data: Review | null; error: Error | null }) {
  const maybeSingle = vi.fn().mockResolvedValue(result)
  const eq = vi.fn().mockReturnValue({ maybeSingle })
  const select = vi.fn().mockReturnValue({ eq })
  const from = vi.fn().mockReturnValue({ select })
  return {
    client: { from } as unknown as SupabaseClient,
    spies: { from, select, eq, maybeSingle },
  }
}

// Mock for .update(...).eq(...).select('*').single()
function buildUpdateClient(result: { data: Review | null; error: Error | null }) {
  const single = vi.fn().mockResolvedValue(result)
  const select = vi.fn().mockReturnValue({ single })
  const eq = vi.fn().mockReturnValue({ select })
  const update = vi.fn().mockReturnValue({ eq })
  const from = vi.fn().mockReturnValue({ update })
  return {
    client: { from } as unknown as SupabaseClient,
    spies: { from, update, eq, select, single },
  }
}

describe('ReviewRepository.create', () => {
  it('inserts a row with sensible defaults and returns the saved review', async () => {
    const { client, spies } = buildInsertClient({ data: sampleReview, error: null })
    const repo = new ReviewRepository(client)

    const result = await repo.create({
      workspaceId: 'ws-1',
      createdBy: 'u-1',
      intakeSource: 'web',
      originalFilename: 'nda.pdf',
    })

    expect(result).toEqual(sampleReview)
    expect(spies.from).toHaveBeenCalledWith('reviews')
    expect(spies.insert).toHaveBeenCalledWith({
      workspace_id: 'ws-1',
      created_by: 'u-1',
      intake_source: 'web',
      contract_type: null,
      jurisdiction: 'kenya',
      sender_email: null,
      original_filename: 'nda.pdf',
    })
  })

  it('passes through optional fields when provided', async () => {
    const { client, spies } = buildInsertClient({ data: sampleReview, error: null })
    const repo = new ReviewRepository(client)

    await repo.create({
      workspaceId: 'ws-1',
      createdBy: 'u-1',
      intakeSource: 'email',
      contractType: 'nda',
      jurisdiction: 'uganda',
      senderEmail: 'hashed-12345',
    })

    const inserted = spies.insert.mock.calls[0]![0] as Record<string, unknown>
    expect(inserted.contract_type).toBe('nda')
    expect(inserted.jurisdiction).toBe('uganda')
    expect(inserted.sender_email).toBe('hashed-12345')
    expect(inserted.intake_source).toBe('email')
  })

  it('throws ValidationError when insert returns no data', async () => {
    const { client } = buildInsertClient({ data: null, error: null })
    const repo = new ReviewRepository(client)

    await expect(
      repo.create({ workspaceId: 'ws-1', createdBy: 'u-1', intakeSource: 'web' }),
    ).rejects.toBeInstanceOf(ValidationError)
  })
})

describe('ReviewRepository.getById', () => {
  it('returns the review when found', async () => {
    const { client, spies } = buildSelectClient({ data: sampleReview, error: null })
    const repo = new ReviewRepository(client)

    const result = await repo.getById('r-1')

    expect(result).toEqual(sampleReview)
    expect(spies.eq).toHaveBeenCalledWith('id', 'r-1')
  })

  it('throws NotFoundError when no row matches', async () => {
    const { client } = buildSelectClient({ data: null, error: null })
    const repo = new ReviewRepository(client)

    await expect(repo.getById('missing')).rejects.toBeInstanceOf(NotFoundError)
  })
})

describe('ReviewRepository.updateStatus', () => {
  it('updates status with new updated_at timestamp', async () => {
    const updated = { ...sampleReview, status: 'completed' as const }
    const { client, spies } = buildUpdateClient({ data: updated, error: null })
    const repo = new ReviewRepository(client)

    const result = await repo.updateStatus('r-1', 'completed')

    expect(result.status).toBe('completed')
    expect(spies.update).toHaveBeenCalledTimes(1)
    const updateArg = spies.update.mock.calls[0]![0] as Record<string, unknown>
    expect(updateArg.status).toBe('completed')
    expect(typeof updateArg.updated_at).toBe('string')
    expect(updateArg.error_message).toBeUndefined()  // not set on success transitions
    expect(spies.eq).toHaveBeenCalledWith('id', 'r-1')
  })

  it('records error_message only when status is failed', async () => {
    const failed = { ...sampleReview, status: 'failed' as const, error_message: 'boom' }
    const { client, spies } = buildUpdateClient({ data: failed, error: null })
    const repo = new ReviewRepository(client)

    await repo.updateStatus('r-1', 'failed', 'boom')

    const updateArg = spies.update.mock.calls[0]![0] as Record<string, unknown>
    expect(updateArg.error_message).toBe('boom')
  })

  it('throws NotFoundError when no review matches', async () => {
    const { client } = buildUpdateClient({ data: null, error: null })
    const repo = new ReviewRepository(client)

    await expect(repo.updateStatus('missing', 'completed')).rejects.toBeInstanceOf(NotFoundError)
  })
})
