import { describe, it, expect } from 'vitest'
import { serialisePlaybookForContext } from './serialise.js'
import type { Playbook } from './schema.js'

const minimalPlaybook: Playbook = {
  schema_version: '1.0',
  jurisdiction: 'kenya',
  contract_type: 'nda',
  display_name: 'Non-Disclosure Agreement',
  description: 'Mutual or one-way NDA',
  applicable_industries: ['all'],
  authored_by: 'Test author',
  reviewed_at: null,
  status: 'draft',
  language: 'en',
  last_updated: '2026-05-04',
  clauses: [
    {
      id: 'governing_law',
      display_name: 'Governing law',
      aliases: ['choice of law'],
      importance: 'critical',
      standard: { position: 'Laws of Kenya.', rationale: 'Default for Kenyan-counterparty agreements.' },
      fallback: { position: 'Laws of England and Wales.', rationale: 'Acceptable for international counterparties.' },
      hard_limit: { position: 'Kenya / UK / Singapore / Mauritius / NY.', rationale: 'Predictable enforcement.' },
      citations: [
        { source: 'market-norm', id: 'parasol-internal-2026q1', note: 'Hard-limit set reflects enforceability research.' },
      ],
    },
  ],
}

describe('serialisePlaybookForContext', () => {
  it('emits the playbook display name + jurisdiction + contract type', () => {
    const out = serialisePlaybookForContext(minimalPlaybook)
    expect(out).toContain('# Playbook — Non-Disclosure Agreement')
    expect(out).toContain('Jurisdiction: kenya')
    expect(out).toContain('Contract type: nda')
  })

  it('flags draft status with a counsel-review warning the model will see', () => {
    const out = serialisePlaybookForContext(minimalPlaybook)
    expect(out).toContain('Status: draft')
    expect(out).toContain('WARNING')
    expect(out).toContain('counsel review')
  })

  it('does NOT emit the warning for production playbooks', () => {
    const out = serialisePlaybookForContext({
      ...minimalPlaybook,
      status: 'production',
      reviewed_at: '2026-04-15',
    })
    expect(out).toContain('Status: production')
    expect(out).not.toContain('WARNING')
  })

  it('emits each clause with id, importance, all three positions + rationale', () => {
    const out = serialisePlaybookForContext(minimalPlaybook)
    expect(out).toContain('## Clause: governing_law')
    expect(out).toContain('Importance: critical')
    expect(out).toContain('### Standard position')
    expect(out).toContain('Laws of Kenya.')
    expect(out).toContain('### Fallback position')
    expect(out).toContain('Laws of England and Wales.')
    expect(out).toContain('### Hard limit')
    expect(out).toContain('Predictable enforcement.')
  })

  it('emits citations when present', () => {
    const out = serialisePlaybookForContext(minimalPlaybook)
    expect(out).toContain('### Citations')
    expect(out).toContain('market-norm/parasol-internal-2026q1')
    expect(out).toContain('Hard-limit set reflects')
  })

  it('omits Citations section when clause has no citations', () => {
    const out = serialisePlaybookForContext({
      ...minimalPlaybook,
      clauses: [{ ...minimalPlaybook.clauses[0]!, citations: [] }],
    })
    expect(out).not.toContain('### Citations')
  })

  it('emits aliases line when present', () => {
    const out = serialisePlaybookForContext(minimalPlaybook)
    expect(out).toContain('Aliases: choice of law')
  })

  it('omits aliases line when clause has no aliases', () => {
    const out = serialisePlaybookForContext({
      ...minimalPlaybook,
      clauses: [{ ...minimalPlaybook.clauses[0]!, aliases: [] }],
    })
    expect(out).not.toContain('Aliases:')
  })
})
