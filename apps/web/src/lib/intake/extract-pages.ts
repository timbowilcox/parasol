// Document intake — converts raw bytes from email/web upload into the
// `PageInput[]` shape the orchestrator's quality-assess and extract-text
// stages consume.
//
// Sprint 1 supports three paths:
//   - PDF (digital, text-extractable) via pdf-parse → one PageInput per page
//   - DOCX via mammoth → single-PageInput with concatenated text
//   - text/plain passthrough → single-PageInput
//
// Photographs / scanned PDFs are not yet rasterised here: the orchestrator's
// extract-text-degraded stage takes `imageBase64` per page; landing the
// PDF-to-PNG rasteriser is DEF-047 (vision-degraded intake). Day 10 ships
// the clean path; degraded NDAs return a structured error so the route
// handler can reply with an "unsupported input" message.

import type { PageInput } from '@parasol/ai'

export type IntakeMimeType =
  | 'application/pdf'
  | 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  | 'text/plain'

export interface ExtractPagesInput {
  bytes: Uint8Array
  mimeType: string
  filename?: string
}

export type ExtractPagesResult =
  | { ok: true; pages: PageInput[]; rawCharCount: number }
  | { ok: false; reason: 'unsupported_mime' | 'extraction_failed' | 'empty_document'; detail: string }

export async function extractPages(input: ExtractPagesInput): Promise<ExtractPagesResult> {
  const mime = normaliseMime(input.mimeType, input.filename)

  if (mime === 'application/pdf') {
    return extractPdf(input.bytes)
  }
  if (mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
    return extractDocx(input.bytes)
  }
  if (mime === 'text/plain') {
    return extractText(input.bytes)
  }

  return {
    ok: false,
    reason: 'unsupported_mime',
    detail: `Sprint 1 supports PDF, DOCX, and text/plain; received ${input.mimeType}`,
  }
}

// ─── PDF ─────────────────────────────────────────────────────────────────────
// pdf-parse returns the whole document text in a single string with form-feeds
// (\f) between pages. We split on those to produce per-page PageInput entries
// so quality-assess can score pages individually.

async function extractPdf(bytes: Uint8Array): Promise<ExtractPagesResult> {
  let parsed: { text: string; numpages: number }
  try {
    // pdf-parse loads at runtime; the package's index ships a debug harness
    // that runs at import time, so we point at the library entry directly.
    const { default: pdfParse } = (await import('pdf-parse/lib/pdf-parse.js')) as {
      default: (data: Buffer | Uint8Array) => Promise<{ text: string; numpages: number }>
    }
    parsed = await pdfParse(Buffer.from(bytes))
  } catch (cause) {
    return {
      ok: false,
      reason: 'extraction_failed',
      detail: `pdf-parse failed: ${(cause as Error).message}`,
    }
  }

  const pageTexts = parsed.text.split('\f')
  // pdf-parse emits a trailing empty string after the final form-feed; drop it.
  if (pageTexts.length > 0 && pageTexts[pageTexts.length - 1]!.trim() === '') {
    pageTexts.pop()
  }

  // Some digital PDFs come through with empty per-page text but a valid
  // numpages count — that's a scan masquerading as a digital PDF, which the
  // quality-assess stage normally catches via the imageBase64 path. We don't
  // have rasterisation in v1 of intake (DEF-047), so we surface a clear
  // failure instead of feeding empty text to the pipeline.
  const totalChars = pageTexts.reduce((sum, t) => sum + t.length, 0)
  if (totalChars === 0) {
    return {
      ok: false,
      reason: 'empty_document',
      detail: `PDF has ${parsed.numpages} pages but no extractable text — likely a scan; vision intake is deferred (DEF-047)`,
    }
  }

  const pages: PageInput[] = pageTexts.map((text, idx) => ({
    pageNumber: idx + 1,
    text,
  }))

  return { ok: true, pages, rawCharCount: totalChars }
}

// ─── DOCX ────────────────────────────────────────────────────────────────────
// mammoth doesn't preserve page boundaries — Word stores reflow, not pages —
// so we return a single PageInput. Quality-assess will mark this as clean
// because text is present and length > 0; downstream stages don't care about
// page granularity for DOCX.

async function extractDocx(bytes: Uint8Array): Promise<ExtractPagesResult> {
  let result: { value: string }
  try {
    const mammoth = await import('mammoth')
    result = await mammoth.extractRawText({ buffer: Buffer.from(bytes) })
  } catch (cause) {
    return {
      ok: false,
      reason: 'extraction_failed',
      detail: `mammoth failed: ${(cause as Error).message}`,
    }
  }

  if (result.value.trim().length === 0) {
    return { ok: false, reason: 'empty_document', detail: 'DOCX has no extractable text' }
  }

  return {
    ok: true,
    pages: [{ pageNumber: 1, text: result.value }],
    rawCharCount: result.value.length,
  }
}

// ─── text/plain ──────────────────────────────────────────────────────────────

function extractText(bytes: Uint8Array): ExtractPagesResult {
  const text = new TextDecoder('utf-8').decode(bytes)
  if (text.trim().length === 0) {
    return { ok: false, reason: 'empty_document', detail: 'text/plain payload is empty' }
  }
  return {
    ok: true,
    pages: [{ pageNumber: 1, text }],
    rawCharCount: text.length,
  }
}

// ─── MIME normalisation ──────────────────────────────────────────────────────

function normaliseMime(mime: string, filename: string | undefined): string {
  const base = mime.toLowerCase().split(';')[0]!.trim()
  if (base === 'application/pdf') return 'application/pdf'
  if (base === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') return base
  if (base === 'application/msword') {
    // Old .doc — not supported in v1; fall through to unsupported.
    return base
  }
  if (base === 'text/plain') return 'text/plain'

  // Some upstream senders set application/octet-stream and rely on filename.
  // Trust the extension when the MIME is generic.
  if (filename) {
    const lower = filename.toLowerCase()
    if (lower.endsWith('.pdf')) return 'application/pdf'
    if (lower.endsWith('.docx')) {
      return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    }
    if (lower.endsWith('.txt')) return 'text/plain'
  }

  return base
}
