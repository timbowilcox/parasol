// Section-aware chunker for normalised legal documents.
//
// Strategy:
// - Walk the section tree depth-first
// - Collect text with the hierarchy path (root→leaf labels)
// - Pack into chunks of ~targetChars characters, preferring section boundaries
// - When a single section's text exceeds target size, split on paragraph then
//   sentence boundaries (never mid-word)
// - Each chunk's `textWithContext` prefixes the hierarchy: "Companies Act 2015
//   → Part III → Section 12 — Confidentiality: <text>"
//
// We size by characters rather than tokens because the only place tokens
// matter is the embedding API limit (Voyage-3 caps at 32k tokens per input;
// well above any single chunk). 500 tokens ≈ 2000 chars for English legal
// text, so target 2000 chars by default.

import type { NormalisedDocument, Chunk, Section } from './types'

export interface ChunkerOptions {
  // Target chunk size in characters. Default: 2000 (~500 tokens).
  targetChars?: number
  // Maximum chunk size before forced split. Default: 3000.
  maxChars?: number
  // Document title to prepend to every chunk's hierarchy. Default: doc.title.
  rootLabel?: string
}

const DEFAULT_TARGET = 2000
const DEFAULT_MAX = 3000

export function chunk(doc: NormalisedDocument, opts: ChunkerOptions = {}): Chunk[] {
  const targetChars = opts.targetChars ?? DEFAULT_TARGET
  const maxChars = opts.maxChars ?? DEFAULT_MAX
  const rootLabel = opts.rootLabel ?? doc.title

  const out: Chunk[] = []
  let order = 0

  const emit = (hierarchy: string[], text: string) => {
    if (text.trim().length === 0) return
    const hierarchyWithRoot = [rootLabel, ...hierarchy]
    out.push({
      chunkIndex: order++,
      hierarchy: hierarchyWithRoot,
      text: text.trim(),
      textWithContext: hierarchyWithRoot.join(' → ') + ': ' + text.trim(),
      clauseTypes: [],
      areaOfLaw: [],
      embedding: null,
    })
  }

  const walkSection = (section: Section, parentPath: string[]) => {
    const label = [section.label, section.heading].filter(Boolean).join(' — ')
    const path = label ? [...parentPath, label] : parentPath

    if (section.text.length > 0) {
      for (const piece of splitToTarget(section.text, targetChars, maxChars)) {
        emit(path, piece)
      }
    }
    for (const child of section.children) {
      walkSection(child, path)
    }
  }

  if (doc.sections.length === 0) {
    // No structure detected — fall back to splitting fullText into chunks
    // under a single synthetic path.
    for (const piece of splitToTarget(doc.fullText, targetChars, maxChars)) {
      emit([], piece)
    }
    return out
  }

  for (const section of doc.sections) {
    walkSection(section, [])
  }
  return out
}

// Split text into chunks no larger than maxChars, preferring boundaries at
// targetChars. Splits on paragraph boundary first, then sentence, then word.
// Never splits inside a word.
export function splitToTarget(text: string, target: number, max: number): string[] {
  if (text.length <= target) return [text.trim()]

  const out: string[] = []
  const paragraphs = text.split(/\n{2,}/)
  let current = ''

  const flush = () => {
    const t = current.trim()
    if (t.length > 0) out.push(t)
    current = ''
  }

  for (const p of paragraphs) {
    const candidate = current ? current + '\n\n' + p : p
    if (candidate.length <= target) {
      current = candidate
      continue
    }
    if (current.length === 0) {
      // Single paragraph exceeds target; recurse on it via sentence split.
      for (const s of splitOnSentenceBoundary(p, target, max)) out.push(s)
    } else if (candidate.length <= max) {
      // Allow one paragraph over target so we don't fragment unnecessarily.
      current = candidate
      flush()
    } else {
      flush()
      // Fall through: handle paragraph via sentence split if it still doesn't fit.
      if (p.length <= target) {
        current = p
      } else {
        for (const s of splitOnSentenceBoundary(p, target, max)) out.push(s)
      }
    }
  }
  flush()
  return out
}

function splitOnSentenceBoundary(text: string, target: number, max: number): string[] {
  // Sentence end = . ? ! followed by whitespace then capital letter.
  // For legal text, also split on semicolon-paragraphs in long enumerations.
  const sentences = text.split(/(?<=[.?!])\s+(?=[A-Z(])/)
  const out: string[] = []
  let current = ''
  for (const s of sentences) {
    const candidate = current ? current + ' ' + s : s
    if (candidate.length <= target) {
      current = candidate
    } else if (current.length === 0) {
      // Single sentence exceeds target; force a hard split on whitespace.
      for (const w of hardSplit(s, max)) out.push(w)
    } else {
      out.push(current.trim())
      current = s
    }
  }
  if (current.trim()) out.push(current.trim())
  return out
}

function hardSplit(text: string, max: number): string[] {
  const out: string[] = []
  const words = text.split(/\s+/)
  let current = ''
  for (const w of words) {
    const candidate = current ? current + ' ' + w : w
    if (candidate.length <= max) {
      current = candidate
    } else {
      if (current) out.push(current)
      current = w
    }
  }
  if (current) out.push(current)
  return out
}
