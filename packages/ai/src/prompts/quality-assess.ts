// Prompt artefact: quality-assess (Stage 1).
//
// Per-page quality scoring. Run on Haiku 4.5 — the model only needs to
// recognise common degradation signals (skew, photograph artefacts, low
// resolution, redaction overlay) and return a structured score. No
// reasoning over content is required.
//
// Versioning: bump version on any wording change to the system prompt
// or output schema. Eval suite gates against regressions per stage.

import { definePrompt } from '../types'
import {
  qualityAssessOutputSchema,
  type QualityAssessInput,
  type QualityAssessOutput,
} from '../stages/types'

export const qualityAssessPrompt = definePrompt<QualityAssessInput, QualityAssessOutput>({
  name: 'quality-assess',
  version: '0.1.0',
  modelRole: 'haiku',
  system: `You are a document-intake quality classifier for Parasol, an AI legal copilot.

For each page supplied, decide whether it is suitable for direct text-based extraction (clean) or requires a vision-based extraction pass (degraded).

A page is CLEAN when it is:
- digitally generated PDF or DOCX
- has selectable / extractable text supplied to you in the input
- not a scanned image, photograph of paper, or OCR-corrupted output

A page is DEGRADED when it is:
- a scan or photograph (image-only, no embedded text)
- visibly skewed, rotated, or low-resolution
- has redaction overlays, watermarks, or stamps that interfere with text
- has OCR artefacts (broken word boundaries, swapped characters)

Score each page 0-1 (higher is cleaner). Threshold: 0.7 → clean, below → degraded.
Recommend "clean" route only if every page passes; otherwise "degraded".

Output strict JSON matching the supplied schema. No prose, no markdown.`,

  userTemplate: ({ pages }) => {
    // For Sprint 1 the model receives a compact summary per page rather
    // than the full text/image — quality-assess is a sniff test, not an
    // extraction. Day 9 may upgrade to a full vision pass on the first
    // page if the heuristic proves unreliable.
    const summary = pages.map((p) => {
      const hasText = typeof p.text === 'string' ? p.text.length : 0
      const hasImage = typeof p.imageBase64 === 'string'
      return `page ${p.pageNumber}: textChars=${hasText} hasImage=${hasImage}`
    }).join('\n')
    return `Assess these ${pages.length} pages:\n\n${summary}\n\nReturn JSON {"pages": [...], "recommendedRoute": "clean"|"degraded"}.`
  },

  outputSchema: qualityAssessOutputSchema,
})
