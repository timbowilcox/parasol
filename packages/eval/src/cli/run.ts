// CLI: pnpm --filter @parasol/eval run eval
//
// Runs the eval suite end-to-end against the golden NDA dataset and writes
// results JSON + prints a summary. Designed to be runnable on a developer
// machine (`pnpm eval`) and in CI (which runs the same command then checks
// the result with `eval:gate`).
//
// Sprint 1: pipeline defaults to `stub:oracle` because the production
// orchestrator only lands Day 9. Once that's wired, the default flips
// to `production`.
//
// Flags:
//   --pipeline=<stub-oracle|stub-noisy|production>
//   --sprint=<label>           Defaults to 'sprint-1'.
//   --no-corpus                Skip independent citation validity check
//                              (the pipeline's verify-citations stage is
//                              still trusted via output.validated flag).
//   --golden-dir=<path>        Override the golden dataset directory.

import { execSync } from 'node:child_process'
import { createClient } from '@supabase/supabase-js'
import type { Database } from '@parasol/core'
import { run, stubPipeline, type Pipeline } from '../runner'
import { writeJson, formatSummary, DEFAULT_RESULTS_DIR } from '../reporter'
import type { StubMode } from '../pipeline-stub'

interface CliFlags {
  pipeline: 'stub-oracle' | 'stub-noisy' | 'production'
  sprint: string
  noCorpus: boolean
  goldenDir?: string
}

function parseFlags(argv: string[]): CliFlags {
  const flags: CliFlags = {
    pipeline: 'stub-oracle',
    sprint: 'sprint-1',
    noCorpus: false,
  }
  for (const arg of argv) {
    if (arg === '--no-corpus') flags.noCorpus = true
    else if (arg.startsWith('--pipeline=')) {
      const v = arg.slice('--pipeline='.length)
      if (v === 'stub-oracle' || v === 'stub-noisy' || v === 'production') {
        flags.pipeline = v
      } else {
        process.stderr.write(`Unknown pipeline: ${v}\n`)
        process.exit(2)
      }
    } else if (arg.startsWith('--sprint=')) {
      flags.sprint = arg.slice('--sprint='.length) || 'sprint-1'
    } else if (arg.startsWith('--golden-dir=')) {
      flags.goldenDir = arg.slice('--golden-dir='.length)
    } else if (arg !== '--') {
      process.stderr.write(`Unknown flag: ${arg}\n`)
      process.exit(2)
    }
  }
  return flags
}

function selectPipeline(flag: CliFlags['pipeline']): { pipeline: Pipeline; label: 'stub' | 'production' } {
  if (flag === 'production') {
    // Day 9+. Until the real orchestrator lands, refuse explicitly so a
    // misconfigured CI gate doesn't silently pass under stub conditions.
    throw new Error('production pipeline not yet wired (lands Sprint 1 day 9). Use --pipeline=stub-oracle until then.')
  }
  const mode: StubMode = flag === 'stub-noisy' ? 'noisy' : 'oracle'
  return { pipeline: stubPipeline(mode), label: 'stub' }
}

function buildCorpusResolver(): ((source: string, id: string) => Promise<boolean>) | undefined {
  const url = process.env['NEXT_PUBLIC_SUPABASE_URL']
  const serviceKey = process.env['SUPABASE_SERVICE_ROLE_KEY']
  if (!url || !serviceKey) return undefined
  const supabase = createClient<Database>(url, serviceKey, {
    auth: { persistSession: false },
  })
  const sourceMap: Record<string, string> = {
    'kenya-statute': 'statute',
    'kenya-case': 'case',
    'kenya-regulation': 'regulation',
    'odpc-determination': 'odpc_determination',
    'kra-ruling': 'kra_ruling',
    'cbk-circular': 'cbk_circular',
    'cma-notice': 'cma_notice',
  }
  return async (source, canonicalId) => {
    const dbSourceType = sourceMap[source]
    if (!dbSourceType) return false
    const { data, error } = await supabase
      .from('corpus_documents')
      .select('id')
      .eq('jurisdiction', 'kenya')
      .eq('source_type', dbSourceType)
      .eq('canonical_id', canonicalId)
      .is('superseded_at', null)
      .limit(1)
    if (error) {
      process.stderr.write(`corpus resolve failed for ${source}/${canonicalId}: ${error.message}\n`)
      return false
    }
    return (data?.length ?? 0) > 0
  }
}

function gitSha(): string | undefined {
  try {
    return execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim()
  } catch {
    return undefined
  }
}

async function main(): Promise<void> {
  const flags = parseFlags(process.argv.slice(2))
  const { pipeline, label } = selectPipeline(flags.pipeline)
  const resolveCitation = flags.noCorpus ? undefined : buildCorpusResolver()
  const corpusMessage = resolveCitation
    ? 'corpus resolver active'
    : 'corpus resolver SKIPPED (no env or --no-corpus)'

  process.stdout.write(`pipeline: ${flags.pipeline} · ${corpusMessage}\n\n`)

  const result = await run({
    pipeline,
    pipelineLabel: label,
    sprint: flags.sprint,
    goldenDir: flags.goldenDir,
    models: {
      haiku: process.env['ANTHROPIC_MODEL_HAIKU'],
      sonnet: process.env['ANTHROPIC_MODEL_SONNET'],
      opus: process.env['ANTHROPIC_MODEL_OPUS'],
    },
    resolveCitation,
    gitSha: gitSha(),
    onProgress: (e) => {
      process.stdout.write(`  [${e.index + 1}/${e.total}] ${e.filename}\n`)
    },
  })

  const path = await writeJson(result, DEFAULT_RESULTS_DIR)
  process.stdout.write(formatSummary(result) + '\n')
  process.stdout.write(`\nresults written to: ${path}\n`)
  process.exit(0)
}

main().catch((err) => {
  process.stderr.write(`fatal: ${(err as Error).stack ?? (err as Error).message}\n`)
  process.exit(1)
})
