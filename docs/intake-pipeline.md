# Intake Pipeline

Parasol's intake is format-agnostic. Detail on how PDF, scan, photo, .docx, and Google Docs are routed through a single pipeline.

## Design principle

The Kenyan SME reality is that contracts arrive in mixed formats: 60-70% PDF (mixed quality), 15-20% .docx, 5-10% scans or phone photos, plus a long tail of .doc, .rtf, Pages files, and Google Docs links. Robin AI and Legora's Word-add-in-first design assumes a sophisticated counterparty workflow that doesn't reflect EAC reality. We design for the real distribution.

## Routing decision tree

For each input: detect file type and source. .docx with extractable text → mammoth. PDF with extractable text → pdfplumber. PDF without text (scanned) → Sonnet vision. Image (photograph) → Sonnet vision. After extraction, all paths run through the quality-assess stage (Haiku) which scores per page; high-quality pages go through Haiku for further extraction, degraded pages go through Sonnet, very low-quality pages get rejected with a friendly re-upload request.

## Per-format handling

### .docx (clean digital)
- Library: Mammoth.js
- Preserves: paragraphs, headings, lists, tables, tracked changes (warns if present), comments
- Outputs: structured Markdown-ish representation with style tags
- Cost: free, fast (sub-second)

### .doc (legacy Word)
- Library: LibreOffice headless to convert to .docx, then Mammoth
- Cost: ~2 seconds per document

### PDF (digital, generated from Word)
- Library: pdfplumber primary, pymupdf4llm fallback
- Preserves: text, hierarchical structure where layout permits, tables (best effort)
- Outputs: structured text with paragraph breaks
- Cost: free, fast
- Detection: presence of extractable text layer with reasonable density (>200 chars per page on average)

### PDF (scanned, no text layer)
- Routing: vision pipeline
- Sonnet vision processes pages as images
- Multi-page documents: process in chunks of 10-15 pages with overlap, assemble structured output
- Cost: ~$0.10-0.15 per page

### Photographs (single or multi-page)
- Pre-processing: orientation detection (Haiku quick pass), perspective correction (deferred to Sonnet vision which handles angled shots well)
- Multi-page assembly: user uploads multiple images; UI prompts to confirm order; orchestrator assembles into a logical document
- Quality assessment (Haiku): "is this readable? is anything obscured? are pages missing?"
- Vision extraction (Sonnet): structured output as if it were a digital document
- Cost: ~$0.10-0.20 per page

### Google Docs
- OAuth integration with Google Drive
- Fetch as .docx via Drive API export, then Mammoth pipeline

### Pasted text
- Simplest path: input is already plain text
- Triage stage classifies: is this a clause? a full contract? a question? Routes accordingly.

### Email forwarding flow specifically
- Resend inbound webhook receives the forwarded email at `ask@<workspace-slug>.parasol.co.ke` (Sprint 1: fixed `ask.parasol.co.ke`; Sprint 3: per-workspace subdomain per DEF-002)
- Webhook validates sender against workspace's allowed-sender list
- Attachments extracted; if multiple, prompt user to clarify which
- If body contains contract text but no attachment, treat body as pasted text
- Routes through main pipeline
- Reply email assembled and sent within 90 seconds (target)

## Quality assessment stage

Implemented as Haiku stage `packages/ai/src/stages/quality-assess.ts`. Per-page output:

```ts
interface PageQuality {
  pageNumber: number;
  qualityScore: 1 | 2 | 3 | 4 | 5;
  flags: PageQualityFlag[];           // 'rotated', 'low-contrast', 'handwriting-present', 'partial-obscure', 'multi-column', 'complex-table'
  recommendedRoute: 'haiku-extract' | 'sonnet-extract' | 'reject';
  reasoning: string;
}
```

The orchestrator routes per page, not per document. A 10-page contract with 7 clean pages and 3 messy ones gets 7 Haiku extractions and 3 Sonnet extractions, blended into a single structured contract representation.

## Output formats

The user's chosen output is offered at review-completion time:

| Format | Use case | Implementation |
|--------|----------|----------------|
| .docx with tracked changes | Counterparty negotiation | docxtemplater + python-docx for clean tracked-change XML |
| Annotated PDF | Forward-as-is to counterparty | pdf-lib for highlights and sticky-note comments |
| Structured email | Quick triage, mobile reading | Email body with severity-grouped issues |
| JSON | API integrations (Business+ tier) | Same shape as orchestrator output |

Default per workspace, configurable per-review.

## Failure handling

| Failure | User-facing message | Internal action |
|---------|--------------------|-----------------|
| File too large (>20MB) | "This contract exceeds our 20MB limit. Try compressing the PDF or splitting it." | Log; offer support |
| Unsupported format | "Parasol can read PDFs, Word docs, photos, and Google Docs. We can't yet read [type]." | Log for prioritisation |
| Quality too low | "The image quality is too low to read reliably. Could you re-capture in better light?" | Log; suggest tips |
| Text extraction fails | "We had trouble reading this document. Try uploading as PDF or .docx if possible." | Log with sample for review |
| Document is not a contract | "This doesn't look like a contract. Want to send it as a question instead?" | Triage stage classification |
| Document is in a contract type we don't support yet | "We don't yet support [type] reviews. Want me to flag this for our roadmap?" | Capture interest signal |
| All vision attempts fail | "We couldn't reliably read this scan. Recommend sending the original Word/PDF if you have it." | Log full failure |

## Storage of intake artefacts

Original uploads stored in Supabase Storage under `documents/<workspace-id>/<review-id>/<filename>`. Encrypted at rest. Retained per workspace data retention policy (default 12 months, configurable).

Extracted structured representation stored in Postgres as JSONB on the review row. Re-extraction from original is possible if needed (for re-running the pipeline against an updated playbook, for example).

## Mobile capture (PWA, v1)

Specific UX:
- Single-tap "Capture contract" CTA from PWA home
- Camera opens with a guide outline
- Takes photo, asks "another page?" yes/no
- After all pages, asks "is this a [detected type] contract?" with confirm/correct
- Submit; receive notification when review is ready
- View in PWA or wait for email

Built into the same Next.js codebase as the web app, mobile-optimised. No native app in v1.

## What we don't support in v1

- Live document editing (no real-time collaboration)
- OCR of handwritten contracts (printed only)
- Languages beyond English and Swahili
- Audio dictation of contracts
- Faxed documents

## Testing the intake pipeline

`packages/eval/data/intake-fixtures/` contains test fixtures across formats:
- `clean-docx/` — well-formatted .docx files
- `clean-pdf/` — text-extractable PDFs
- `scanned-pdf/` — scans of various quality
- `photo-good/` — well-lit phone photos
- `photo-bad/` — angled, low-light, partial obscure
- `multi-page-photos/` — assembly tests
- `edge-cases/` — password-protected, corrupt, mixed-format

Eval suite includes intake-stage tests independent of the full review pipeline.
