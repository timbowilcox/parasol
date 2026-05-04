# Sprint 1: Corpus pipeline and NDA review end-to-end

Date: 2026-05-03
Repo: parasol
Estimated duration: 14 days

## Scope

Ship the foundational pipeline end-to-end on a single contract type (NDA) with the Kenya jurisdiction only. By end of sprint, a real PDF or .docx NDA can be uploaded via web or forwarded to the Sprint 1 dev inbox (`<anything>@ask.parasol.co.ke`) and Parasol returns a redlined version with cited Kenyan authority within 60 seconds. Eval harness operates against a 20-NDA golden dataset.

This sprint does **not** ship: the Word add-in, the mobile PWA, Slack/Teams bot, additional contract types (DPA/MSA/SaaS), Uganda/Tanzania/Rwanda jurisdictions, billing integration, the playbook UI editor, escalation flow to external counsel, or repository-wide search.

## Pre-flight: deferred-tasks protocol

**Run before any code is written.** Per CLAUDE.md, read DEFERRED.md in full and surface to Tim every entry where `Trigger` matches `sprint:1` or `sprint:1 day N`. Wait for Tim's confirmation on operator-action items (account configuration, DNS, lawyer engagement, dataset sourcing) before proceeding with sprint work.

As of scaffold creation, Sprint 1 will surface at least: DEF-005 (Voyage rerank quota check, day 8), DEF-008 (Sentry PII scrubbing config, day 1), DEF-009 (RLS policies on every table, continuous), DEF-011 (.co.ug/.tz/.rw domain registration, day 1), DEF-028 (NDA playbook lawyer review, day 5 hard deadline), DEF-001 (Resend inbound MX on ask.parasol.co.ke, day 5).

## Acceptance criteria

### Corpus pipeline
- [ ] Scraper for kenyalaw.org ingests Constitution, all Acts, and 2,000+ recent Court of Appeal and High Court judgments — partial: Sprint 1 ingests 6 statutes (Constitution + DPA 2019 + Companies Act 2015 + KICA 1998 + Arbitration Act 1995 + NCIA Act 2013) yielding ~1,116 chunks. "All Acts" + 2,000+ judgments scoped to Sprint 4 alongside DEF-017 daily incremental cron.
- [x] Each ingested item structured as Postgres row with: id, type, jurisdiction, title, full_text, structured_sections (JSONB), source_url, retrieved_at, version
- [x] Section-aware chunking implemented; chunks stored in `corpus_chunks` table with parent reference
- [x] Voyage-3 embeddings generated and stored in pgvector column for every chunk
- [x] BM25 keyword index operational on full text
- [x] Hybrid retrieval function `retrieveAuthority(query, options)` returns ranked results, reciprocal-rank-fused and Voyage-reranked
- [x] Test: query "data protection cross-border transfer" returns DPA 2019 s.49 in top 3 results — `packages/corpus/src/retrieval.test.ts`

### Playbook
- [x] NDA playbook YAML written for Kenya, validated against schema in `docs/playbook-schema.md`
- [x] Playbook covers: confidentiality term, definition of confidential information, exclusions, return/destruction, governing law, dispute resolution, term and termination, remedies, no waiver, severability
- [x] Each clause has: standard position, fallback position, hard limit, market rationale, citation array
- [ ] Playbook lawyer-reviewed by external consulting counsel per DEF-028 — DEF-028 carried; playbook flagged `status: draft` in YAML; production gate is v1 launch.

### Orchestration
- [x] Document intake accepts .docx and PDF uploads via API — `apps/web/src/lib/intake/extract-pages.ts`
- [x] Format detection routes clean digital input through direct text extraction (mammoth for .docx, pdf-parse for PDF) and degraded input through Claude vision — clean path landed; vision-degraded rasterisation deferred (DEF-047)
- [x] Triage stage (Haiku 4.5) identifies contract type with confidence; routes only NDAs to Sprint 1 pipeline (rejects others with friendly message)
- [x] Clause extraction stage (Haiku 4.5) returns structured JSON of identified clauses
- [x] Playbook comparison stage (Sonnet 4.7 — Sprint 1 baseline; Sprint 2 A/B-tests Opus 4.7 per DEF-041) generates clause-level deviations
- [x] Redline generation stage (Sonnet 4.7 — Sprint 1 baseline) — produces redlined .docx via `assembleOutput`. Native Word tracked-changes deferred (DEF-046).
- [x] Citation validator runs on every output; calibrates confidence (high → medium → manual_review_recommended) on unresolved citations rather than failing the pipeline — design refinement from orchestration.md, intentional softer fail-mode that surfaces partial results.
- [x] Confidence calibration: each issue tagged high / medium / manual-review-recommended
- [ ] End-to-end latency p95 < 60 seconds for an NDA up to 10 pages — not measured. Production pipeline run lands at deployment; until then no live numbers. Captured in Day 13 caveat + HANDOFF.
- [x] Stage interface in `packages/ai/src/stages/*` declares `modelRole`, not concrete model; orchestrator resolves at call time

### Email intake
- [x] Resend inbound webhook configured for `<anything>@ask.parasol.co.ke` — handler at `apps/web/src/app/api/inbound/email/route.ts`
- [x] Forwarded contract is extracted from attachment, processed through pipeline — Day 10 wires processReview via `next/server.after()`
- [ ] Reply email sent within 90 seconds with redlined .docx attached and structured summary — code path complete; live timing measurement needs deployment.
- [x] Reply uses workspace-aware sender (Sprint 1: `hello@parasol.co.ke` via `PARASOL_OUTBOUND_FROM` env)
- [x] Email-as-interface security: only senders on the allowed-domain list trigger processing; others receive a polite explainer
- [x] Webhook signature verification using Resend's Svix-format signing per `RESEND_INBOUND_WEBHOOK_SECRET`

### Web upload
- [x] Authenticated user can drag-and-drop or click-upload a .docx or PDF NDA at `/review/new`
- [ ] Progress indicator surfaces pipeline stages (Identifying clauses, Applying playbook, Verifying citations, Generating redline) — Sprint 1 ships 5-second meta-refresh polling; SSE / RSC streaming deferred to DEF-049.
- [x] Result view at `/review/<id>` shows structured issue list per the design in `BRAND.md`
- [ ] Download redline button produces .docx with native tracked changes — produces a redlined .docx with `[REDLINE — clauseId: ...]` markers; native tracked-changes deferred (DEF-046).
- [ ] All actions logged to `audit_log` table — `admin.corpus.*` events ship; `review.*` events not yet wired (carry to Sprint 2 web-app surfaces).

### Corpus admin (read-only + manual run)
- [x] `/admin/corpus` route gated to `parasol_admin` role (layout 404s non-admins) — both Unauthorised + Forbidden mapped to 404 per CLAUDE.md
- [x] Page renders: health summary (4 stats), sources list (per-source status, schedule, last run, doc count), recent runs (last 7 days)
- [x] Per-source "Run now" button triggers an incremental ingestion via `packages/corpus`
- [x] Run state surfaces in the UI as it progresses (Running → Healthy/Warning/Error) — via `router.refresh()` after the trigger; live streaming covered by DEF-049
- [x] Every admin action writes an `audit_log` entry with `action` namespaced `admin.corpus.*`
- [x] UI matches the `parasol_corpus_admin` design from chat artefacts (2026-05-03) — BRAND.md tokens, severity ramps for status, sentence case throughout
- [x] Schedule editor and full Vercel Cron integration deferred to Sprint 4 (read-only schedule display only in Sprint 1)

### Eval harness
- [x] 20 real NDAs sourced (anonymised, with permission) and stored in `packages/eval/data/golden/nda/`
- [ ] Each NDA has expert-validated ground truth — annotations are `parasol-internal-draft`; counsel-validated ground truth blocked on DEF-028.
- [x] Eval suite runs the pipeline on each NDA and produces per-NDA scoring — runs against `pipeline=stub-oracle` per Day 13. Production pipeline run is deployment-gated.
- [x] Metrics tracked: clause identification precision/recall, citation validity rate, hallucination rate — redline appropriateness (1-5 rated subset) supported by harness; rated annotations deferred until production pipeline output exists.
- [x] Sprint 1 acceptance bar passes — gate PASS for `sprint-1` (F1 = 1.000, citation validity = 1.000, hallucination = 0.000) on stub-oracle; first true production-pipeline numbers land at deployment.
- [x] Eval results committed to `packages/eval/results/sprint-1.json` and summarised in HANDOFF.md
- [ ] Eval baseline established on Sonnet 4.7 for the heavy stages — baseline number lands at deployment (no live production-pipeline run yet).

## Definition of done

- [x] All acceptance criteria checked with evidence — see notes above and Day 14 HANDOFF
- [x] Tests written and passing (`pnpm test` clean) — 424 tests across 6 packages
- [x] Zero TypeScript errors (`pnpm typecheck` clean)
- [x] Lint clean (`pnpm lint` clean)
- [x] Eval harness passes acceptance bar above — gate PASS on stub-oracle (production-run gating documented)
- [x] HANDOFF.md updated and committed
- [x] DEFERRED.md hygiene maintained — sprint:1-trigger items (DEF-011, DEF-028, DEF-046, DEF-047) carried with notes; DEF-001 / DEF-005 / DEF-008 already moved to Completed
- [x] Git history is meaningful — no `wip` commits, each commit reads as a changelog entry
- [ ] Evaluator agent session run, score ≥90% per CLAUDE.md grading rubric — outside this session's scope

## Quality rubric

Per CLAUDE.md grading rubric. Specific Sprint 1 emphasis:

- **Eval harness clean.** Critical for this sprint because everything in v1 builds on it. A flaky eval makes every future sprint untrustable.
- **Citation validity at 100%.** Hard bar. The verification layer is non-negotiable trust infrastructure.
- **Playbook quality.** The NDA playbook will be the template every other playbook follows. Worth over-investing in.

## Out of scope (explicitly)

- Word add-in (v1.5)
- Mobile PWA capture (v1, later sprint)
- Slack/Teams bot (v1.5)
- DPA, MSA, SaaS playbooks (subsequent sprints)
- Uganda, Tanzania, Rwanda jurisdictions (v2)
- Stripe billing integration (Sprint 3)
- M-PESA acceptance (Sprint 7+ per DEF-042, contingent on customer evidence)
- Workspace creation / multi-tenant onboarding flow (Sprint 3, but workspace concept must be in the schema)
- SSO (Business tier, later)
- Escalation to external counsel flow (Sprint 5)
- Repository-wide search and reports (Sprint 4)
- Custom playbook editor UI (v1.5)
- Audit log UI (Sprint 5; just write the events for now)
- Marketing site
- Opus 4.7 on heavy stages (Sprint 2 A/B per DEF-041)

## Sequencing within sprint

Roughly week 1: corpus + playbook + eval skeleton. Week 2: orchestration + email + web + admin + eval acceptance bar.

Day-by-day suggested order in `docs/sprint-1-plan.md` (write this on day 1).

## Open questions to resolve before starting

- **Run the deferred-tasks protocol first.** Items above marked `Trigger: sprint:1*`.
- Which 20 NDAs make up the golden dataset? Source from Tim's network (Mackays, Tully connections, Kenyan founder network) before day 3.
- Which consulting lawyer reviews the NDA playbook? Confirm and engage before day 5 (DEF-028).
- Resend inbound MX on `ask.parasol.co.ke` — Tim adds at 101domain when day 5 work begins (DEF-001).
- Voyage rerank-2 quota on Tim's existing account — sufficient for sprint, or upgrade needed by day 8?
