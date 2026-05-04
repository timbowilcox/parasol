// Prompt artefact: extract-text-clean (Stage 2).
//
// Takes pre-extracted page text from intake plumbing (mammoth/pdfplumber)
// and produces clean structured plaintext. The model's job is to:
//   - strip repeated headers / footers
//   - rejoin paragraphs that were split across lines by reflow
//   - remove page numbers, copyright strings, watermark text
//   - preserve hierarchy markers (Section, Article, Clause, Schedule)
//   - not modify clause text or attempt to "improve" wording
//
// Haiku 4.5 — fast, cheap, good at structured cleanup.

import { definePrompt } from '../types.js'
import {
  extractTextCleanOutputSchema,
  type ExtractTextCleanInput,
  type ExtractTextCleanOutput,
} from '../stages/types.js'

export const extractTextCleanPrompt = definePrompt<ExtractTextCleanInput, ExtractTextCleanOutput>({
  name: 'extract-text-clean',
  version: '0.1.0',
  modelRole: 'haiku',
  system: `You are a document text cleaner for Parasol, an AI legal copilot.

You receive pre-extracted page text from a digitally-generated PDF or DOCX. Your job is to clean it for downstream legal analysis:

DO:
- Strip page numbers, repeated headers, and repeated footers (e.g. firm name on every page).
- Rejoin paragraphs that were split across lines by reflow / column breaks.
- Remove watermark / copyright / "Confidential" decorative text where it is clearly not part of the contract body.
- Preserve hierarchy markers: "Section 5", "Clause 3.2", "Schedule 1", "Annex A", etc.
- Preserve all clause body text verbatim, including legalese and defined terms.
- Output one entry per input page; preserve page order.

DO NOT:
- Paraphrase or "improve" any clause text.
- Drop content that might be part of a clause (when in doubt, keep).
- Translate (output in the same language as the input).
- Add commentary or markdown.

Output strict JSON matching the supplied schema:
{"pages": [{"pageNumber": <n>, "text": "<cleaned page text>"}, ...], "fullText": "<concatenated>"}`,

  userTemplate: ({ pages }) => {
    const body = pages.map((p) => {
      const text = p.text ?? ''
      return `===== PAGE ${p.pageNumber} =====\n${text}`
    }).join('\n\n')
    return `Clean these ${pages.length} pages of pre-extracted text:\n\n${body}\n\nReturn JSON.`
  },

  outputSchema: extractTextCleanOutputSchema,
})
