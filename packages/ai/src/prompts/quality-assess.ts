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
  version: '0.2.0',
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

OUTPUT FORMAT — strict JSON, no prose, no markdown, no commentary.

Every page object MUST include all four fields, every time, with no exceptions:
- "pageNumber" (integer, copied from the input)
- "qualityScore" (number between 0 and 1)
- "isClean" (boolean — true when qualityScore >= 0.7, false otherwise)
- "issues" (array of strings — empty array [] for clean pages; non-empty
  for degraded pages, with short reason tokens like "skewed",
  "low-resolution", "photographic", "redacted-overlay", "ocr-artefacts")

Top-level object MUST include:
- "pages" (array of page objects in input order)
- "recommendedRoute" ("clean" if every page is clean; "degraded" otherwise)

Do NOT omit fields even when they are obvious or empty. The schema validator
rejects partial output.`,

  userTemplate: ({ pages }) => {
    const summary = pages.map((p) => {
      const hasText = typeof p.text === 'string' ? p.text.length : 0
      const hasImage = typeof p.imageBase64 === 'string'
      return `page ${p.pageNumber}: textChars=${hasText} hasImage=${hasImage}`
    }).join('\n')
    // Worked example forces the right shape — Haiku followed a partial-
    // output pattern in production on a single-page DOCX, omitting
    // qualityScore / isClean / issues entirely. Concrete examples
    // anchor the model's output shape better than schema prose alone.
    return `Assess these ${pages.length} pages:

${summary}

Example output for a single clean digital DOCX page:
{"pages":[{"pageNumber":1,"qualityScore":0.95,"isClean":true,"issues":[]}],"recommendedRoute":"clean"}

Example output for a two-page mixed input where page 2 is a photo:
{"pages":[{"pageNumber":1,"qualityScore":0.92,"isClean":true,"issues":[]},{"pageNumber":2,"qualityScore":0.45,"isClean":false,"issues":["photographic","skewed"]}],"recommendedRoute":"degraded"}

Now produce the JSON for the input above.`
  },

  outputSchema: qualityAssessOutputSchema,
})
