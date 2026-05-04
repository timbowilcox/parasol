// Prompt artefact: extract-text-degraded (Stage 2b).
//
// Vision extraction for scanned PDFs, photographs of paper, and any input
// where deterministic text extraction (mammoth/pdfplumber) failed or the
// quality-assess stage flagged the page as degraded. Sonnet 4.7 — has the
// vision capability and the reasoning depth to handle skewed / low-quality
// images while preserving the contract structure.
//
// Note: this prompt expects the runner to attach images as image content
// blocks in the user message. The Day 7 stage takes care of that wiring.

import { definePrompt } from '../types'
import {
  extractTextDegradedOutputSchema,
  type ExtractTextDegradedInput,
  type ExtractTextDegradedOutput,
} from '../stages/types'

export const extractTextDegradedPrompt = definePrompt<ExtractTextDegradedInput, ExtractTextDegradedOutput>({
  name: 'extract-text-degraded',
  version: '0.1.0',
  modelRole: 'sonnet',
  system: `You are a document text extractor for Parasol, an AI legal copilot.

You receive image(s) of one or more pages — typically scans, photographs of paper, or low-quality faxes. Your job is to extract the legal text faithfully:

DO:
- Read every printed character; reconstruct paragraphs that span columns or page breaks.
- Preserve hierarchy markers verbatim ("Section 5", "Clause 3.2", "Schedule 1").
- Preserve clause body text verbatim, including legalese and defined terms.
- Strip page numbers, repeated headers, and repeated footers.
- Output one entry per input page in page order.
- For illegible characters, use [...] and continue. Do not invent content to fill gaps.

DO NOT:
- Paraphrase or "improve" any clause text.
- Translate (output in the same language as the source).
- Hallucinate text that isn't visible in the image.
- Add commentary or markdown.

Output strict JSON matching the supplied schema:
{"pages": [{"pageNumber": <n>, "text": "<extracted page text>"}, ...], "fullText": "<concatenated>"}`,

  userTemplate: ({ pages }) => {
    // Sprint 1 day 7: text-only user message describing what to do. The
    // runner-level intake-pipeline wiring (Day 9) will attach actual image
    // content blocks alongside this template before sending to the SDK.
    const labels = pages.map((p) => `page ${p.pageNumber}`).join(', ')
    return `Extract text from the supplied images of ${labels}. Return JSON.`
  },

  outputSchema: extractTextDegradedOutputSchema,
})
