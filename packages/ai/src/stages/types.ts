// Stage I/O shapes for Sprint 1 day 7 stages 1-4.
//
// Source of truth for the data flowing between intake → orchestrator → stages.
// The intake plumbing (PDF / DOCX byte extraction, image rasterization for
// vision) lands in apps/web later; these types describe the shape that gets
// handed to each stage regardless of intake source.

import { z } from 'zod'

// ─── PageInput — the unit each stage operates on ────────────────────────────
// A page may be either text (already extracted by intake — e.g. mammoth/
// pdfplumber output) OR a rasterised image for vision-based extraction.
// Stages that only read text (triage, extract-clauses) ignore image fields.

export const pageInputSchema = z.object({
  pageNumber: z.number().int().nonnegative(),
  // Pre-extracted plaintext for the page (clean intake path).
  text: z.string().optional(),
  // Rasterised image as base64 (degraded intake path — scan/photo).
  imageBase64: z.string().optional(),
  imageMimeType: z.enum(['image/png', 'image/jpeg']).optional(),
}).refine(
  (p) => typeof p.text === 'string' || (typeof p.imageBase64 === 'string' && typeof p.imageMimeType === 'string'),
  { message: 'page must supply either text or (imageBase64 + imageMimeType)' },
)

export type PageInput = z.infer<typeof pageInputSchema>

// ─── Stage 1: quality-assess (Haiku) ────────────────────────────────────────
// Per-page quality scoring. Routes to the right extract-text variant.

export const pageQualitySchema = z.object({
  pageNumber: z.number().int().nonnegative(),
  // 0-1; higher is cleaner. Threshold 0.7 routes to clean; below routes to
  // degraded vision. Boundary chosen empirically over Sprint 2 eval.
  qualityScore: z.number().min(0).max(1),
  // Convenience flag derived from qualityScore + heuristics.
  isClean: z.boolean(),
  // Reasons the page is degraded. Empty for clean pages. Examples:
  // 'skewed', 'low-resolution', 'photographic', 'blurry', 'redacted-overlay'.
  // Required (no .default) so the schema's input/output types match — the
  // prompt instructs the model to always emit the field, even if empty.
  issues: z.array(z.string()),
})

export type PageQuality = z.infer<typeof pageQualitySchema>

export const qualityAssessInputSchema = z.object({
  pages: z.array(pageInputSchema).min(1),
})

export const qualityAssessOutputSchema = z.object({
  pages: z.array(pageQualitySchema),
  // Recommended extraction route for the document as a whole.
  // 'clean' if all pages are clean; 'degraded' if any page is degraded
  // (per-page mixing is a Sprint 2 refinement — DEF-040 if it surfaces).
  recommendedRoute: z.enum(['clean', 'degraded']),
})

export type QualityAssessInput = z.infer<typeof qualityAssessInputSchema>
export type QualityAssessOutput = z.infer<typeof qualityAssessOutputSchema>

// ─── Stage 2: extract-text (clean) — Haiku ──────────────────────────────────
// Takes pre-extracted page text (intake passed it through mammoth/pdfplumber)
// and cleans it: strips repeated headers/footers, collapses reflow artefacts,
// emits the normalised plaintext for downstream stages.

const extractedPageSchema = z.object({
  pageNumber: z.number().int().nonnegative(),
  text: z.string(),
})

export const extractTextCleanInputSchema = z.object({
  pages: z.array(pageInputSchema).min(1),
})

export const extractTextCleanOutputSchema = z.object({
  pages: z.array(extractedPageSchema),
  // Concatenated full document text (page texts joined with form-feed-like
  // separator). What downstream triage and extract-clauses operate on.
  fullText: z.string(),
})

export type ExtractTextCleanInput = z.infer<typeof extractTextCleanInputSchema>
export type ExtractTextCleanOutput = z.infer<typeof extractTextCleanOutputSchema>

// ─── Stage 2b: extract-text (degraded) — Sonnet vision ──────────────────────
// Same output shape as the clean variant; different model. Sonnet 4.7 has
// vision and is the right tier for OCR-grade quality on scans/photos.

export const extractTextDegradedInputSchema = z.object({
  pages: z.array(pageInputSchema).min(1).refine(
    (pages) => pages.every((p) => typeof p.imageBase64 === 'string'),
    { message: 'extract-text-degraded requires every page to supply imageBase64' },
  ),
})

export const extractTextDegradedOutputSchema = extractTextCleanOutputSchema

export type ExtractTextDegradedInput = z.infer<typeof extractTextDegradedInputSchema>
export type ExtractTextDegradedOutput = z.infer<typeof extractTextDegradedOutputSchema>

// ─── Stage 3: triage — Haiku ────────────────────────────────────────────────
// Classify the document: contract type, jurisdiction, parties, confidence.
// If contract type is unsupported (Sprint 1 = NDA only), the orchestrator
// rejects with a friendly explainer reply.

export const triageInputSchema = z.object({
  fullText: z.string().min(1),
})

export const triagePartySchema = z.object({
  // Free-form role label as it appears in the document, e.g. 'Disclosing
  // Party', 'Recipient', 'Buyer', 'Counterparty A'.
  role: z.string(),
  // Best-guess legal name as written. Empty when the doc uses a placeholder
  // like '[•]' or just a role marker.
  name: z.string(),
})

export const triageOutputSchema = z.object({
  // Sprint 1 controlled vocabulary. 'unknown' when the model can't classify.
  contractType: z.enum([
    'nda', 'dpa', 'msa', 'saas', 'employment', 'lease', 'distribution', 'unknown',
  ]),
  // Best read of the governing jurisdiction (Constitution / governing-law clause).
  jurisdiction: z.enum(['kenya', 'uganda', 'tanzania', 'rwanda', 'unknown']),
  // Identified parties. May be empty or partial.
  // Required (model emits [] when no parties identified).
  parties: z.array(triagePartySchema),
  // Calibrated confidence in the contractType + jurisdiction call.
  confidence: z.enum(['high', 'medium', 'manual_review_recommended']),
  // One-sentence explanation. Plain English; surfaces in the audit log.
  reasoning: z.string(),
})

export type TriageInput = z.infer<typeof triageInputSchema>
export type TriageOutput = z.infer<typeof triageOutputSchema>

// ─── Stage 4: extract-clauses — Haiku ───────────────────────────────────────
// Decompose the document into structured clauses keyed against the playbook's
// clause id vocabulary. Unrecognised clauses get 'unknown_<n>' ids and are
// later either mapped manually (Sprint 5+) or dropped from playbook
// comparison (still surfaced in the UI as "additional clause").

export const extractedClauseSchema = z.object({
  // Maps to playbook clause id when recognised; else 'unknown_<n>'.
  clauseId: z.string().min(1),
  displayName: z.string(),
  // The verbatim clause body as it appears in the document. Needed by
  // generate-redline (the model needs to see the source) and by the
  // hallucination check.
  rawText: z.string(),
  // Where in the source document this clause appears. e.g. "Section 5", "Cl 3.2".
  // Optional because some documents have flat structure without explicit numbering.
  sectionReference: z.string().optional(),
  // 0-indexed order within the document; used to preserve original ordering
  // in the redline output.
  clauseOrder: z.number().int().nonnegative(),
})

export type ExtractedClauseDraft = z.infer<typeof extractedClauseSchema>

export const extractClausesInputSchema = z.object({
  fullText: z.string().min(1),
  // From triage. Helps the model focus on the clauses relevant to this
  // contract type rather than blindly listing everything.
  contractType: z.enum([
    'nda', 'dpa', 'msa', 'saas', 'employment', 'lease', 'distribution',
  ]),
})

export const extractClausesOutputSchema = z.object({
  clauses: z.array(extractedClauseSchema),
})

export type ExtractClausesInput = z.infer<typeof extractClausesInputSchema>
export type ExtractClausesOutput = z.infer<typeof extractClausesOutputSchema>
