# @parasol/playbooks

Versioned playbooks (YAML) defining Parasol's standard positions on contract clauses, plus the loader, validator, and CLI to keep them honest.

Schema reference: `docs/playbook-schema.md`. Authoring conventions per the agent harness — playbooks are code, reviewed in PRs, paired with eval cases.

## Structure

```
src/
├── index.ts          # Loader + validator API
├── loader.ts         # YAML → typed Playbook object
├── schema.ts         # Zod schema (mirrors docs/playbook-schema.md)
├── cli/
│   └── validate.ts   # `pnpm validate` — validates every playbook in this package
└── types.ts          # Playbook, Clause, Position, Rationale types

kenya/
├── nda.yaml          # Sprint 1 ships this only
├── dpa.yaml          # Sprint 2
├── msa.yaml          # Sprint 2
└── saas.yaml         # Sprint 2
```

## Playbook structure

Every playbook declares, per clause:
- `clause_id` — stable identifier (`nda.confidentiality_term`, `nda.permitted_disclosures`)
- `position` — Parasol's standard position (the wording or the substantive ask)
- `severity_if_missing` — low / medium / high / critical
- `severity_if_deviated` — by deviation type
- `rationale` — why this position; cited
- `authority` — citations supporting the position (Acts, cases, market norms)
- `kenyan_idioms` — local conventions worth preserving (counterpart language, jurisdiction = Kenya, dispute resolution to Nairobi)
- `red_flags` — patterns that always escalate severity
- `acceptable_alternatives` — positions to accept without flagging
- `negotiation_fallback` — order in which to give ground

## Authoring discipline

- **Lawyer-reviewed before merge.** No playbook ships without sign-off from Kenyan-qualified counsel (DEF-028 for NDA Sprint 1).
- **Eval cases paired.** Every playbook clause has at least one golden eval case exercising it.
- **Versioned.** Semver per playbook. Bumped on any substantive position change. Old version stays accessible for deal-archive reviews.
- **Citations resolve.** CLI validator checks every cited authority resolves to a corpus source.
- **No dead clauses.** CLI validator checks every `clause_id` referenced by a playbook is defined and vice versa.

## CLI

```bash
pnpm --filter @parasol/playbooks validate
```

Run before every PR that touches a playbook. CI runs this too.
