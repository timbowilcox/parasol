# Handoff: Repo scaffold v0.2

Date: 2026-05-03
Session type: Scaffold (clean rebuild)

## What was completed

This is the v0.2 scaffold, a complete consolidation of decisions made during planning:

- Repository structure scaffolded as Turborepo + pnpm monorepo
- CLAUDE.md initializer spec written (v0.2 — Path A architecture, three-tier model routing, deferred-tasks protocol baked in)
- SPRINT.md (Sprint 1) scoped to NDA review end-to-end + corpus admin
- DEFERRED.md register populated with 42 entries spanning third-party config, DNS, compliance, ops, hardening, product roadmap, and commercial commitments
- ROADMAP.md drafted across Sprints 1-8 to v1 launch
- PRODUCT.md, BRAND.md, PRICING.md drafted (Path A — no Kenyan entity, Stripe-only billing in v1, KSh display via locked rate)
- ARCHITECTURE.md and EVAL.md drafted (three-tier model routing, eu-west-2 hosting v1)
- Architecture detail docs written: corpus pipeline, orchestration, intake pipeline, playbook schema, ux surfaces, admin surfaces, data residency, competitive landscape
- Sample NDA playbook for Kenya (`packages/playbooks/kenya/nda.yaml`) drafted as schema reference (lawyer review required before Sprint 1 acceptance per DEF-028)
- Root config: package.json, turbo.json, pnpm-workspace.yaml, tsconfig.base.json, .env.example, .gitignore, .nvmrc, .editorconfig
- App and package directory stubs ready (web, core, ai, corpus, playbooks, eval)
- Admin corpus surface stubs at `apps/web/src/app/admin/corpus/` and `apps/web/src/app/api/admin/corpus/{sources,runs}/`
- CI workflow at `.github/workflows/ci.yml` gating PRs on typecheck, lint, test, eval

## Key v0.2 decisions (from planning conversation)

- **Path A entity architecture.** Parasol Inc (Delaware), no Kenyan entity in v1. Same playbook as Legora, Harvey, Notion, Figma. Local presence is a Sprint 7+ decision contingent on customer evidence (DEF-013, DEF-022).
- **Stripe-only billing in v1.** USD only. KSh prices on the marketing page convert at locked rate. M-PESA acceptance evaluated in Sprint 7 based on demand signal (DEF-042). Flutterwave deliberately not included.
- **Three-tier model routing.** Haiku 4.5 + Sonnet 4.7 + Opus 4.7. Sprint 1 ships Sonnet on heavy stages to set baseline; Sprint 2 A/B-tests Opus per DEF-041.
- **Hosting in eu-west-2 (London) for Supabase, default Vercel routing.** af-south-1 migration is a v2 decision (DEF-022). Latency from Nairobi ~140ms is acceptable for v1.
- **Resend in eu-west-1 (Ireland).** Outbound verified at parasol.co.ke. Inbound MX lands on `ask.parasol.co.ke` at Sprint 1 day 5 per DEF-001. Sprint 3 expands to wildcard `*.parasol.co.ke` for workspace-prefixed addresses (DEF-002).
- **Deferred-tasks protocol** is binding. Every sprint kickoff reads DEFERRED.md and surfaces relevant items before code is written.

## Test status

No tests yet — implementation hasn't started. Sprint 1 includes test infrastructure setup as part of acceptance criteria.

## What is NOT done

Everything in SPRINT.md acceptance criteria. This is the scaffold only — no code shipped, no corpus ingested, no playbook lawyer-reviewed, no eval data sourced.

## Known issues / debt

- `packages/playbooks/kenya/nda.yaml` is a *structural example* only. Per DEF-028 it must be lawyer-reviewed and revised by external consulting counsel before being treated as production. Hard deadline: Sprint 1 day 5.
- `docs/sprint-1-plan.md` not yet written; should be written as day 1 of Sprint 1.
- The 20-NDA golden dataset has not been sourced. Hard deadline: Sprint 1 day 3.
- Tim has third-party accounts in progress as of scaffold creation: Anthropic, Voyage, Supabase (eu-west-2 London, parasol-prod), GitHub repo at timbowilcox/parasol, Resend (eu-west-1, parasol.co.ke verified outbound). `.env.local` populated for Supabase, Anthropic, Voyage, Resend outbound.

## Exact next step

Open Sprint 1 with `/clear`, read CLAUDE.md, read SPRINT.md, **then run the deferred-tasks protocol per CLAUDE.md** (read DEFERRED.md, filter `Trigger: sprint:1`, surface to Tim, wait for confirmation on Tim-action items). Then write `docs/sprint-1-plan.md` as a day-by-day breakdown before writing any code.

## Files in scaffold

```
parasol/
├── CLAUDE.md
├── SPRINT.md
├── HANDOFF.md
├── DEFERRED.md
├── ROADMAP.md
├── README.md
├── PRODUCT.md
├── BRAND.md
├── PRICING.md
├── ARCHITECTURE.md
├── EVAL.md
├── package.json
├── turbo.json
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── .env.example
├── .gitignore
├── .nvmrc
├── .editorconfig
├── docs/
│   ├── playbook-schema.md
│   ├── corpus-pipeline.md
│   ├── orchestration.md
│   ├── intake-pipeline.md
│   ├── ux-surfaces.md
│   ├── admin-surfaces.md
│   ├── data-residency.md
│   └── competitive-landscape.md
├── apps/web/
│   ├── package.json
│   ├── tsconfig.json
│   ├── README.md
│   └── src/app/
│       ├── admin/corpus/page.tsx
│       └── api/admin/corpus/{sources,runs}/route.ts
├── packages/
│   ├── core/         (package.json, tsconfig.json, README.md, src/)
│   ├── ai/           (package.json, tsconfig.json, README.md, src/)
│   ├── corpus/       (package.json, tsconfig.json, README.md, src/)
│   ├── playbooks/    (package.json, tsconfig.json, README.md, src/, kenya/nda.yaml)
│   └── eval/         (package.json, tsconfig.json, README.md, src/, data/golden/, results/)
└── .github/workflows/ci.yml
```
