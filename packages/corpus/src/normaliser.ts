// HTML/text normaliser for corpus ingestion.
//
// Input: a RawDocument with HTML or plaintext body.
// Output: a NormalisedDocument with clean fullText and a hierarchical
// section tree the chunker walks.
//
// Strategy:
// - Strip nav, ads, scripts, styles, decorative markup
// - Collapse whitespace runs
// - Detect section boundaries by structural heuristics (heading levels,
//   "Section N", "Part N", etc.)
// - For Kenya Law statutes, rely on the conventional "Part / Section /
//   Subsection" hierarchy. For judgments, sections are paragraphs.

import * as cheerio from 'cheerio'
import type { AnyNode } from 'domhandler'
import type { RawDocument, NormalisedDocument, Section } from './types.js'

// `AnyNode` covers all nodes a walker might encounter (text, element,
// comment, etc.). Tag-specific helpers narrow to `Element` via runtime guard.
type DomNode = AnyNode

// ─── Public entrypoint ──────────────────────────────────────────────────────

export function normalise(raw: RawDocument): NormalisedDocument {
  const sections = raw.contentType === 'text/html'
    ? parseHtml(raw.body, raw.sourceType)
    : parsePlainText(raw.body, raw.sourceType)

  const fullText = serialiseSections(sections)

  return {
    canonicalId: raw.canonicalId,
    jurisdiction: raw.jurisdiction,
    sourceType: raw.sourceType,
    title: raw.title,
    sourceUrl: raw.sourceUrl,
    retrievedAt: raw.retrievedAt,
    effectiveDate: raw.effectiveDate ?? null,
    metadata: raw.metadata,
    fullText,
    sections,
  }
}

// ─── HTML parsing ───────────────────────────────────────────────────────────

function parseHtml(html: string, sourceType: string): Section[] {
  const $ = cheerio.load(html)

  // Strip non-content elements that pollute extracted text.
  $('script, style, nav, header, footer, aside, .navigation, .nav, .menu, .sidebar, .ads, .breadcrumb, .breadcrumbs, .skip-link, noscript').remove()

  // Find a content root. Most Kenya Law pages put the document body inside
  // a `.akn-content`, `.content`, `#content`, or `main` container.
  const root =
    $('.akn-content').first()[0] ??
    $('main').first()[0] ??
    $('#content').first()[0] ??
    $('.content').first()[0] ??
    $('body')[0]

  if (!root) return []

  if (sourceType === 'case') {
    // Judgments: chunk by paragraph rather than nested headings. The first
    // paragraph (case header) becomes the parent; subsequent paragraphs are
    // top-level siblings (no nesting).
    return parseJudgmentParagraphs($, root)
  }

  return parseStatuteHierarchy($, root)
}

function parseJudgmentParagraphs($: cheerio.CheerioAPI, root: DomNode): Section[] {
  const paragraphs = $(root).find('p').toArray()
  const sections: Section[] = []
  let order = 0
  for (const p of paragraphs) {
    const text = cleanText($(p).text())
    if (text.length < 20) continue  // skip page numbers, footers, decorative lines
    sections.push({
      label: order === 0 ? 'Header' : `Paragraph ${order}`,
      text,
      children: [],
    })
    order++
  }
  return sections
}

// Build a 3-level hierarchy from heading tags + bold-section markers.
// Kenya Law statutes use h2/h3/h4 for Part / Section / Subsection roughly,
// but the exact mapping varies. We use a heuristic: any h1-h4 starts a new
// section at its level; intervening text becomes that section's body.
function parseStatuteHierarchy($: cheerio.CheerioAPI, root: DomNode): Section[] {
  const top: Section[] = []
  const stack: Array<{ level: number; section: Section }> = []

  const walk = (el: DomNode) => {
    const $el = $(el)
    const tag = el.type === 'tag' ? el.tagName?.toLowerCase() : null

    if (tag && /^h[1-6]$/.test(tag)) {
      const level = parseInt(tag.slice(1), 10)
      const headingText = cleanText($el.text())
      if (!headingText) return
      const { label, heading } = splitHeadingLabel(headingText)
      const section: Section = { label, heading, text: '', children: [] }
      // Pop stack until we find a parent of strictly lower level
      while (stack.length > 0 && stack[stack.length - 1]!.level >= level) {
        stack.pop()
      }
      if (stack.length === 0) {
        top.push(section)
      } else {
        stack[stack.length - 1]!.section.children.push(section)
      }
      stack.push({ level, section })
      return
    }

    if (tag === 'p' || tag === 'div' || tag === 'li' || tag === 'span') {
      // Append text to the current top-of-stack section.
      const text = cleanText($el.text())
      if (text.length > 0) {
        const target = stack[stack.length - 1]
        if (target) {
          target.section.text = target.section.text
            ? target.section.text + '\n\n' + text
            : text
        } else {
          // No heading seen yet — start a synthetic root.
          if (top.length === 0) {
            top.push({ label: '', text: '', children: [] })
            stack.push({ level: 0, section: top[0]! })
          }
          const root0 = top[0]!
          root0.text = root0.text ? root0.text + '\n\n' + text : text
        }
      }
      // Don't recurse into children of paragraph-like elements; the text
      // method already includes their content.
      return
    }

    // For container elements (section, article, body, etc.) recurse.
    $el.children().each((_, child) => walk(child))
  }

  $(root).children().each((_, child) => walk(child))

  return top
}

// "Section 12 — Confidentiality" → { label: 'Section 12', heading: 'Confidentiality' }
// "Section 12. Confidentiality" → same
// "Confidentiality" → { label: 'Confidentiality', heading: undefined }
export function splitHeadingLabel(text: string): { label: string; heading?: string } {
  const m = text.match(/^(part\s+[ivxlcdm0-9]+|section\s+\d+[a-z]?|chapter\s+[ivxlcdm0-9]+|paragraph\s+\d+|article\s+\d+)\s*[.—–\-:]\s*(.+)$/i)
  if (m) return { label: m[1]!.trim(), heading: m[2]!.trim() }
  return { label: text }
}

// ─── Plain text ──────────────────────────────────────────────────────────────

function parsePlainText(body: string, sourceType: string): Section[] {
  if (sourceType === 'case') {
    // Paragraph-per-section for judgments.
    return body
      .split(/\n\s*\n/)
      .map((p, i) => ({
        label: i === 0 ? 'Header' : `Paragraph ${i}`,
        text: cleanText(p),
        children: [],
      }))
      .filter((s) => s.text.length >= 20)
  }
  // Statute fallback: split on lines starting with Section / Part / Article.
  const lines = body.split('\n')
  const top: Section[] = []
  let current: Section | null = null
  for (const raw of lines) {
    const line = raw.trim()
    if (!line) continue
    const headingMatch = line.match(/^(part\s+[ivxlcdm0-9]+|section\s+\d+[a-z]?|chapter\s+[ivxlcdm0-9]+|article\s+\d+)\s*[.—–\-:]?\s*(.*)$/i)
    if (headingMatch) {
      const { label, heading } = splitHeadingLabel(line)
      current = { label, heading, text: '', children: [] }
      top.push(current)
      continue
    }
    if (!current) {
      current = { label: '', text: '', children: [] }
      top.push(current)
    }
    current.text = current.text ? current.text + ' ' + line : line
  }
  return top
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

export function cleanText(s: string): string {
  return s
    .replace(/\u00a0/g, ' ')   // nbsp → space
    .replace(/[\t\f\v]+/g, ' ')
    .replace(/[ \t]*\n[ \t]*/g, '\n')
    .replace(/[ ]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

// Walk the section tree and produce a single newline-joined plaintext rendering.
export function serialiseSections(sections: Section[], depth = 0): string {
  const parts: string[] = []
  for (const s of sections) {
    const headerLine = [s.label, s.heading].filter(Boolean).join(' — ')
    if (headerLine) parts.push(headerLine)
    if (s.text) parts.push(s.text)
    if (s.children.length > 0) parts.push(serialiseSections(s.children, depth + 1))
  }
  return parts.join('\n\n')
}
