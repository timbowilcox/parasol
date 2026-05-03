// Domain types for Parasol.
// These are the canonical definitions — import from '@parasol/core', not locally.

// ─── Jurisdiction ─────────────────────────────────────────────────────────────

export type Jurisdiction = 'kenya' | 'uganda' | 'tanzania' | 'rwanda'

// ─── Contract types ───────────────────────────────────────────────────────────

export type ContractType = 'nda' | 'dpa' | 'msa' | 'saas' | 'employment' | 'lease' | 'distribution'

// ─── Clause types (controlled vocabulary, ~40 items) ─────────────────────────
// Used for filtering corpus retrieval and tagging extracted clauses.
// Maintained in sync with packages/playbooks/<jurisdiction>/<type>.yaml clause ids.

export type ClauseType =
  | 'assignment'
  | 'audit_rights'
  | 'change_of_control'
  | 'confidentiality_term'
  | 'counterparts_and_execution'
  | 'data_protection'
  | 'definition_of_confidential_information'
  | 'delivery'
  | 'dispute_resolution'
  | 'entire_agreement'
  | 'exclusions_from_confidentiality'
  | 'force_majeure'
  | 'governing_law'
  | 'indemnification'
  | 'intellectual_property'
  | 'intellectual_property_ownership'
  | 'license_grant'
  | 'limitation_of_liability'
  | 'no_obligation_to_proceed'
  | 'no_waiver'
  | 'non_compete'
  | 'non_solicitation'
  | 'notices'
  | 'payment_terms'
  | 'price_and_fees'
  | 'remedies'
  | 'renewal'
  | 'representations'
  | 'return_or_destruction'
  | 'severability'
  | 'sla'
  | 'step_in_rights'
  | 'subcontracting'
  | 'survival'
  | 'term_and_termination'
  | 'termination_for_cause'
  | 'termination_for_convenience'
  | 'waiver'
  | 'warranty'

// ─── Document types (corpus source types) ────────────────────────────────────

export type DocumentType =
  | 'statute'
  | 'case'
  | 'regulation'
  | 'odpc_determination'
  | 'kra_ruling'
  | 'cbk_circular'
  | 'cma_notice'
  | 'gazette'
  | 'constitution'
  | 'market_norm'

// ─── Citation source types ────────────────────────────────────────────────────
// Used in playbook YAML and structured issue citations.
// Stringly-typed citations are forbidden per CLAUDE.md.

export type CitationSource =
  | 'kenya-statute'
  | 'kenya-case'
  | 'kenya-regulation'
  | 'odpc-determination'
  | 'kra-ruling'
  | 'cbk-circular'
  | 'cma-notice'
  | 'eac-treaty'
  | 'market-norm'
  | 'parasol-internal'

export interface Citation {
  source: CitationSource
  id: string
  section?: string
  note?: string
  url?: string
}

// ─── Confidence and severity ──────────────────────────────────────────────────

export type ConfidenceLevel = 'high' | 'medium' | 'manual_review_recommended'

export type IssueSeverity = 'critical' | 'material' | 'minor'

// ─── Playbook importance ──────────────────────────────────────────────────────

export type PlaybookImportance = 'critical' | 'material' | 'minor'

// ─── Model roles ──────────────────────────────────────────────────────────────
// Stages declare a role; the orchestrator resolves to a concrete model at call time.
// This decouples stage code from specific model versions.

export type ModelRole = 'haiku' | 'sonnet' | 'opus'

// ─── Intake sources ───────────────────────────────────────────────────────────

export type IntakeSource = 'web' | 'email' | 'api'

// ─── Review status ────────────────────────────────────────────────────────────

export type ReviewStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'unsupported'

// ─── Audit log action namespaces ──────────────────────────────────────────────

export type AuditAction =
  | `review.${'created' | 'processing' | 'completed' | 'failed'}`
  | `admin.corpus.${'run_triggered' | 'run_completed' | 'run_failed'}`
  | `auth.${'signed_in' | 'signed_out'}`
  | `workspace.${'created' | 'updated' | 'seat_added' | 'seat_removed'}`
  | `playbook.${'override_created' | 'override_updated' | 'override_deleted'}`

// ─── Page quality (intake pipeline) ──────────────────────────────────────────

export type PageQualityFlag =
  | 'rotated'
  | 'low_contrast'
  | 'handwriting_present'
  | 'partial_obscure'
  | 'multi_column'
  | 'complex_table'

export type PageRoute = 'haiku_extract' | 'sonnet_extract' | 'reject'

export interface PageQuality {
  pageNumber: number
  qualityScore: 1 | 2 | 3 | 4 | 5
  flags: PageQualityFlag[]
  recommendedRoute: PageRoute
  reasoning: string
}
