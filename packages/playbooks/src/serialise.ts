// Render a Playbook into a system-prompt-ready string for the AI pipeline.
//
// Used by the orchestrator: between extract-clauses and compare-playbook,
// load the playbook via loadPlaybook(jurisdiction, contractType), serialise
// it via serialisePlaybookForContext, and set the result as
// OrchestratorContext.playbookContext (cached in the system prefix for
// ~5 minutes per Anthropic prompt cache TTL).
//
// Format choices:
// - Markdown headers per clause for legibility (the model reads it well).
// - Each clause emits id, display name, importance, all three positions
//   (standard / fallback / hard_limit) with rationale, and citations.
// - Status banner at the top so the model knows whether the playbook is
//   draft (counsel review pending — DEF-028 path) or production.

import type { Playbook } from './schema.js'

export function serialisePlaybookForContext(playbook: Playbook): string {
  const lines: string[] = []

  // Header
  lines.push(`# Playbook — ${playbook.display_name}`)
  lines.push('')
  lines.push(`Jurisdiction: ${playbook.jurisdiction}`)
  lines.push(`Contract type: ${playbook.contract_type}`)
  lines.push(`Status: ${playbook.status}`)
  if (playbook.status === 'draft') {
    lines.push('')
    lines.push(
      '> WARNING: this playbook is in DRAFT status. Positions and citations '
        + 'are pending counsel review. Surface this caveat to the user via '
        + 'confidence calibration (medium for clauses where the playbook is '
        + 'the only authority).',
    )
  }
  lines.push('')
  lines.push(`Description: ${playbook.description}`)
  lines.push(`Last updated: ${playbook.last_updated}`)
  lines.push('')
  lines.push('---')
  lines.push('')

  // Clauses
  for (const clause of playbook.clauses) {
    lines.push(`## Clause: ${clause.id}`)
    lines.push('')
    lines.push(`Display name: ${clause.display_name}`)
    lines.push(`Importance: ${clause.importance}`)
    if (clause.aliases && clause.aliases.length > 0) {
      lines.push(`Aliases: ${clause.aliases.join(', ')}`)
    }
    if (clause.applicable_when) {
      lines.push(`Applicable when: ${clause.applicable_when}`)
    }
    lines.push('')

    lines.push('### Standard position')
    lines.push(clause.standard.position)
    lines.push('')
    lines.push(`Rationale: ${clause.standard.rationale}`)
    lines.push('')

    lines.push('### Fallback position')
    lines.push(clause.fallback.position)
    lines.push('')
    lines.push(`Rationale: ${clause.fallback.rationale}`)
    lines.push('')

    lines.push('### Hard limit')
    lines.push(clause.hard_limit.position)
    lines.push('')
    lines.push(`Rationale: ${clause.hard_limit.rationale}`)
    lines.push('')

    if (clause.citations.length > 0) {
      lines.push('### Citations')
      for (const c of clause.citations) {
        const sec = c.section ? ` ${c.section}` : ''
        const note = c.note ? ` — ${c.note}` : ''
        lines.push(`- ${c.source}/${c.id}${sec}${note}`)
      }
      lines.push('')
    }

    lines.push('---')
    lines.push('')
  }

  return lines.join('\n')
}
