// CLI: pnpm --filter @parasol/eval run eval:gate
//
// Reads the most recent eval result JSON and exits non-zero if the
// aggregate fails the Sprint 1 acceptance bar. Intended for CI:
//   1. `pnpm eval`              produces packages/eval/results/<sprint>.json
//   2. `pnpm eval:gate`         exits 0 (pass) or 1 (fail with reasons)
//
// Sprint 1 acceptance bar (defined in types.ts):
//   - clause F1                 ≥ 0.85
//   - citation validity         = 1.0
//   - hallucination rate        ≤ 0.02
//   - redline appropriateness   ≥ 0.80 (only enforced if rated subset present)

import { readFile } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { EvalRunResult } from '../types.js'
import { SPRINT_1_ACCEPTANCE_BAR } from '../types.js'
import { checkAcceptanceBar } from '../metrics.js'

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const DEFAULT_RESULTS_DIR = resolve(PACKAGE_ROOT, 'results')

interface CliFlags {
  sprint: string
  resultsDir: string
}

function parseFlags(argv: string[]): CliFlags {
  const flags: CliFlags = {
    sprint: 'sprint-1',
    resultsDir: DEFAULT_RESULTS_DIR,
  }
  for (const arg of argv) {
    if (arg.startsWith('--sprint=')) {
      flags.sprint = arg.slice('--sprint='.length) || 'sprint-1'
    } else if (arg.startsWith('--results-dir=')) {
      flags.resultsDir = arg.slice('--results-dir='.length)
    } else if (arg !== '--') {
      process.stderr.write(`Unknown flag: ${arg}\n`)
      process.exit(2)
    }
  }
  return flags
}

async function main(): Promise<void> {
  const flags = parseFlags(process.argv.slice(2))
  const path = resolve(flags.resultsDir, `${flags.sprint}.json`)
  let result: EvalRunResult
  try {
    const text = await readFile(path, 'utf8')
    result = JSON.parse(text)
  } catch (cause) {
    process.stderr.write(
      `failed to load eval results at ${path}: ${(cause as Error).message}\n`
      + `Did you run \`pnpm eval\` first?\n`,
    )
    process.exit(2)
  }

  const check = checkAcceptanceBar(result.aggregate, SPRINT_1_ACCEPTANCE_BAR)
  if (!check.passed) {
    process.stderr.write(`eval gate FAILED for ${flags.sprint}:\n`)
    for (const f of check.failures) process.stderr.write(`  · ${f}\n`)
    process.stderr.write('\n')
    process.exit(1)
  }
  process.stdout.write(`eval gate PASS for ${flags.sprint}\n`)
  process.exit(0)
}

main().catch((err) => {
  process.stderr.write(`fatal: ${(err as Error).stack ?? (err as Error).message}\n`)
  process.exit(1)
})
