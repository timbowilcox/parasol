// CLI: pnpm corpus:ingest:kenya
//
// Runs the Kenya Law scraper end-to-end against the dev Supabase project.
// Reads DATABASE_URL or NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
// from .env.local. Service role is required because corpus_documents and
// corpus_chunks have RLS gated to authenticated users for read; writes go
// through service role from this admin script.
//
// Usage:
//   pnpm --filter @parasol/corpus run ingest:kenya
//   pnpm --filter @parasol/corpus run ingest:kenya -- --limit=1
//   pnpm --filter @parasol/corpus run ingest:kenya -- --skip-embedding --skip-tagging

import { createClient } from '@supabase/supabase-js'
import type { Database } from '@parasol/core'
import { CorpusRepository } from '../repository.js'
import { KenyaLawScraper } from '../scrapers/kenyalaw.js'
import { ingestSource } from '../ingest.js'

interface CliFlags {
  limit?: number
  skipEmbedding: boolean
  skipTagging: boolean
  skipUnchanged: boolean
}

function parseFlags(argv: string[]): CliFlags {
  const flags: CliFlags = {
    skipEmbedding: false,
    skipTagging: false,
    skipUnchanged: false,
  }
  for (const arg of argv) {
    if (arg === '--skip-embedding') flags.skipEmbedding = true
    else if (arg === '--skip-tagging') flags.skipTagging = true
    else if (arg === '--skip-unchanged') flags.skipUnchanged = true
    else if (arg.startsWith('--limit=')) {
      const n = Number(arg.slice('--limit='.length))
      if (!Number.isFinite(n) || n <= 0) {
        process.stderr.write(`Invalid --limit value: ${arg}\n`)
        process.exit(2)
      }
      flags.limit = n
    } else if (arg !== '--') {
      process.stderr.write(`Unknown flag: ${arg}\n`)
      process.exit(2)
    }
  }
  return flags
}

async function main(): Promise<void> {
  const flags = parseFlags(process.argv.slice(2))

  const url = process.env['NEXT_PUBLIC_SUPABASE_URL']
  const serviceKey = process.env['SUPABASE_SERVICE_ROLE_KEY']
  if (!url || !serviceKey) {
    process.stderr.write(
      'NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env.local\n',
    )
    process.exit(1)
  }

  const supabase = createClient<Database>(url, serviceKey, {
    auth: { persistSession: false },
  })
  const repo = new CorpusRepository(supabase)
  const scraper = new KenyaLawScraper()

  const startMessage = [
    `Ingesting from ${scraper.slug}`,
    flags.limit ? `(limit=${flags.limit})` : '',
    flags.skipEmbedding ? '[skip-embedding]' : '',
    flags.skipTagging ? '[skip-tagging]' : '',
    flags.skipUnchanged ? '[skip-unchanged]' : '',
  ].filter(Boolean).join(' ')
  process.stdout.write(`${startMessage}\n`)

  const result = await ingestSource({
    scraper,
    repository: repo,
    limit: flags.limit,
    skipEmbedding: flags.skipEmbedding,
    skipTagging: flags.skipTagging,
    skipUnchanged: flags.skipUnchanged,
    onProgress: (event) => {
      switch (event.type) {
        case 'run_started':
          process.stdout.write(`run started: ${event.runId}\n`)
          break
        case 'document_started':
          process.stdout.write(`  fetching ${event.canonicalId}...\n`)
          break
        case 'document_completed': {
          const r = event.result
          const tag = r.outcome.padEnd(8)
          const extra = r.chunkCount !== undefined ? ` (${r.chunkCount} chunks)` : ''
          const reason = r.reason ? ` — ${r.reason}` : ''
          process.stdout.write(
            `  [${tag}] ${r.canonicalId}${extra}${reason} (${r.durationMs}ms)\n`,
          )
          break
        }
        case 'run_completed':
          process.stdout.write(
            `\nrun complete: ${event.result.documentsAdded} added, ${event.result.documentsUpdated} updated, ${event.result.errors.length} errors\n`,
          )
          break
      }
    },
  })

  if (result.errors.length > 0) {
    process.stderr.write('\nErrors:\n')
    for (const e of result.errors) {
      process.stderr.write(`  ${e.canonicalId}: ${e.message}\n`)
    }
    process.exit(1)
  }
  process.exit(0)
}

main().catch((err) => {
  process.stderr.write(`fatal: ${(err as Error).stack ?? (err as Error).message}\n`)
  process.exit(1)
})
