// Hand-rolled Database type matching apps/web/supabase/migrations/*.
// Regenerate via `pnpm db:types` once a Supabase Personal Access Token is
// configured (or once Docker Desktop is available for the local meta path).
// Until then, this file is the canonical source — keep it in sync with new
// migrations. See DEFERRED entry DEF-043 for proper auto-generation.
//
// IMPORTANT: per-table Row/Insert/Update are declared as `type` aliases, not
// `interface`. Supabase's GenericTable constraint requires structural
// compatibility with `Record<string, unknown>`, which interfaces do not
// satisfy by default. Type aliases work; interfaces collapse the table to
// `never` in `from('table').insert(...)` calls.

export type Json = string | number | boolean | null | { [k: string]: Json | undefined } | Json[]

export type WorkspaceRow = {
  id: string
  slug: string
  name: string
  tier: 'solo' | 'team' | 'business'
  seat_limit: number
  allowed_sender_domains: string[]
  timezone: string
  created_at: string
  updated_at: string
}
export type WorkspaceInsert = {
  id?: string
  slug: string
  name: string
  tier?: 'solo' | 'team' | 'business'
  seat_limit?: number
  allowed_sender_domains?: string[]
  timezone?: string
  created_at?: string
  updated_at?: string
}
export type WorkspaceUpdate = Partial<WorkspaceInsert>

export type ProfileRow = {
  id: string
  workspace_id: string
  full_name: string | null
  role: 'owner' | 'admin' | 'member'
  is_parasol_admin: boolean
  created_at: string
  updated_at: string
}
export type ProfileInsert = {
  id: string
  workspace_id: string
  full_name?: string | null
  role?: 'owner' | 'admin' | 'member'
  is_parasol_admin?: boolean
  created_at?: string
  updated_at?: string
}
export type ProfileUpdate = Partial<ProfileInsert>

export type ReviewRow = {
  id: string
  workspace_id: string
  created_by: string
  contract_type: string | null
  jurisdiction: string
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'unsupported'
  playbook_version: string | null
  corpus_version: string | null
  intake_source: 'web' | 'email' | 'api'
  sender_email: string | null
  original_filename: string | null
  error_message: string | null
  created_at: string
  updated_at: string
}
export type ReviewInsert = {
  id?: string
  workspace_id: string
  created_by: string
  contract_type?: string | null
  jurisdiction?: string
  status?: 'pending' | 'processing' | 'completed' | 'failed' | 'unsupported'
  playbook_version?: string | null
  corpus_version?: string | null
  intake_source: 'web' | 'email' | 'api'
  sender_email?: string | null
  original_filename?: string | null
  error_message?: string | null
  created_at?: string
  updated_at?: string
}
export type ReviewUpdate = Partial<ReviewInsert>

// ─── corpus tables (migration 0002) ──────────────────────────────────────────

export type CorpusSourceRow = {
  id: string
  slug: string
  name: string
  jurisdiction: string
  source_type: string
  base_url: string
  schedule_display: string | null
  status: 'idle' | 'running' | 'healthy' | 'warning' | 'error'
  last_run_at: string | null
  document_count: number
  created_at: string
  updated_at: string
}
export type CorpusSourceInsert = {
  id?: string
  slug: string
  name: string
  jurisdiction: string
  source_type: string
  base_url: string
  schedule_display?: string | null
  status?: 'idle' | 'running' | 'healthy' | 'warning' | 'error'
  last_run_at?: string | null
  document_count?: number
  created_at?: string
  updated_at?: string
}
export type CorpusSourceUpdate = Partial<CorpusSourceInsert>

export type CorpusIngestionRunRow = {
  id: string
  source_id: string
  triggered_by: string | null
  started_at: string
  completed_at: string | null
  status: 'running' | 'completed' | 'failed'
  documents_processed: number
  documents_added: number
  documents_updated: number
  errors: Json
  created_at: string
}
export type CorpusIngestionRunInsert = {
  id?: string
  source_id: string
  triggered_by?: string | null
  started_at?: string
  completed_at?: string | null
  status?: 'running' | 'completed' | 'failed'
  documents_processed?: number
  documents_added?: number
  documents_updated?: number
  errors?: Json
  created_at?: string
}
export type CorpusIngestionRunUpdate = Partial<CorpusIngestionRunInsert>

export type CorpusDocumentRow = {
  id: string
  source_id: string | null
  source_type: string
  jurisdiction: string
  canonical_id: string
  title: string
  full_text: string
  source_url: string
  retrieved_at: string
  effective_date: string | null
  superseded_at: string | null
  superseded_by_id: string | null
  metadata: Json
  created_at: string
}
export type CorpusDocumentInsert = {
  id?: string
  source_id?: string | null
  source_type: string
  jurisdiction: string
  canonical_id: string
  title: string
  full_text: string
  source_url: string
  retrieved_at: string
  effective_date?: string | null
  superseded_at?: string | null
  superseded_by_id?: string | null
  metadata?: Json
  created_at?: string
}
export type CorpusDocumentUpdate = Partial<CorpusDocumentInsert>

export type CorpusChunkRow = {
  id: string
  document_id: string
  parent_chunk_id: string | null
  chunk_index: number
  hierarchy: string[]
  text: string
  text_with_context: string
  clause_types: string[]
  area_of_law: string[]
  embedding: number[] | null
  // fts is generated always — never write to it; readable as string for completeness
  fts: unknown
  created_at: string
}
export type CorpusChunkInsert = {
  id?: string
  document_id: string
  parent_chunk_id?: string | null
  chunk_index: number
  hierarchy?: string[]
  text: string
  text_with_context: string
  clause_types?: string[]
  area_of_law?: string[]
  embedding?: number[] | null
  created_at?: string
}
export type CorpusChunkUpdate = Partial<CorpusChunkInsert>

// ─── audit_log (migration 0004) ──────────────────────────────────────────────

export type AuditLogRow = {
  id: string
  workspace_id: string | null
  actor_id: string | null
  action: string
  resource_type: string | null
  resource_id: string | null
  payload: Json
  ip_address: string | null
  user_agent: string | null
  previous_hash: string
  hash: string
  created_at: string
}
export type AuditLogInsert = {
  id?: string
  workspace_id?: string | null
  actor_id?: string | null
  action: string
  resource_type?: string | null
  resource_id?: string | null
  payload?: Json
  ip_address?: string | null
  user_agent?: string | null
  previous_hash: string
  hash: string
  created_at?: string
}
// Append-only at DB layer (no UPDATE policy, no DELETE policy). The Update
// alias exists only to satisfy Supabase's structural constraints.
export type AuditLogUpdate = Partial<AuditLogInsert>

export type Database = {
  // Required by @supabase/supabase-js v2.45+ — without this the typed client
  // collapses Tables<T> to `never`. The exact PostgrestVersion string isn't
  // semantically checked, but the field must be present.
  __InternalSupabase: {
    PostgrestVersion: '12.2.3'
  }
  public: {
    Tables: {
      workspaces: {
        Row: WorkspaceRow
        Insert: WorkspaceInsert
        Update: WorkspaceUpdate
        Relationships: []
      }
      profiles: {
        Row: ProfileRow
        Insert: ProfileInsert
        Update: ProfileUpdate
        Relationships: []
      }
      reviews: {
        Row: ReviewRow
        Insert: ReviewInsert
        Update: ReviewUpdate
        Relationships: []
      }
      corpus_sources: {
        Row: CorpusSourceRow
        Insert: CorpusSourceInsert
        Update: CorpusSourceUpdate
        Relationships: []
      }
      corpus_ingestion_runs: {
        Row: CorpusIngestionRunRow
        Insert: CorpusIngestionRunInsert
        Update: CorpusIngestionRunUpdate
        Relationships: []
      }
      corpus_documents: {
        Row: CorpusDocumentRow
        Insert: CorpusDocumentInsert
        Update: CorpusDocumentUpdate
        Relationships: []
      }
      corpus_chunks: {
        Row: CorpusChunkRow
        Insert: CorpusChunkInsert
        Update: CorpusChunkUpdate
        Relationships: []
      }
      audit_log: {
        Row: AuditLogRow
        Insert: AuditLogInsert
        Update: AuditLogUpdate
        Relationships: []
      }
    }
    Views: Record<string, never>
    Functions: {
      // migration 0005 — corpus retrieval RPCs
      match_corpus_chunks: {
        Args: {
          query_embedding: number[]
          match_count?: number
          jurisdiction_filter?: string | null
          source_type_filter?: string[] | null
          clause_types_filter?: string[] | null
        }
        Returns: CorpusChunkSearchResult[]
      }
      bm25_corpus_chunks: {
        Args: {
          query_text: string
          match_count?: number
          jurisdiction_filter?: string | null
          source_type_filter?: string[] | null
          clause_types_filter?: string[] | null
        }
        Returns: CorpusChunkBm25Result[]
      }
    }
    Enums: Record<string, never>
    CompositeTypes: Record<string, never>
  }
}

// Return shape for match_corpus_chunks RPC.
export type CorpusChunkSearchResult = {
  id: string
  document_id: string
  chunk_index: number
  hierarchy: string[]
  text: string
  text_with_context: string
  clause_types: string[]
  area_of_law: string[]
  similarity: number
  document_canonical_id: string
  document_title: string
  document_source_type: string
  document_jurisdiction: string
  document_source_url: string
}

// Return shape for bm25_corpus_chunks RPC. Same shape as the vector search,
// but the score column is `rank` (Postgres ts_rank_cd) instead of `similarity`.
export type CorpusChunkBm25Result = Omit<CorpusChunkSearchResult, 'similarity'> & {
  rank: number
}
