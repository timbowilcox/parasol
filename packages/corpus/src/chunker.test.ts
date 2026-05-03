import { describe, it, expect } from 'vitest'
import { chunk, splitToTarget } from './chunker.js'
import type { NormalisedDocument } from './types.js'

const buildDoc = (overrides: Partial<NormalisedDocument> = {}): NormalisedDocument => ({
  canonicalId: '2019/24',
  jurisdiction: 'kenya',
  sourceType: 'statute',
  title: 'Data Protection Act, 2019',
  sourceUrl: 'https://example.test',
  retrievedAt: new Date('2026-05-04T00:00:00Z'),
  effectiveDate: null,
  metadata: {},
  fullText: '',
  sections: [],
  ...overrides,
})

describe('splitToTarget', () => {
  it('returns single chunk when under target', () => {
    expect(splitToTarget('short text', 1000, 1500)).toEqual(['short text'])
  })

  it('splits on paragraph boundaries when over target', () => {
    const text = ['A'.repeat(800), 'B'.repeat(800), 'C'.repeat(800)].join('\n\n')
    const out = splitToTarget(text, 1000, 1500)
    expect(out.length).toBeGreaterThan(1)
    // Each chunk should be under max
    for (const c of out) expect(c.length).toBeLessThanOrEqual(1500)
  })

  it('splits a single oversize paragraph on sentence boundaries', () => {
    const sentences = Array.from({ length: 20 }, (_, i) => `Sentence number ${i + 1} with content.`)
    const text = sentences.join(' ')
    const out = splitToTarget(text, 100, 200)
    expect(out.length).toBeGreaterThan(2)
    for (const c of out) expect(c.length).toBeLessThanOrEqual(200)
  })

  it('never splits inside a word', () => {
    const text = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa bbbbbbbbbbbbbbbbbbbbbbbbbbb'
    const out = splitToTarget(text, 30, 50)
    for (const c of out) {
      // Every chunk should consist of whole space-separated tokens from the input
      const tokens = c.split(/\s+/)
      for (const t of tokens) {
        expect(['aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'bbbbbbbbbbbbbbbbbbbbbbbbbbb']).toContain(t)
      }
    }
  })
})

describe('chunk', () => {
  it('emits one chunk per section with hierarchy prefix in textWithContext', () => {
    const doc = buildDoc({
      sections: [
        {
          label: 'Part I',
          heading: 'Preliminary',
          text: 'Short title.',
          children: [
            { label: 'Section 1', heading: 'Definitions', text: 'Definitions go here.', children: [] },
          ],
        },
      ],
    })
    const chunks = chunk(doc)
    expect(chunks).toHaveLength(2)

    expect(chunks[0]!.hierarchy).toEqual([doc.title, 'Part I — Preliminary'])
    expect(chunks[0]!.textWithContext).toContain(doc.title)
    expect(chunks[0]!.textWithContext).toContain('Part I — Preliminary')
    expect(chunks[0]!.text).toBe('Short title.')

    expect(chunks[1]!.hierarchy).toEqual([
      doc.title,
      'Part I — Preliminary',
      'Section 1 — Definitions',
    ])
    expect(chunks[1]!.text).toBe('Definitions go here.')
  })

  it('preserves chunkIndex order', () => {
    const doc = buildDoc({
      sections: [
        { label: 'Section 1', text: 'A', children: [] },
        { label: 'Section 2', text: 'B', children: [] },
        { label: 'Section 3', text: 'C', children: [] },
      ],
    })
    const chunks = chunk(doc)
    expect(chunks.map((c) => c.chunkIndex)).toEqual([0, 1, 2])
    expect(chunks.map((c) => c.text)).toEqual(['A', 'B', 'C'])
  })

  it('splits a long section into multiple chunks under max size', () => {
    const longText = Array.from({ length: 30 }, (_, i) => `Paragraph ${i}: ${'x'.repeat(100)}`).join('\n\n')
    const doc = buildDoc({
      sections: [{ label: 'Section 1', text: longText, children: [] }],
    })
    const chunks = chunk(doc, { targetChars: 500, maxChars: 800 })
    expect(chunks.length).toBeGreaterThan(1)
    for (const c of chunks) expect(c.text.length).toBeLessThanOrEqual(800)
    // All chunks share the same hierarchy
    for (const c of chunks) expect(c.hierarchy).toEqual([doc.title, 'Section 1'])
  })

  it('falls back to flat splitting when no sections', () => {
    const doc = buildDoc({
      sections: [],
      fullText: 'Some unstructured text.',
    })
    const chunks = chunk(doc)
    expect(chunks).toHaveLength(1)
    expect(chunks[0]!.text).toBe('Some unstructured text.')
    expect(chunks[0]!.hierarchy).toEqual([doc.title])
  })

  it('clauseTypes and areaOfLaw start empty (populated by tagger)', () => {
    const doc = buildDoc({
      sections: [{ label: 'Section 1', text: 'A', children: [] }],
    })
    const chunks = chunk(doc)
    expect(chunks[0]!.clauseTypes).toEqual([])
    expect(chunks[0]!.areaOfLaw).toEqual([])
    expect(chunks[0]!.embedding).toBeNull()
  })
})
