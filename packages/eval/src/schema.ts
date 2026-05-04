// Zod schemas for the eval harness.
//
// Schema for ground-truth annotation YAMLs (one per NDA in the golden set)
// and for serialised eval run results.

import { z } from 'zod'

// ─── Ground-truth annotation schema ──────────────────────────────────────────

const expectedCitationSchema = z.object({
  source: z.enum([
    'kenya-statute',
    'kenya-case',
    'kenya-regulation',
    'odpc-determination',
    'kra-ruling',
    'cbk-circular',
    'cma-notice',
  ]),
  id: z.string().min(1),
  section: z.string().optional(),
})

const expectedIssueSchema = z.object({
  clause_id: z.string().min(1),
  severity: z.enum(['critical', 'material', 'minor']),
  description: z.string().min(1),
  required: z.boolean().optional(),
  expected_confidence: z
    .enum(['high', 'medium', 'manual_review_recommended'])
    .optional(),
})

export const groundTruthSchema = z.object({
  filename: z.string().min(1),
  annotated_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  annotated_by: z.string().min(1),
  notes: z.string().optional(),
  expected_issues: z.array(expectedIssueSchema),
  expected_citations: z.array(expectedCitationSchema).optional().default([]),
})

export type GroundTruthFromSchema = z.infer<typeof groundTruthSchema>
