// Playbook loader.
//
// Resolves (jurisdiction, contract_type) → typed Playbook from the on-disk
// YAML files at packages/playbooks/<jurisdiction>/<contract_type>.yaml.
//
// The loader is the single entry point used by the orchestrator at runtime.
// It validates with schema-only (no corpus check) for speed; full validation
// happens at CI time via `pnpm playbooks:validate`.

import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { validatePlaybookFile } from './validator'
import type { Playbook } from './schema'
import type { Jurisdiction, ContractType } from '@parasol/core'
import { NotFoundError, ValidationError } from '@parasol/core'

// Repo-root-relative root for playbook YAMLs. We compute it from the loader
// file's own URL so it works whether @parasol/playbooks is consumed by a Next
// app, the corpus CLI, or a vitest worker.
const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

export interface LoadPlaybookOptions {
  // Override the playbook root directory (used by tests).
  rootDir?: string
}

export async function loadPlaybook(
  jurisdiction: Jurisdiction,
  contractType: ContractType,
  options: LoadPlaybookOptions = {},
): Promise<Playbook> {
  const root = options.rootDir ?? PACKAGE_ROOT
  const path = resolve(root, jurisdiction, `${contractType}.yaml`)
  const result = await validatePlaybookFile(path)
  if (!result.valid) {
    // If the file simply doesn't exist on disk we want a NotFoundError so
    // callers can distinguish "we don't ship a playbook for this combo" from
    // "we ship one but it's malformed".
    const notFound = result.issues.find(
      (i) => i.message.startsWith('failed to read or parse YAML') && i.message.includes('ENOENT'),
    )
    if (notFound) {
      throw new NotFoundError(
        `playbook for ${jurisdiction}/${contractType}`,
        path,
      )
    }
    const summary = result.issues.map((i) => `${i.path}: ${i.message}`).join('; ')
    throw new ValidationError(
      `playbook ${jurisdiction}/${contractType} failed validation: ${summary}`,
      `${jurisdiction}/${contractType}`,
    )
  }
  return result.playbook
}

// List the (jurisdiction, contract_type) pairs we ship playbooks for.
// Hard-coded for Sprint 1 (only kenya/nda); will be filesystem-walked once
// we ship more than one combination.
export const SHIPPED_PLAYBOOKS: ReadonlyArray<{
  jurisdiction: Jurisdiction
  contractType: ContractType
}> = [
  { jurisdiction: 'kenya', contractType: 'nda' },
]
