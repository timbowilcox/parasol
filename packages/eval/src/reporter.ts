// Eval reporter.
//
// Two outputs:
//   1. JSON to packages/eval/results/<sprint>.json — machine-readable, used
//      by CI gate and any future trend-tracking dashboards
//   2. Pretty-printed summary table to stdout — human-readable, used by
//      `pnpm eval` runs and the GitHub Actions log

import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { EvalRunResult, AggregateScore, PerNdaScore } from './types.js'
import { checkAcceptanceBar } from './metrics.js'
import { SPRINT_1_ACCEPTANCE_BAR } from './types.js'

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
export const DEFAULT_RESULTS_DIR = resolve(PACKAGE_ROOT, 'results')

// ─── JSON output ─────────────────────────────────────────────────────────────

export async function writeJson(
  result: EvalRunResult,
  resultsDir = DEFAULT_RESULTS_DIR,
): Promise<string> {
  await mkdir(resultsDir, { recursive: true })
  const path = resolve(resultsDir, `${result.sprint}.json`)
  await writeFile(path, JSON.stringify(result, null, 2) + '\n', 'utf8')
  return path
}

// ─── Stdout summary ─────────────────────────────────────────────────────────

export function formatSummary(result: EvalRunResult): string {
  const lines: string[] = []
  lines.push('')
  lines.push('═'.repeat(70))
  lines.push(`Eval run · ${result.sprint} · pipeline: ${result.pipeline}`)
  lines.push(`ran_at  : ${result.ran_at}`)
  if (result.git_sha) lines.push(`git_sha : ${result.git_sha}`)
  if (Object.keys(result.models).length > 0) {
    lines.push(`models  : ${formatModels(result.models)}`)
  }
  lines.push('═'.repeat(70))

  // Per-NDA table
  lines.push('')
  lines.push('Per-NDA scores:')
  lines.push('─'.repeat(70))
  lines.push(`  ${pad('filename', 18)}  ${pad('F1', 6)}  ${pad('Prec', 6)}  ${pad('Rec', 6)}  ${pad('CitVal', 7)}  ${pad('Halluc', 7)}`)
  for (const s of result.per_nda) {
    lines.push(`  ${pad(s.filename, 18)}  ${fmt(s.clause_identification_f1)}  ${fmt(s.clause_identification_precision)}  ${fmt(s.clause_identification_recall)}  ${fmt(s.citation_validity_rate, 7)}  ${fmt(s.hallucination_rate, 7)}`)
  }
  lines.push('─'.repeat(70))

  // Aggregate row
  const a = result.aggregate
  lines.push(`  ${pad('AGGREGATE', 18)}  ${fmt(a.clause_identification_f1)}  ${fmt(a.clause_identification_precision)}  ${fmt(a.clause_identification_recall)}  ${fmt(a.citation_validity_rate, 7)}  ${fmt(a.hallucination_rate, 7)}`)
  if (typeof a.redline_appropriateness === 'number') {
    lines.push(`  redline appropriateness (rated subset = ${a.rated_subset_size}): ${a.redline_appropriateness.toFixed(2)} / 5`)
  }

  // Acceptance bar
  lines.push('')
  const check = checkAcceptanceBar(a, SPRINT_1_ACCEPTANCE_BAR)
  if (check.passed) {
    lines.push('Acceptance bar: PASS')
  } else {
    lines.push('Acceptance bar: FAIL')
    for (const reason of check.failures) lines.push(`  · ${reason}`)
  }
  lines.push('')

  // Per-NDA diagnostics — only when there are misses
  const withMisses = result.per_nda.filter((s) =>
    s.diagnostics.missed_issues.length > 0
    || s.diagnostics.extra_issues.length > 0
    || s.diagnostics.invalid_citations.length > 0,
  )
  if (withMisses.length > 0) {
    lines.push('Diagnostics (cases with miss / extra / invalid citation):')
    for (const s of withMisses) {
      lines.push(`  ${s.filename}:`)
      if (s.diagnostics.missed_issues.length > 0) {
        const fmtted = s.diagnostics.missed_issues.map((m) => `${m.clause_id}/${m.severity}`).join(', ')
        lines.push(`    missed   : ${fmtted}`)
      }
      if (s.diagnostics.extra_issues.length > 0) {
        const fmtted = s.diagnostics.extra_issues.map((m) => `${m.clause_id}/${m.severity}`).join(', ')
        lines.push(`    extra    : ${fmtted}`)
      }
      if (s.diagnostics.invalid_citations.length > 0) {
        const fmtted = s.diagnostics.invalid_citations.map((c) => `${c.source}/${c.id}`).join(', ')
        lines.push(`    invalid  : ${fmtted}`)
      }
    }
  }

  return lines.join('\n')
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmt(n: number, width = 6): string {
  return pad(n.toFixed(3), width)
}

function pad(s: string, width: number): string {
  return s.length >= width ? s : s + ' '.repeat(width - s.length)
}

function formatModels(m: { haiku?: string; sonnet?: string; opus?: string }): string {
  return Object.entries(m)
    .filter(([, v]) => v)
    .map(([k, v]) => `${k}=${v}`)
    .join(', ')
}

// Re-export for the CLI to share the same constant.
export { SPRINT_1_ACCEPTANCE_BAR }
export { type AggregateScore, type PerNdaScore }
