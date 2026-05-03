# Playbook Schema

Playbooks are the proprietary IP and the actual product moat. This document defines the YAML schema, validation rules, and authoring conventions.

## File location

```
packages/playbooks/<jurisdiction>/<contract-type>.yaml
```

Where:
- `<jurisdiction>` is one of: `kenya`, `uganda`, `tanzania`, `rwanda`
- `<contract-type>` is one of: `nda`, `dpa`, `msa`, `saas`, `employment`, `lease`, `distribution` (v1 covers nda, dpa, msa, saas only)

## Top-level structure

```yaml
schema_version: "1.0"
jurisdiction: kenya
contract_type: nda
display_name: "Non-Disclosure Agreement"
description: "Mutual or one-way NDA, typical commercial confidentiality."
applicable_industries: [all]
authored_by: "Consulting counsel name + firm"
reviewed_at: "2026-04-15"
language: en
last_updated: "2026-04-15"

clauses:
  - id: confidentiality_term
    display_name: "Term of confidentiality"
    aliases: ["term", "duration of obligation", "period of confidentiality"]
    importance: critical    # critical | material | minor
    standard:
      position: "Confidentiality obligations survive for three years from disclosure."
      rationale: "Aligns with Kenya commercial market norm."
    fallback:
      position: "Two years from disclosure."
      rationale: "Acceptable where counterparty insists; below this, recommend escalation."
    hard_limit:
      position: "One year from disclosure or perpetual for trade secrets only."
      rationale: "Below 1 year, the obligation is commercially meaningless."
    citations:
      - source: kenya-statute
        id: "trade-secrets"
        section: "Various"
        note: "Kenya does not have a codified trade secrets statute; protection is contractual."
      - source: market-norm
        id: "parasol-internal-2026q1"
        note: "Internal review of 200+ Kenya NDAs Q1 2026."
```

## Clause object schema

Every clause has: id (snake_case stable identifier), display_name (sentence case), importance (critical | material | minor), standard / fallback / hard_limit positions, citations array. Optional: aliases, applicable_when, related_clauses, notes, example_acceptable_language, example_unacceptable_language.

Citations are structured: `{ source, id, section?, note? }`. Source is one of `kenya-statute | kenya-case | kenya-regulation | odpc-determination | kra-ruling | cbk-circular | cma-notice | eac-treaty | market-norm | parasol-internal`.

## Validation

Schema enforced via Zod at build time. `pnpm playbooks:validate` runs the validator across all playbooks and fails CI on any non-conformance.

Specific validations:
- Every `id` must be unique within a contract type
- Every `citations[].id` must resolve to a corpus document at validation time (or be tagged as `market-norm` / `parasol-internal`)
- `importance: critical` clauses must have at least one citation that resolves in corpus
- All three positions (standard, fallback, hard_limit) must be present and non-empty
- `display_name` must be sentence case (validator enforces)
- Hard limits must be more permissive than fallback, which must be more permissive than standard

## Authoring conventions

Sentence case everywhere. Cite or don't claim. Be specific. Explain rationale. Use plain Kenyan English. Conservative on hard limits — the hard limit triggers an automatic critical-severity flag.

## Workspace overrides

Customers customise default playbooks at the workspace level. Overrides stored in Postgres `playbook_overrides` table. At runtime, the orchestrator merges base playbook + workspace overrides before applying. Overrides UI (v1.5 per DEF-029) lets lawyers fork a default position, edit, test against sample contracts, and save.

## Per-industry variants (v2)

A workspace selects an industry on signup. Playbooks may have industry-specific variants per DEF-032. v1 ships with no industry variants.

## Versioning

Playbooks are versioned. Every change increments `last_updated` and creates a new row in `playbook_versions`. Customers on annual contracts can pin to a specific version.

## Sample playbook

See `packages/playbooks/kenya/nda.yaml` for a complete worked example. Note: the sample is structural — final lawyer review and revision required per DEF-028 before treating as production playbook.
