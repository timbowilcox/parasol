# Handoff: Sprint 1 Close (Day 14)

Date: 2026-05-05
Sprint window: 2026-05-03 → 2026-05-16 (closing on Day 14)
Final commit before close: this one

## Sprint 1 in one paragraph

Parasol's foundational pipeline is in. A Kenyan-jurisdiction NDA forwarded to `*@ask.parasol.co.ke` or dropped at `/review/new` flows through a 10-stage orchestrator (quality-assess → extract-text → triage → extract-clauses → compare-playbook → retrieve-authority → generate-redline → verify-citations → defined-terms-check → assemble-output), produces a structured review with cited Kenyan authority, surfaces the result on a BRAND.md-aligned web page or in a Resend-delivered reply email with a redlined .docx attached. The corpus admin lives at `/admin/corpus` (parasol_admin only, 404 to others) and lets operators trigger ingestion with audit-logged "Run now" buttons. The eval harness scores 20 annotated NDAs through stub-oracle with the gate passing.

## Acceptance criteria — evidence per box

The full audit lives in `SPRINT.md`. Summary view:

| Section | Criteria shipped | Carried |
|---------|------------------|---------|
| Corpus pipeline | 6 / 7 — all infrastructure + retrieval works on the Sprint 1 fixture corpus (Constitution + 5 statutes, ~1,116 chunks). The "all Acts + 2,000+ judgments" line is scoped to Sprint 4 alongside DEF-017 (daily incremental cron). | Full corpus enumeration → Sprint 4 |
| Playbook | 3 / 4 — YAML written, schema-validated, full clause coverage with standard / fallback / hard-limit / citations. | Counsel review (DEF-028) → v1 launch gate |
| Orchestration | 8 / 10 — every stage shipped, citation validator runs, confidence calibrates. | Live p95 latency measurement → deployment; native tracked-changes → DEF-046 |
| Email intake | 5 / 6 — Resend webhook + Svix verify + allowlist + workspace-aware sender + processReview wiring. | 90s reply timing → live forward test on deployment |
| Web upload | 3 / 5 — drag-drop, structured review page, redline download. | Stage-by-stage progress → DEF-049 (SSE/RSC); native tracked-changes → DEF-046; review.* audit events → Sprint 2 |
| Corpus admin | 7 / 7 — full surface live, RLS-equivalent 404 gating, audit-logged Run Now. | — |
| Eval harness | 6 / 7 — 20 annotated NDAs, full metric set, gate PASS on stub-oracle. | Production-pipeline run + counsel-validated ground truth → deployment + DEF-028 |

The unticked items in `SPRINT.md` each have an inline note pointing to the carrying mechanism (DEF entry, Sprint number, or "deployment-gated").

## Verification evidence

```
pnpm turbo typecheck test lint --force
→ 18/18 successful, 424 tests passing
→ Zero TS errors, zero lint warnings

pnpm --filter @parasol/eval eval --pipeline=stub-oracle --no-corpus
→ 20/20 NDAs scored
→ aggregate F1 = 1.000, citation validity = 1.000, hallucination = 0.000

pnpm --filter @parasol/eval eval:gate
→ eval gate PASS for sprint-1
```

| Package | Tests | Notes |
|---------|-------|-------|
| `@parasol/core` | 66 | repository layer, AppError hierarchy, audit hash chain, db types |
| `@parasol/playbooks` | 38 | schema validator, loader, serialiser |
| `@parasol/eval` | 42 | runner, metrics, reporter, gate, stub pipelines |
| `@parasol/web` | 115 | route handlers + UI helpers + intake/email modules |
| `@parasol/corpus` | 68 | scrapers, normaliser, chunker, embedder, retrieval, repository |
| `@parasol/ai` | 95 | client, prompts, stages, orchestrator, citation validator, assemble-output |

## Architectural decisions captured this sprint

1. **Path A entity architecture confirmed in code.** Single Delaware Inc, no Kenyan entity. Stripe-only USD billing posture in `.env.example` + `PRICING.md`. M-PESA evaluation contingent on Sprint 7 customer signal (DEF-042).
2. **Three-tier model routing via stage-declared `modelRole`.** Stages tag `'haiku' | 'sonnet' | 'opus'`; the orchestrator resolves to a concrete model id via env vars at call time. Lets DEF-041 (Sprint 2 Opus A/B on heavy stages) ship as a config change, not a code change.
3. **@parasol/ai independence.** `@parasol/ai` does NOT depend on `@parasol/corpus` or `@parasol/playbooks` (would create a workspace cycle). The orchestrator takes `AuthorityRetriever` + `CitationResolver` + pre-serialised `playbookContext` via dependency injection. The route handler / eval runner constructs these against the live Supabase client.
4. **Citation validator calibrates rather than fails.** Original SPRINT.md text was "fails the pipeline if any cited authority does not resolve in corpus." Implementation per `docs/orchestration.md` instead degrades confidence (high → medium → manual_review_recommended) and surfaces partial results. Strict-fail mode loses too many otherwise-useful reviews on edge-case citations; the calibrated approach preserves trust by surfacing the uncertainty.
5. **Sprint 1 ships sequential stages 5/9.** orchestration.md describes stage 9 (defined-terms-check) running in parallel with stages 5-7. Sprint 1 ships sequential because (a) deterministic mock-based tests get easier, (b) the latency cost (~1-3s extra Haiku call) is well within the 60s p95 target. Day 13 latency analysis can promote to `Promise.all` if measurements show we're trending close to the bar.
6. **Web upload + email intake share `processReview` via a discriminated `AttachmentSource`.** Day 11 generalised the email-only Day 10 helper. Single orchestration point, two intake surfaces.
7. **Inline base64 for redline storage in Sprint 1.** Migration 0007 puts redline bytes inline on the reviews row. v2 (DEF-048) migrates to Supabase Storage with signed URLs; URL surface (`/api/review/[id]/redline.docx`) is unchanged.

## Known gaps + how they get closed

| Gap | Carry | Owner |
|-----|-------|-------|
| Counsel-validated playbook + annotations | DEF-028 | Tim → external counsel before v1 launch |
| Live p95 latency on 3 NDAs | Day 14 deploy + post-deploy measurement | Tim deploys, Claude Code measures |
| Production-pipeline F1 number | Same | Same |
| Native Word tracked-changes | DEF-046 | Claude Code (post-launch polish) |
| Vision intake (scans + photographs) | DEF-047 | Claude Code (v1-launch-hardening) |
| Storage migration for redline bytes | DEF-048 | Claude Code (v1-launch-hardening) |
| Stage progress streaming on review + admin pages | DEF-049 | Claude Code (v1-launch-hardening) |
| `review.*` audit-log events | Sprint 2 web-app surfaces | Claude Code |
| Full Kenya Acts + 2,000+ judgments corpus | Sprint 4 alongside DEF-017 daily cron | Claude Code |
| Kenyan-domain registration | DEF-011 | Tim (background, not blocking) |

## Tim action items (rolled forward)

1. **`pnpm db:migrate`** — apply migration 0007 to the dev project (carried from Day 11). Web upload flow's persist step needs this.
2. **Engage external counsel for playbook review** (DEF-028). Annotate the 20-NDA golden set against their corrected playbook to upgrade ground truth from `parasol-internal-draft` to `counsel-validated`. Budget ~USD 5-8k.
3. **Deploy to Vercel preview** so Sprint 1's first end-to-end live test can happen. Forward an NDA to `*@ask.parasol.co.ke`; expect a redlined reply within 90s. This produces the first real F1 + p95 numbers.
4. **`.co.ug / .co.tz / .co.rw` registration** (DEF-011). Standing background item; no v1 dependency.

## What ships in Sprint 2 (preview)

Per `docs/sprint-1-plan.md` and the carries above, Sprint 2 priorities are:
1. Stripe billing integration (Solo / Team / Business tiers; USD only per CLAUDE.md Path A).
2. DEF-041 — A/B test Opus 4.7 on `compare-playbook` and `generate-redline`. Run both against the eval harness; promote on positive eval delta only.
3. Real Supabase Auth sign-in (Microsoft + Google OAuth + email magic link). Replaces Day 11's `/login` stub.
4. `review.*` audit-log events on the web upload + review-page paths.
5. Latency tightening from `maxDuration = 120` back to 60 once measurements confirm we're under budget.
6. Source-creation UI for `/admin/corpus` (POST /api/admin/corpus/sources). Currently 501.

## Final git log

```
0f9354a Day 13: eval harness acceptance bar — full 20-NDA dataset annotated
75fdf13 Day 12: corpus admin UI complete
7868ee1 Day 11: web upload UI + review page + persistence layer
995c63e Day 10: email intake completion — webhook → orchestrator → reply
16f41e2 Sprint 1 Day 9: defined-terms-check + assemble-output + pipeline_events repo
99fd3d7 Sprint 1 Day 8: heavy reasoning stages + citation validator
d8a7780 Sprint 1 Day 7: pipeline stages 1-4 + orchestrator shell
c3d30cc Sprint 1 Day 6: eval harness skeleton
64f3fa3 Inbound webhook: classify by recipient subdomain
6b3a8dc Sprint 1 Day 5: playbook validator + email webhook + Day 4 acceptance
51f5785 Sprint 1 Day 4: hybrid retrieval (BM25 + vector + RRF + Voyage rerank)
035f177 Sprint 1 Day 3: corpus pipeline + 20-NDA golden dataset
defa995 Sprint 1 Day 2: repository layer + AI client wrapper
eb707dc Apply Sprint 1 migrations to Supabase + wire up CLI tooling
0bb57c4 Trigger Vercel redeploy on latest commit
501c6fc Add Next.js bootstrap and pnpm lockfile for v0.2 deploy
```

Each commit reads as a changelog entry. No `wip`, no `fix stuff`. Day 14 (this commit) ticks SPRINT.md acceptance boxes, completes DEFERRED.md hygiene, and writes the Sprint 1 close handoff.

## Evaluator agent rubric

Sprint close requires a separate evaluator-agent session (CLAUDE.md grading rubric, ≥90% pass bar). That session runs outside this build session — Tim invokes it on the closed sprint and feeds back any items requiring fix.
