# Golden NDA dataset

20 publicly-sourced NDAs used by the eval harness as the Sprint 1 ground truth.
Manifest of provenance per file: [manifest.yaml](./manifest.yaml).

The actual `.pdf` / `.docx` files are gitignored (`.gitignore` rules at
`packages/eval/data/golden/**/*.{pdf,docx}`). Sourced via the agent at the
start of Sprint 1 — see HANDOFF Day 3 for sources (mostly SEC EDGAR M&A
exhibits, gov.uk templates, Common Paper, plus 2 Kenya-jurisdiction).

## Annotation files

Each NDA we want the eval harness to score has a sibling `.annotation.yaml`
file in this directory. Filename pattern: `<nda-filename>.annotation.yaml`,
e.g. `nda-001.pdf.annotation.yaml`.

The annotation captures what a counsel-validated reviewer would *expect* the
Parasol pipeline to flag. The runner pairs every annotation with its NDA,
runs the pipeline, and computes precision / recall / citation validity /
hallucination rate by comparing actual output to the annotation.

### Schema

Validated by `groundTruthSchema` in `packages/eval/src/schema.ts`.

```yaml
filename: nda-001.pdf
annotated_at: 2026-05-04
annotated_by: "parasol-internal-draft"   # status:draft analogue per DEF-028
notes: "Free-form context for reviewers."
expected_issues:
  - clause_id: governing_law
    severity: critical
    description: "Governs by Delaware law; hard-limit allowed jurisdictions are KE/UK/SG/MU/NY only."
    required: true
    expected_confidence: high
expected_citations:
  - source: kenya-statute
    id: "2019/24"
    section: "s.49"
```

### Required vs optional fields

| Field | Required | Notes |
|-------|----------|-------|
| `filename` | yes | must match a real file in this directory |
| `annotated_at` | yes | YYYY-MM-DD |
| `annotated_by` | yes | "parasol-internal-draft" until counsel review (DEF-028) |
| `notes` | no | free-form |
| `expected_issues[]` | yes | at least one entry; metrics need something to score |
| `expected_issues[].clause_id` | yes | matches a clause id in `packages/playbooks/<j>/<c>.yaml` |
| `expected_issues[].severity` | yes | `critical` \| `material` \| `minor` |
| `expected_issues[].description` | yes | reviewer-facing explanation |
| `expected_issues[].required` | no | defaults to true for critical |
| `expected_issues[].expected_confidence` | no | enforced as confidence-calibration penalty |
| `expected_citations[]` | no | citations the pipeline output should include for this NDA |

### Annotation status

Sprint 1 annotations are **internal drafts** authored by Claude Code, not
counsel-validated. Same `status: draft` pattern as the playbook itself
(DEF-028). Day 13 runs the production pipeline against this set; counsel
review of the annotations is a v1-launch gate. Until then, the harness
infrastructure works and metrics are well-defined; the absolute scores
are best read as relative — useful for catching regressions, not yet
benchmarks against the real-world bar.

### How to add a new annotation

1. Drop the NDA file in this directory and update `manifest.yaml`.
2. Create `<filename>.annotation.yaml` matching the schema above.
3. Run `pnpm eval --pipeline=stub-oracle` — should produce F1=1.0 and pass
   the acceptance bar. If not, the schema is malformed.
4. Optionally run `pnpm eval --pipeline=stub-noisy` — should produce a
   non-trivial failure pattern; verifies metrics are penalising correctly.
