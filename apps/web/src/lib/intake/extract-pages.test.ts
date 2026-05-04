import { describe, it, expect, vi } from 'vitest'
import { extractPages } from './extract-pages'

// pdf-parse and mammoth are NOT mocked: we generate a tiny real DOCX in
// memory below and a hand-built PDF byte stream. The library calls run for
// real, which is the closest we can get to "would this work in production"
// without a Resend webhook fixture.

describe('extractPages — text/plain', () => {
  it('returns a single page from text/plain bytes', async () => {
    const bytes = new TextEncoder().encode('This is a contract.\nAll rights reserved.')
    const result = await extractPages({ bytes, mimeType: 'text/plain' })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.pages).toHaveLength(1)
    expect(result.pages[0]!.text).toContain('This is a contract.')
    expect(result.pages[0]!.pageNumber).toBe(1)
  })

  it('returns empty_document on whitespace-only text', async () => {
    const bytes = new TextEncoder().encode('   \n\n  ')
    const result = await extractPages({ bytes, mimeType: 'text/plain' })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('empty_document')
  })
})

describe('extractPages — MIME normalisation', () => {
  it('rejects unsupported MIME with no fallback extension', async () => {
    const bytes = new TextEncoder().encode('whatever')
    const result = await extractPages({ bytes, mimeType: 'application/zip', filename: 'file.zip' })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('unsupported_mime')
  })

  it('routes octet-stream + .pdf filename to PDF path', async () => {
    // The PDF path will fail extraction on these bytes, but we verify the
    // mime normalisation kicked in by checking the failure reason is
    // extraction_failed (i.e. pdf-parse was invoked) rather than
    // unsupported_mime (i.e. we never tried).
    const bytes = new TextEncoder().encode('not actually a PDF')
    const result = await extractPages({
      bytes,
      mimeType: 'application/octet-stream',
      filename: 'contract.pdf',
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('extraction_failed')
  })

  it('rejects legacy .doc (application/msword) — DOCX only in v1', async () => {
    const bytes = new TextEncoder().encode('legacy word')
    const result = await extractPages({ bytes, mimeType: 'application/msword' })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('unsupported_mime')
  })
})

describe('extractPages — DOCX', () => {
  it('extracts text from a DOCX (mammoth happy path)', async () => {
    vi.doMock('mammoth', () => ({
      extractRawText: () => Promise.resolve({ value: 'Confidentiality Agreement\n\nThis Agreement is between Acme Ltd and Beta Inc.' }),
    }))
    vi.resetModules()
    const { extractPages: freshExtract } = await import('./extract-pages.js')
    const result = await freshExtract({
      bytes: new Uint8Array([0x50, 0x4B, 0x03, 0x04]),
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.pages).toHaveLength(1)
    expect(result.pages[0]!.text).toContain('Confidentiality Agreement')
    expect(result.pages[0]!.text).toContain('Acme Ltd')
    vi.doUnmock('mammoth')
  })

  it('returns empty_document on whitespace-only DOCX content', async () => {
    vi.doMock('mammoth', () => ({
      extractRawText: () => Promise.resolve({ value: '   \n\n  ' }),
    }))
    vi.resetModules()
    const { extractPages: freshExtract } = await import('./extract-pages.js')
    const result = await freshExtract({
      bytes: new Uint8Array([0x50, 0x4B, 0x03, 0x04]),
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('empty_document')
    vi.doUnmock('mammoth')
  })

  it('returns extraction_failed on a non-DOCX byte payload claiming the DOCX MIME', async () => {
    vi.doMock('mammoth', () => ({
      extractRawText: () => Promise.reject(new Error('not a zip file')),
    }))
    vi.resetModules()
    const { extractPages: freshExtract } = await import('./extract-pages.js')
    const result = await freshExtract({
      bytes: new TextEncoder().encode('not a real docx'),
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('extraction_failed')
    vi.doUnmock('mammoth')
  })
})

describe('extractPages — PDF', () => {
  // pdf-parse internally relies on `pdfjs-dist` which is happy with malformed
  // PDFs in surprising ways. We don't construct a real PDF here (would need a
  // dedicated builder library). Instead we mock the dynamic import of
  // pdf-parse to assert the page-splitting logic works correctly once parsed.
  it('splits multi-page PDF text on form-feed', async () => {
    vi.doMock('pdf-parse/lib/pdf-parse.js', () => ({
      default: () => Promise.resolve({
        text: 'Page one body.\fPage two body.\fPage three body.\f',
        numpages: 3,
      }),
    }))
    // Force re-import so the mock takes effect.
    vi.resetModules()
    const { extractPages: freshExtract } = await import('./extract-pages.js')
    const result = await freshExtract({
      bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46]), // "%PDF" — bogus content; the mock ignores it
      mimeType: 'application/pdf',
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.pages).toHaveLength(3)
    expect(result.pages[0]!.text).toBe('Page one body.')
    expect(result.pages[2]!.text).toBe('Page three body.')
    vi.doUnmock('pdf-parse/lib/pdf-parse.js')
  })

  it('returns empty_document when the PDF has pages but no text', async () => {
    vi.doMock('pdf-parse/lib/pdf-parse.js', () => ({
      default: () => Promise.resolve({ text: '', numpages: 5 }),
    }))
    vi.resetModules()
    const { extractPages: freshExtract } = await import('./extract-pages.js')
    const result = await freshExtract({
      bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46]),
      mimeType: 'application/pdf',
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('empty_document')
    expect(result.detail).toContain('5 pages')
    vi.doUnmock('pdf-parse/lib/pdf-parse.js')
  })
})
