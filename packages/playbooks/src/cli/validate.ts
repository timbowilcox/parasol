// CLI: pnpm --filter @parasol/playbooks run validate
//
// Validates every shipped playbook against the schema and (when env permits)
// the corpus. Exits 0 on clean validation, 1 on any error issues, 0-with-
// warnings printed if only warnings are present.
//
// Usage:
//   pnpm --filter @parasol/playbooks run validate
//   pnpm --filter @parasol/playbooks run validate -- --strict
//
// Flags:
//   --strict   Treat warnings as errors (CI gate for v1 launch).
//   --no-corpus  Skip corpus resolution checks even if env supports them.

import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'
import type { Database } from '@parasol/core'
import { validatePlaybookFile, type CitationResolver, type ValidationIssue } from '../validator.js'
import { SHIPPED_PLAYBOOKS } from '../loader.js'

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')

interface CliFlags {
  strict: boolean
  noCorpus: boolean
}

function parseFlags(argv: string[]): CliFlags {
  const flags: CliFlags = { strict: false, noCorpus: false }
  for (const arg of argv) {
    if (arg === '--strict') flags.strict = true
    else if (arg === '--no-corpus') flags.noCorpus = true
    else if (arg !== '--') {
      process.stderr.write(`Unknown flag: ${arg}\n`)
      process.exit(2)
    }
  }
  return flags
}

function buildCorpusResolver(): CitationResolver | undefined {
  const url = process.env['NEXT_PUBLIC_SUPABASE_URL']
  const serviceKey = process.env['SUPABASE_SERVICE_ROLE_KEY']
  if (!url || !serviceKey) return undefined

  const supabase = createClient<Database>(url, serviceKey, {
    auth: { persistSession: false },
  })

  // Maps citation source → corpus_documents.source_type. We expand the
  // mapping over time; for Sprint 1 we recognise statutes and cases.
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

function formatIssue(file: string, issue: ValidationIssue): string {
  const tag = issue.severity === 'error' ? 'ERROR' : 'WARN '
  const path = issue.path ? ` ${issue.path}` : ''
  return `  [${tag}] ${file}:${path} ${issue.message}`
}

async function main(): Promise<void> {
  const flags = parseFlags(process.argv.slice(2))
  const resolver = flags.noCorpus ? undefined : buildCorpusResolver()
  const corpusMessage = resolver
    ? 'corpus resolver active'
    : 'corpus resolver SKIPPED (no env or --no-corpus); schema-only validation'
  process.stdout.write(`${corpusMessage}\n\n`)

  let totalErrors = 0
  let totalWarnings = 0

  for (const { jurisdiction, contractType } of SHIPPED_PLAYBOOKS) {
    const path = resolve(PACKAGE_ROOT, jurisdiction, `${contractType}.yaml`)
    const file = `${jurisdiction}/${contractType}.yaml`
    process.stdout.write(`Validating ${file}\n`)
    const result = await validatePlaybookFile(path, {
      resolveCitation: resolver,
      allowDraft: !flags.strict,
    })
    if (!result.valid) {
      for (const issue of result.issues) {
        process.stdout.write(formatIssue(file, issue) + '\n')
        if (issue.severity === 'error') totalErrors++
        else totalWarnings++
      }
    } else {
      for (const issue of result.warnings) {
        process.stdout.write(formatIssue(file, issue) + '\n')
        totalWarnings++
      }
      process.stdout.write(`  ok (${result.playbook.clauses.length} clauses, ` +
        `${result.corpusChecked ? 'corpus-checked' : 'schema-only'}, ` +
        `status=${result.playbook.status})\n`)
    }
  }

  process.stdout.write(`\nSummary: ${totalErrors} errors, ${totalWarnings} warnings\n`)
  if (totalErrors > 0) process.exit(1)
  if (flags.strict && totalWarnings > 0) process.exit(1)
  process.exit(0)
}

main().catch((err) => {
  process.stderr.write(`fatal: ${(err as Error).stack ?? (err as Error).message}\n`)
  process.exit(1)
})
