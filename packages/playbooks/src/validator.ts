// Playbook validator.
//
// Three checks run in sequence:
//
//   1. Schema validation — Zod parse against playbookSchema (structure).
//   2. Critical-citation rule — every clause with importance=critical must
//      have at least one citation that resolves in the corpus, OR be tagged
//      as a market-norm / parasol-internal source where corpus resolution
//      is intentionally not expected.
//   3. Corpus-resolution check — every citation with a corpus-typed source
//      must resolve to a corpus_documents row by canonical_id at validation
//      time. Skipped if no resolver is supplied (e.g. validating standalone
//      without DB access during CI on a fresh checkout).
//
// Returns a structured ValidationResult so callers can distinguish a
// schema-only validation (offline) from a full validation that had a
// resolver. Throws nothing — failure is reported in the result.

import { readFile } from 'node:fs/promises'
import { parse as parseYaml } from 'yaml'
import {
  playbookSchema,
  NON_CORPUS_CITATION_SOURCES,
  type Playbook,
  type CitationSource,
} from './schema.js'

// A function that resolves a citation by (source, canonical_id) to whether it
// exists in the corpus. Returns true if found, false otherwise. The validator
// invokes this once per citation. The caller wires this against the real
// corpus_documents table at validation time, or against an in-memory map in
// tests. When omitted, corpus checks are skipped (schema-only validation).
export type CitationResolver = (source: CitationSource, canonicalId: string) => Promise<boolean>

export interface ValidationIssue {
  // Path within the playbook YAML, dot-joined for human reading.
  // e.g. "clauses[3].citations[0].id".
  path: string
  message: string
  // Severity. 'error' fails validation; 'warning' is informational.
  severity: 'error' | 'warning'
}

export type ValidationResult =
  | {
      valid: true
      playbook: Playbook
      // Warnings can be present on a valid result (e.g. status: draft).
      warnings: ValidationIssue[]
      corpusChecked: boolean
    }
  | {
      valid: false
      issues: ValidationIssue[]
      corpusChecked: boolean
    }

export interface ValidateOptions {
  resolveCitation?: CitationResolver
  // When true, status: draft is reported as a warning (not error) so CI
  // can pass while counsel review is pending. Default: true.
  allowDraft?: boolean
}

// Validate a parsed YAML object (already loaded). Useful for tests.
export async function validatePlaybook(
  raw: unknown,
  options: ValidateOptions = {},
): Promise<ValidationResult> {
  const allowDraft = options.allowDraft ?? true
  const corpusChecked = options.resolveCitation !== undefined
  const issues: ValidationIssue[] = []
  const warnings: ValidationIssue[] = []

  // Stage 1: schema parse.
  const parsed = playbookSchema.safeParse(raw)
  if (!parsed.success) {
    for (const e of parsed.error.errors) {
      issues.push({
        path: pathToString(e.path),
        message: e.message,
        severity: 'error',
      })
    }
    return { valid: false, issues, corpusChecked: false }
  }
  const playbook = parsed.data

  // Status: draft → warning (or error if draft not allowed).
  if (playbook.status === 'draft') {
    const issue: ValidationIssue = {
      path: 'status',
      message: 'playbook is in draft status (not yet counsel-validated). DEF-028 tracks production sign-off.',
      severity: allowDraft ? 'warning' : 'error',
    }
    ;(allowDraft ? warnings : issues).push(issue)
  }

  // Stage 2: critical-clause citation rule.
  for (let i = 0; i < playbook.clauses.length; i++) {
    const clause = playbook.clauses[i]!
    if (clause.importance !== 'critical') continue
    const hasCitableCitation = clause.citations.some((c) =>
      !NON_CORPUS_CITATION_SOURCES.has(c.source),
    )
    const hasAnyCitation = clause.citations.length > 0
    if (!hasAnyCitation) {
      issues.push({
        path: `clauses[${i}].citations`,
        message: `clause "${clause.id}" is critical and must have at least one citation`,
        severity: 'error',
      })
    } else if (!hasCitableCitation && corpusChecked) {
      // Soft warning when only market-norm/parasol-internal citations are
      // present on a critical clause. Acceptable but worth flagging.
      warnings.push({
        path: `clauses[${i}].citations`,
        message: `clause "${clause.id}" is critical but only references non-corpus sources (market-norm / parasol-internal)`,
        severity: 'warning',
      })
    }
  }

  // Stage 3: corpus resolution check (if a resolver was supplied).
  if (options.resolveCitation) {
    for (let i = 0; i < playbook.clauses.length; i++) {
      const clause = playbook.clauses[i]!
      for (let j = 0; j < clause.citations.length; j++) {
        const c = clause.citations[j]!
        if (NON_CORPUS_CITATION_SOURCES.has(c.source)) continue
        const ok = await options.resolveCitation(c.source, c.id)
        if (!ok) {
          issues.push({
            path: `clauses[${i}].citations[${j}].id`,
            message: `citation "${c.source}/${c.id}" did not resolve in corpus`,
            severity: 'error',
          })
        }
      }
    }
  }

  if (issues.length > 0) {
    return { valid: false, issues, corpusChecked }
  }
  return { valid: true, playbook, warnings, corpusChecked }
}

// Convenience: load + parse YAML from disk, then validate.
export async function validatePlaybookFile(
  path: string,
  options: ValidateOptions = {},
): Promise<ValidationResult> {
  let raw: unknown
  try {
    const text = await readFile(path, 'utf8')
    raw = parseYaml(text)
  } catch (cause) {
    return {
      valid: false,
      corpusChecked: false,
      issues: [
        {
          path: '',
          message: `failed to read or parse YAML at ${path}: ${(cause as Error).message}`,
          severity: 'error',
        },
      ],
    }
  }
  return validatePlaybook(raw, options)
}

function pathToString(path: (string | number)[]): string {
  let out = ''
  for (const seg of path) {
    if (typeof seg === 'number') out += `[${seg}]`
    else if (out === '') out = seg
    else out += '.' + seg
  }
  return out
}
