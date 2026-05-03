# Parasol Evaluation Methodology

Every change to playbooks, prompts, retrieval logic, model routing, or orchestration must pass the eval suite. Eval is first-class infrastructure, not a retrofit.

## Why eval is critical

- Trust is the moat. The eval suite is what allows us to claim hallucination control rigorously.
- Customer churn at premium pricing comes from quality regressions, not feature gaps.
- The agent harness paradigm requires measurable definition of done; eval is how that's measured for AI components.
- Frontier model updates can silently change behaviour. Eval catches it.
- Model A/B tests (Sonnet vs Opus per DEF-041) are decided by eval delta, not intuition.

## Golden dataset

Located at `packages/eval/data/golden/`. Structured as:

```
packages/eval/data/golden/
├── nda/
│   ├── 001-saas-vendor-nda.json     # source contract + ground truth
│   ├── 001-saas-vendor-nda.docx     # the actual document
│   ├── 002-...
│   └── ...
├── dpa/
├── msa/
├── saas/
└── README.md
```

Each `.json` ground truth file contains:

```jsonc
{
  "id": "nda-001",
  "contract_type": "nda",
  "jurisdiction": "kenya",
  "counterparty": "[anonymised]",
  "industry": "saas",
  "expected_critical_issues": [
    {
      "clause_ref": "5.2",
      "issue_summary": "...",
      "expected_authority": ["DPA 2019, s.49"]
    }
  ],
  "expected_material_issues": [...],
  "expected_minor_issues": [...],
  "expected_no_flag_clauses": ["1", "2", "3"],
  "human_validator": "[anonymous-id]",
  "validated_at": "2026-04-15"
}
```

### Sourcing the golden dataset

- 20 real NDAs for Sprint 1 (with permission, anonymised) → expand to 100-150 across all four contract types by end of v1 per DEF-027
- Sourced from Tim's network: Mackays in-house contracts, Kenyan founder network, friendly law firm partners
- Each contract reviewed by an external consulting Kenyan corporate lawyer for ground truth
- Budget: USD 8-12k for v1 dataset construction (DEF-027)
- Stored encrypted at rest; never committed to git in plaintext (use `git-crypt` or equivalent)

### What makes a good golden dataset

- Diverse industries (banking, tech/SaaS, manufacturing, healthcare, NGO, FMCG)
- Diverse counterparties (Kenya-based, regional, international, multinational)
- Diverse formats (clean .docx, generated PDF, scanned PDF, photographed)
- Diverse quality (well-drafted, mediocre, ambiguous, off-market)
- Includes both contracts where we expect to flag substantial issues and contracts where we expect to flag none
- Bilingual where applicable (some employment contracts in Swahili)

## Metrics

### Per-issue metrics

**Clause identification precision:** Of issues Parasol flagged, what fraction correspond to expected ground-truth issues?

**Clause identification recall:** Of expected ground-truth issues, what fraction did Parasol flag?

Combined into F1. Computed at the (contract, severity) level — a critical-severity miss is much worse than a minor-severity miss, weighted 5:1.

### Output quality metrics

**Redline appropriateness:** 1-5 lawyer rating on a sample (20% per eval run). Rated criteria:
- Is the recommended language clear and clean?
- Does it reflect actual Kenyan market practice?
- Would a senior associate sign off without rewriting?
- Is the citation accurate and on-point?

Aggregated to mean rating. Any individual rating <3 triggers manual review of that case.

**Citation validity:** Hard floor 100%. Every cited authority must resolve in the corpus. Computed deterministically by the citation validator; any failure here is a bug, not a quality regression.

**Hallucination rate:** Fraction of Parasol's claims about source documents (the contract itself, statutes, cases) that are factually wrong. Decomposed-claim verification on a sample.

### Latency metrics

- Time-to-first-stage (Sonnet response begins): p50, p95
- End-to-end review time: p50, p95
- v1 acceptance bar: p95 end-to-end < 60 seconds for documents up to 20 pages

### Cost metrics

- Input tokens per review (vision + text)
- Output tokens per review
- $-cost per review (Haiku + Sonnet + Opus + Voyage)
- Tracked per contract type and per quality tier of input
- Per-stage breakdown so model-routing decisions (DEF-041) can be made on cost-per-quality-point basis

## Acceptance bars by sprint

### Sprint 1 (NDA only, Sonnet baseline)
- F1 (clause identification, severity-weighted) ≥ 0.85
- Redline appropriateness mean ≥ 4.0 / 5
- Citation validity = 100%
- Hallucination rate < 2%
- p95 latency < 60s
- **Baseline established for Sprint 2 Opus A/B comparison.**

### Sprint 2 (NDA + DPA + MSA + SaaS, Opus A/B)
- All Sprint 1 bars maintained per contract type
- Opus A/B test on `compare-playbook` and `generate-redline` per DEF-041
- Adopt Opus on a stage if all three improve (F1 ≥+2pts, redline ≥+0.2/5, hallucination ≥-0.5%) AND p95 latency stays under 60s

### v1 launch (across NDA, DPA, MSA, SaaS) — DEF-026
- F1 ≥ 0.88 per contract type
- Redline appropriateness ≥ 4.2 / 5
- Citation validity = 100%
- Hallucination rate < 1%
- p95 latency < 45s

### v2 (EAC expansion)
- All v1 metrics maintained per jurisdiction
- New jurisdictions launch only when their per-jurisdiction F1 ≥ 0.85

## Running the eval

```bash
pnpm eval                    # run full eval suite
pnpm eval --type=nda         # run only NDA cases
pnpm eval --case=nda-001     # run a single case
pnpm eval --model-override=opus  # override modelRole resolution for A/B tests
pnpm eval:report             # render results as markdown summary
pnpm eval:diff               # compare last run vs previous
```

The CI pipeline runs eval automatically on PRs touching:
- `packages/ai/src/prompts/**`
- `packages/playbooks/**`
- `packages/corpus/src/retrieval.ts`
- `packages/ai/src/stages/**`
- `packages/ai/src/orchestrator.ts`

PR fails if any metric regresses beyond a small tolerance (1% on F1, 0% on citation validity, 0.5% on hallucination, 5% on latency).

## Evaluator agent integration

Per CLAUDE.md, after a build session a fresh Claude Code session acts as evaluator. The evaluator:

1. Reads SPRINT.md and HANDOFF.md
2. Runs `pnpm eval`
3. Compares results against `packages/eval/results/baseline.json`
4. Reports any regression and any criterion below acceptance bar
5. Verifies DEFERRED.md hygiene per CLAUDE.md grading rubric

Evaluator can fail the session even if all SPRINT.md acceptance criteria are checked, if the eval suite shows quality regression or if DEFERRED.md hygiene fails.

## Continuous improvement

After every eval run that surfaces a failure, document it:
- Add a new test case capturing the failure
- Categorise: prompt issue, retrieval issue, playbook issue, model behaviour change, intake quality issue
- File for resolution in next sprint
- The eval suite compounds over time

## What we don't measure

- Model "intelligence" or "reasoning" in abstract — only outcomes against ground truth
- Customer satisfaction in eval — that's NPS, separate metric, separate cadence
- Feature coverage — that's product backlog, not eval
- Speed of model upgrades — we lag the frontier deliberately to maintain stability
