// Zod schema for playbook YAML files.
//
// Source of truth: docs/playbook-schema.md.
//
// The schema is enforced at three points:
//   1. `pnpm playbooks:validate` (CI gate)
//   2. `loadPlaybook()` at runtime (invalid YAML refuses to load)
//   3. The validator stage in tests (every shipped playbook must parse)
//
// Drift between this schema and a playbook causes a hard failure rather than
// a silent fallback — playbooks are the proprietary IP per CLAUDE.md, so we
// fail loudly when they're malformed.

import { z } from 'zod'

// ─── Vocabulary enums ────────────────────────────────────────────────────────

export const jurisdictionEnum = z.enum(['kenya', 'uganda', 'tanzania', 'rwanda'])
export const contractTypeEnum = z.enum([
  'nda', 'dpa', 'msa', 'saas', 'employment', 'lease', 'distribution',
])
export const importanceEnum = z.enum(['critical', 'material', 'minor'])
export const positionFieldEnum = z.enum(['standard', 'fallback', 'hard_limit'])
export const citationSourceEnum = z.enum([
  'kenya-statute',
  'kenya-case',
  'kenya-regulation',
  'odpc-determination',
  'kra-ruling',
  'cbk-circular',
  'cma-notice',
  'eac-treaty',
  'market-norm',
  'parasol-internal',
])

// Citation sources that are not expected to resolve in the corpus. The
// validator skips corpus-resolution checks for these because they're either
// internal data (parasol-internal) or non-codified (market-norm).
export const NON_CORPUS_CITATION_SOURCES: ReadonlySet<string> = new Set([
  'market-norm',
  'parasol-internal',
])

// ─── Sub-schemas ─────────────────────────────────────────────────────────────

export const citationSchema = z.object({
  source: citationSourceEnum,
  id: z.string().min(1, 'citation.id must be non-empty'),
  section: z.string().optional(),
  note: z.string().optional(),
  url: z.string().url().optional(),
})

const positionSchema = z.object({
  position: z.string().min(1, 'position text must be non-empty'),
  rationale: z.string().min(1, 'position rationale must be non-empty'),
})

export const clauseSchema = z.object({
  id: z.string().regex(
    /^[a-z][a-z0-9_]*$/,
    'clause.id must be snake_case (lowercase letters, digits, underscores; must start with a letter)',
  ),
  display_name: z.string().min(1, 'clause.display_name must be non-empty'),
  aliases: z.array(z.string()).optional().default([]),
  importance: importanceEnum,
  applicable_when: z.string().optional(),
  related_clauses: z.array(z.string()).optional(),
  notes: z.string().optional(),
  example_acceptable_language: z.string().optional(),
  example_unacceptable_language: z.string().optional(),
  standard: positionSchema,
  fallback: positionSchema,
  hard_limit: positionSchema,
  citations: z.array(citationSchema).default([]),
})

// ─── Top-level playbook schema ───────────────────────────────────────────────

export const playbookSchema = z.object({
  schema_version: z.literal('1.0'),
  jurisdiction: jurisdictionEnum,
  contract_type: contractTypeEnum,
  display_name: z.string().min(1),
  description: z.string().min(1),
  applicable_industries: z.array(z.string()).min(1),
  authored_by: z.string().min(1),
  // ISO date string (YYYY-MM-DD) or null. null = pre-counsel-review draft.
  reviewed_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'reviewed_at must be YYYY-MM-DD').nullable(),
  language: z.literal('en'),
  last_updated: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'last_updated must be YYYY-MM-DD'),
  // status added by Sprint 1 lawyer-workaround per DEF-028.
  // 'production' = counsel-validated, safe for customer-facing output.
  // 'draft'      = author's best read, not yet counsel-validated; pipeline
  //                must surface a warning on every output that uses it.
  // Optional in the YAML (defaults to 'draft' if omitted) so existing
  // counsel-blessed playbooks don't have to be re-edited.
  status: z.enum(['production', 'draft']).default('draft'),
  clauses: z.array(clauseSchema).min(1, 'playbook must define at least one clause'),
}).superRefine((doc, ctx) => {
  // Cross-clause invariant: clause ids unique within a playbook.
  const seen = new Map<string, number>()
  for (let i = 0; i < doc.clauses.length; i++) {
    const id = doc.clauses[i]!.id
    if (seen.has(id)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['clauses', i, 'id'],
        message: `duplicate clause id "${id}" — first defined at clauses[${seen.get(id)}]`,
      })
    } else {
      seen.set(id, i)
    }
  }
  // Cross-clause invariant: a 'production' playbook must have a non-null
  // reviewed_at; the inverse (draft + null) is also OK; draft + non-null is OK
  // (counsel started reviewing); production + null is contradictory.
  if (doc.status === 'production' && doc.reviewed_at === null) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['status'],
      message: 'status: production requires reviewed_at to be set',
    })
  }
})

export type Playbook = z.infer<typeof playbookSchema>
export type Clause = z.infer<typeof clauseSchema>
export type Citation = z.infer<typeof citationSchema>
export type Position = z.infer<typeof positionSchema>
export type Importance = z.infer<typeof importanceEnum>
export type PositionField = z.infer<typeof positionFieldEnum>
export type CitationSource = z.infer<typeof citationSourceEnum>
