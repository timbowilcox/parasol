import { BaseRepository } from './base.js'
import type { Tables, TablesInsert } from './types.js'
import { NotFoundError, ValidationError } from '../errors/index.js'
import type { ReviewStatus } from '../types/index.js'

export type Review = Tables<'reviews'>
type ReviewInsertRow = TablesInsert<'reviews'>

// CreateReviewInput omits server-managed fields (id, status default,
// timestamps). Status starts at 'pending' unless explicitly set.
export interface CreateReviewInput {
  workspaceId: string
  createdBy: string
  intakeSource: 'web' | 'email' | 'api'
  contractType?: string | null
  jurisdiction?: string
  senderEmail?: string | null
  originalFilename?: string | null
}

export class ReviewRepository extends BaseRepository {
  async create(input: CreateReviewInput): Promise<Review> {
    const row: ReviewInsertRow = {
      workspace_id: input.workspaceId,
      created_by: input.createdBy,
      intake_source: input.intakeSource,
      contract_type: input.contractType ?? null,
      jurisdiction: input.jurisdiction ?? 'kenya',
      sender_email: input.senderEmail ?? null,
      original_filename: input.originalFilename ?? null,
    }

    const { data, error } = await this.supabase
      .from('reviews')
      .insert(row)
      .select('*')
      .single()

    if (error) throw error
    if (!data) throw new ValidationError('Review insert returned no data')
    return data
  }

  async getById(id: string): Promise<Review> {
    const { data, error } = await this.supabase
      .from('reviews')
      .select('*')
      .eq('id', id)
      .maybeSingle()

    if (error) throw error
    if (!data) throw new NotFoundError('Review', id)
    return data
  }

  async updateStatus(
    id: string,
    status: ReviewStatus,
    errorMessage?: string,
  ): Promise<Review> {
    const update: Partial<ReviewInsertRow> = {
      status,
      updated_at: new Date().toISOString(),
    }
    if (status === 'failed' && errorMessage) {
      update.error_message = errorMessage
    }

    const { data, error } = await this.supabase
      .from('reviews')
      .update(update)
      .eq('id', id)
      .select('*')
      .single()

    if (error) throw error
    if (!data) throw new NotFoundError('Review', id)
    return data
  }

  // Persist the orchestrator's assembled outputs onto the review row. Sprint 1
  // stores the redline DOCX inline as base64 (DEF-048 migrates to Supabase
  // Storage in v2); the web view JSON hydrates /review/[id] without
  // re-running the orchestrator; the email body JSON keeps an audit trail of
  // exactly what we sent.
  async updateAssembled(
    id: string,
    artefacts: {
      redlineDocxBase64: string
      webViewJson: unknown
      emailBodyJson: unknown
    },
  ): Promise<Review> {
    const update: Partial<ReviewInsertRow> = {
      redline_docx_base64: artefacts.redlineDocxBase64,
      web_view_json: artefacts.webViewJson,
      email_body_json: artefacts.emailBodyJson,
      updated_at: new Date().toISOString(),
    }
    const { data, error } = await this.supabase
      .from('reviews')
      .update(update)
      .eq('id', id)
      .select('*')
      .single()

    if (error) throw error
    if (!data) throw new NotFoundError('Review', id)
    return data
  }
}
