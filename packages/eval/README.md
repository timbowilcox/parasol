# @parasol/eval

The eval suite. Golden dataset, runners, scorers, CI gating. The reason we can ship Claude Code output with confidence.

Full methodology in `EVAL.md`. Sprint 2's Opus 4.7 A/B test (DEF-041) runs through this package.

## Structure

```
src/
├── index.ts          # Public exports
├── runners/          # One per stage — runs stage against eval cases, captures outputs
├── scorers/          # Metric implementations (F1, redline appropriateness, hallucination)
├── cli/
│   ├── run.ts        # `pnpm eval` — runs full suite, writes report to data/runs/
│   └── gate.ts       # `pnpm eval:gate` — runs in CI, fails if metrics regress
├── compare.ts        # A/B comparison (Sprint 2 Opus eval)
└── types.ts          # EvalCase, EvalRun, EvalResult

data/
├── golden/           # Golden dataset (versioned; lawyer-reviewed)
│   ├── README.md     # Dataset documentation
│   ├── nda/          # NDA cases (Sprint 1: 20 contracts)
│   ├── dpa/          # DPA cases (Sprint 2)
│   └── msa/          # MSA cases (Sprint 2)
└── runs/             # Eval run artefacts (gitignored, written by runner)
```

## Sprint 1 metrics

| Metric | Bar (Sprint 1) | Bar (v1 launch) |
|--------|----------------|-----------------|
| Clause F1 (severity-weighted) | ≥ 0.82 | ≥ 0.88 |
| Redline appropriateness (1–5, lawyer-rated) | ≥ 4.0 mean | ≥ 4.2 mean |
| Hallucination rate (citation/claim mismatch) | ≤ 2% | ≤ 1% |
| Defined-terms recall | ≥ 0.90 | ≥ 0.95 |
| p95 latency | ≤ 60s | ≤ 45s |

## Sprint 2 A/B (DEF-041)

`pnpm eval:compare --baseline=sonnet --candidate=opus --stages=compare-playbook,generate-redline`

Outputs side-by-side comparison report. Adoption rule per DEFERRED.md DEF-041: all three of (F1 +2pts, redline +0.2/5, hallucination -0.5%) must improve, *and* p95 latency must stay under bar.

## CI gating

`pnpm eval:gate` runs a fast subset in CI (5 cases per stage, ~3 minutes wall-clock). Full eval (20 NDA cases, ~12 minutes) runs on PRs into main and on release branches.

CI fails on regression: any metric falls more than its tolerance below the prior main-branch run. Tolerances configured in `.github/workflows/ci.yml`.

## Adding a case

1. Source contract (anonymised, lawyer-reviewed)
2. Golden output: clause-by-clause expected severity, expected redline, expected citations
3. Pair with the playbook clause(s) it exercises
4. Add to `data/golden/<contract-type>/<case-id>.yaml`
5. Run `pnpm eval --case=<case-id>` to confirm it executes
6. PR with lawyer review notes attached
