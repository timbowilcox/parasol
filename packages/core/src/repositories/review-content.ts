// Repositories for the relational artefacts produced by the orchestrator:
// extracted_clauses, issues, citations. Created together because they're
// always written in the same transaction (one orchestrator run → many
// clauses → many issues → many citations) and have foreign keys between
// them.
//
// Sprint 1 Day 11: persistence is what makes the /review/[id] page
// renderable without re-running the orchestrator. The Day 10 email path
// could skip persistence (the customer's email client held the only copy);
// the web path can't.

import { BaseRepository } from './base.js'
import type {
  ExtractedClauseInsert,
  ExtractedClauseRow,
  IssueInsert,
  IssueRow,
  CitationInsert,
  CitationRow,
} from '../db.js'

// ─── Extracted clauses ──────────────────────────────────────────────────────

export class ExtractedClauseRepository extends BaseRepository {
  async insertMany(rows: readonly ExtractedClauseInsert[]): Promise<ExtractedClauseRow[]> {
    if (rows.length === 0) return []
    const { data, error } = await this.supabase
      .from('extracted_clauses')
      .insert(rows as ExtractedClauseInsert[])
      .select('*')
    if (error) throw error
    return data ?? []
  }

  async listForReview(reviewId: string): Promise<ExtractedClauseRow[]> {
    const { data, error } = await this.supabase
      .from('extracted_clauses')
      .select('*')
      .eq('review_id', reviewId)
      .order('clause_order', { ascending: true })
    if (error) throw error
    return data ?? []
  }
}

// ─── Issues ──────────────────────────────────────────────────────────────────

export class IssueRepository extends BaseRepository {
  // Insert issues and return the inserted rows (with their generated UUIDs)
  // so the caller can attach citations by issue_id.
  async insertMany(rows: readonly IssueInsert[]): Promise<IssueRow[]> {
    if (rows.length === 0) return []
    const { data, error } = await this.supabase
      .from('issues')
      .insert(rows as IssueInsert[])
      .select('*')
    if (error) throw error
    return data ?? []
  }

  async listForReview(reviewId: string): Promise<IssueRow[]> {
    const { data, error } = await this.supabase
      .from('issues')
      .select('*')
      .eq('review_id', reviewId)
      .order('issue_order', { ascending: true })
    if (error) throw error
    return data ?? []
  }
}

// ─── Citations ──────────────────────────────────────────────────────────────

export class CitationRepository extends BaseRepository {
  async insertMany(rows: readonly CitationInsert[]): Promise<CitationRow[]> {
    if (rows.length === 0) return []
    const { data, error } = await this.supabase
      .from('citations')
      .insert(rows as CitationInsert[])
      .select('*')
    if (error) throw error
    return data ?? []
  }

  async listForIssues(issueIds: readonly string[]): Promise<CitationRow[]> {
    if (issueIds.length === 0) return []
    const { data, error } = await this.supabase
      .from('citations')
      .select('*')
      .in('issue_id', issueIds as string[])
    if (error) throw error
    return data ?? []
  }
}
