// Canonical types for the corpus ingestion pipeline.
// Stable across scrapers, normaliser, chunker, embedder, tagger, repository.

import type { Jurisdiction, ClauseType, DocumentType } from '@parasol/core'

// ─── RawDocument ─────────────────────────────────────────────────────────────
// What a scraper produces for a single source-of-record document.
// Pre-normalisation: still HTML or PDF bytes, with provenance metadata.

export interface RawDocument {
  canonicalId: string         // stable id within the source (e.g. "Act-No-24-of-2019")
  jurisdiction: Jurisdiction
  sourceType: DocumentType    // 'statute' | 'case' | 'odpc_determination' | etc.
  title: string
  sourceUrl: string
  retrievedAt: Date
  effectiveDate?: Date | null
  contentType: 'text/html' | 'application/pdf' | 'text/plain'
  body: string                // HTML string or extracted PDF text
  metadata: Record<string, unknown>
}

// ─── NormalisedDocument ──────────────────────────────────────────────────────
// Output of the normaliser. Clean text + a hierarchical section tree that the
// chunker walks to produce hierarchy-prefixed chunks.

export interface NormalisedDocument {
  canonicalId: string
  jurisdiction: Jurisdiction
  sourceType: DocumentType
  title: string
  sourceUrl: string
  retrievedAt: Date
  effectiveDate?: Date | null
  metadata: Record<string, unknown>
  // Full plaintext, with hierarchy preserved by the section tree below.
  fullText: string
  // Tree of sections. Top-level is the document; children are parts/chapters/
  // sections/subsections. For judgments, sections are paragraphs.
  sections: Section[]
}

export interface Section {
  // Display label, e.g. "Section 12", "Part III", "Paragraph 4". For untitled
  // intermediate nodes (bare paragraphs in a judgment), use ''.
  label: string
  // Optional human-readable heading, e.g. "Confidentiality" for a section.
  heading?: string
  // The body text local to this section (excluding child section bodies).
  text: string
  // Nested subsections.
  children: Section[]
}

// ─── Chunk ───────────────────────────────────────────────────────────────────
// Output of the chunker. One row per chunk in the corpus_chunks table.

export interface Chunk {
  // Stable position in the document (sequential, 0-indexed).
  chunkIndex: number
  // Hierarchy path to this chunk, ordered root→leaf. Used as prefix in
  // textWithContext and stored in the corpus_chunks.hierarchy column.
  hierarchy: string[]
  // The chunk's raw text — what BM25 indexes (corpus_chunks.fts is generated
  // from this column).
  text: string
  // Hierarchy-prefixed text for embedding. Improves retrieval recall on
  // hierarchically-organised statutes (Companies Act > Part III > Section 12).
  textWithContext: string
  // Tags populated by the tagger stage (clause_types from a controlled
  // vocabulary, area_of_law from a controlled vocabulary).
  clauseTypes: ClauseType[]
  areaOfLaw: AreaOfLaw[]
  // Embedding produced by Voyage-3. 1024 dimensions. null until embedder runs.
  embedding: number[] | null
}

// ─── Tagging vocabularies ───────────────────────────────────────────────────

export type AreaOfLaw =
  | 'commercial'
  | 'employment'
  | 'data_protection'
  | 'tax'
  | 'regulatory'
  | 'corporate'
  | 'litigation'
  | 'intellectual_property'
  | 'real_estate'
  | 'banking_finance'
  | 'competition'
  | 'constitutional'

// ─── Ingestion result ────────────────────────────────────────────────────────
// What the orchestrator returns per source-document. Surfaced in the run row's
// `errors` jsonb as well as the run summary in HANDOFF/admin UI.

export interface IngestedDocumentResult {
  canonicalId: string
  outcome: 'added' | 'updated' | 'skipped' | 'failed'
  documentId?: string
  chunkCount?: number
  reason?: string  // populated when outcome is 'skipped' or 'failed'
  durationMs: number
}

export interface IngestionRunResult {
  runId: string
  sourceId: string
  sourceSlug: string
  startedAt: Date
  completedAt: Date
  status: 'completed' | 'failed'
  documentsProcessed: number
  documentsAdded: number
  documentsUpdated: number
  errors: Array<{ canonicalId: string; message: string }>
  results: IngestedDocumentResult[]
}
