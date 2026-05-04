import { describe, it, expect } from 'vitest'
import { normalise, splitHeadingLabel, cleanText, serialiseSections } from './normaliser'
import type { RawDocument } from './types'

const baseRaw = (overrides: Partial<RawDocument> = {}): RawDocument => ({
  canonicalId: '2019/24',
  jurisdiction: 'kenya',
  sourceType: 'statute',
  title: 'Data Protection Act, 2019',
  sourceUrl: 'https://kenyalaw.org/akn/ke/act/2019/24',
  retrievedAt: new Date('2026-05-04T00:00:00Z'),
  contentType: 'text/html',
  body: '',
  metadata: {},
  ...overrides,
})

describe('cleanText', () => {
  it('collapses whitespace', () => {
    expect(cleanText('  hello   world  ')).toBe('hello world')
    expect(cleanText('a\n\n\n\nb')).toBe('a\n\nb')
    expect(cleanText('a\u00a0b')).toBe('a b')
  })
})

describe('splitHeadingLabel', () => {
  it('splits "Section N — Title" form', () => {
    expect(splitHeadingLabel('Section 12 — Confidentiality')).toEqual({
      label: 'Section 12',
      heading: 'Confidentiality',
    })
  })
  it('splits "Section N. Title" form', () => {
    expect(splitHeadingLabel('Section 12. Confidentiality')).toEqual({
      label: 'Section 12',
      heading: 'Confidentiality',
    })
  })
  it('handles Part / Chapter / Article', () => {
    expect(splitHeadingLabel('Part III — Companies')).toEqual({
      label: 'Part III',
      heading: 'Companies',
    })
    expect(splitHeadingLabel('Chapter 5: Tax')).toEqual({
      label: 'Chapter 5',
      heading: 'Tax',
    })
  })
  it('falls back when no recognised label form', () => {
    expect(splitHeadingLabel('Confidentiality')).toEqual({ label: 'Confidentiality' })
  })
})

describe('normalise — statute HTML', () => {
  it('parses heading hierarchy into nested sections', () => {
    const raw = baseRaw({
      body: `<html><body>
        <main>
          <h2>Part I — Preliminary</h2>
          <p>Short title.</p>
          <h3>Section 1 — Definitions</h3>
          <p>"Personal data" means information about an identified person.</p>
          <h3>Section 2 — Application</h3>
          <p>This Act applies to data controllers in Kenya.</p>
          <h2>Part II — Principles</h2>
          <p>The data protection principles.</p>
        </main>
      </body></html>`,
    })
    const norm = normalise(raw)
    expect(norm.sections).toHaveLength(2)
    expect(norm.sections[0]!.label).toBe('Part I')
    expect(norm.sections[0]!.heading).toBe('Preliminary')
    expect(norm.sections[0]!.children).toHaveLength(2)
    expect(norm.sections[0]!.children[0]!.label).toBe('Section 1')
    expect(norm.sections[0]!.children[0]!.heading).toBe('Definitions')
    expect(norm.sections[0]!.children[1]!.label).toBe('Section 2')
    expect(norm.sections[1]!.label).toBe('Part II')
    expect(norm.sections[1]!.heading).toBe('Principles')
  })

  it('strips nav/script/style/aside', () => {
    const raw = baseRaw({
      body: `<html><body>
        <nav>Home | About</nav>
        <script>console.log('x')</script>
        <style>body { color: red }</style>
        <main>
          <h2>Section 1 — Real content</h2>
          <p>Body text.</p>
        </main>
        <aside>Sidebar ad</aside>
      </body></html>`,
    })
    const norm = normalise(raw)
    expect(norm.fullText).not.toContain('Home | About')
    expect(norm.fullText).not.toContain('console.log')
    expect(norm.fullText).not.toContain('color: red')
    expect(norm.fullText).not.toContain('Sidebar ad')
    expect(norm.fullText).toContain('Body text.')
  })

  it('preserves text under root when no headings precede it', () => {
    const raw = baseRaw({
      body: `<html><body><main><p>Bare paragraph.</p><h2>Section 1 — Heading</h2><p>After.</p></main></body></html>`,
    })
    const norm = normalise(raw)
    expect(norm.fullText).toContain('Bare paragraph.')
    expect(norm.fullText).toContain('After.')
  })
})

describe('normalise — judgment HTML', () => {
  it('paragraphs become flat sections', () => {
    const raw = baseRaw({
      sourceType: 'case',
      title: 'Republic v Smith [2023] eKLR',
      body: `<html><body><main>
        <p>${'A'.repeat(100)} (header paragraph)</p>
        <p>${'B'.repeat(100)} (paragraph 1)</p>
        <p>short</p>
        <p>${'C'.repeat(100)} (paragraph 2)</p>
      </main></body></html>`,
    })
    const norm = normalise(raw)
    // 3 paragraphs (the "short" one is filtered as < 20 chars)
    expect(norm.sections).toHaveLength(3)
    expect(norm.sections[0]!.label).toBe('Header')
    expect(norm.sections[1]!.label).toBe('Paragraph 1')
    expect(norm.sections[2]!.label).toBe('Paragraph 2')
  })
})

describe('normalise — plain text statute', () => {
  it('detects Section / Part labels in flat text', () => {
    const raw = baseRaw({
      contentType: 'text/plain',
      body: `Part I — Preliminary
Section 1. Short title
This Act may be cited as the Test Act.

Section 2. Definitions
"Person" means a natural or juristic person.`,
    })
    const norm = normalise(raw)
    const labels = norm.sections.map((s) => s.label)
    expect(labels).toContain('Part I')
    expect(labels).toContain('Section 1')
    expect(labels).toContain('Section 2')
  })
})

describe('serialiseSections', () => {
  it('joins sections with hierarchy headers', () => {
    const out = serialiseSections([
      {
        label: 'Section 1',
        heading: 'Title',
        text: 'Body',
        children: [
          { label: 'Subsection (a)', text: 'Sub body', children: [] },
        ],
      },
    ])
    expect(out).toContain('Section 1 — Title')
    expect(out).toContain('Body')
    expect(out).toContain('Subsection (a)')
    expect(out).toContain('Sub body')
  })
})
