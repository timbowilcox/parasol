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
- [ ] Scraper for kenyalaw.org ingests Constitution, all Acts, and 2,000+ recent Court of Appeal and High Court judgments
- [ ] Each ingested item structured as Postgres row with: id, type, jurisdiction, title, full_text, structured_sections (JSONB), source_url, retrieved_at, version
- [ ] Section-aware chunking implemented; chunks stored in `corpus_chunks` table with parent reference
- [ ] Voyage-3 embeddings generated and stored in pgvector column for every chunk
- [ ] BM25 keyword index operational on full text
- [ ] Hybrid retrieval function `retrieveAuthority(query, options)` returns ranked results, reciprocal-rank-fused and Voyage-reranked
- [ ] Test: query "data protection cross-border transfer" returns DPA 2019 s.49 in top 3 results

### Playbook
- [ ] NDA playbook YAML written for Kenya, validated against schema in `docs/playbook-schema.md`
- [ ] Playbook covers: confidentiality term, definition of confidential information, exclusions, return/destruction, governing law, dispute resolution, term and termination, remedies, no waiver, severability
- [ ] Each clause has: standard position, fallback position, hard limit, market rationale, citation array
- [ ] Playbook lawyer-reviewed by external consulting counsel per DEF-028 (commit reference in HANDOFF.md)

### Orchestration
- [ ] Document intake accepts .docx and PDF uploads via API
- [ ] Format detection routes clean digital input through direct text extraction (mammoth for .docx, pdfplumber for PDF) and degraded input through Claude vision
- [ ] Triage stage (Haiku 4.5) identifies contract type with confidence; routes only NDAs to Sprint 1 pipeline (rejects others with friendly message)
- [ ] Clause extraction stage (Haiku 4.5) returns structured JSON of identified clauses
- [ ] Playbook comparison stage (Sonnet 4.7 — Sprint 1 baseline; Sprint 2 A/B-tests Opus 4.7 per DEF-041) generates clause-level deviations
- [ ] Redline generation stage (Sonnet 4.7 — Sprint 1 baseline; Sprint 2 A/B-tests Opus 4.7 per DEF-041) produces tracked-change .docx output
- [ ] Citation validator runs on every output; fails the pipeline if any cited authority does not resolve in corpus
- [ ] Confidence calibration: each issue tagged high / medium / manual-review-recommended
- [ ] End-to-end latency p95 < 60 seconds for an NDA up to 10 pages
- [ ] Stage interface in `packages/ai/src/stages/*` declares `modelRole`, not concrete model; orchestrator resolves at call time

### Email intake
- [ ] Resend inbound webhook configured for `<anything>@ask.parasol.co.ke` (Sprint 1 dev subdomain; workspace-prefixed pattern lands Sprint 3 per DEF-002)
- [ ] Forwarded contract is extracted from attachment, processed through pipeline
- [ ] Reply email sent within 90 seconds with redlined .docx attached and structured summary
- [ ] Reply uses workspace-aware sender (Sprint 1: `hello@parasol.co.ke`; Sprint 3+: per-workspace from-address)
- [ ] Email-as-interface security: only senders on the allowed-domain list trigger processing; others receive a polite explainer
- [ ] Webhook signature verification using Resend's Svix-format signing per `RESEND_INBOUND_WEBHOOK_SECRET`

### Web upload
- [ ] Authenticated user can drag-and-drop or click-upload a .docx or PDF NDA at `/review/new`
- [ ] Progress indicator surfaces pipeline stages (Identifying clauses, Applying playbook, Verifying citations, Generating redline)
- [ ] Result view at `/review/<id>` shows structured issue list per the design in `BRAND.md`
- [ ] Download redline button produces .docx with native tracked changes
- [ ] All actions logged to `audit_log` table

### Corpus admin (read-only + manual run)
- [ ] `/admin/corpus` route gated to `parasol_admin` role (layout 404s non-admins)
- [ ] Page renders: health summary (4 stats), sources list (per-source status, schedule, last run, doc count), recent runs (last 7 days)
- [ ] Per-source "Run now" button triggers an incremental ingestion via `packages/corpus`
- [ ] Run state surfaces in the UI as it progresses (Running → Healthy/Warning/Error)
- [ ] Every admin action writes an `audit_log` entry with `action` namespaced `admin.corpus.*`
- [ ] UI matches the `parasol_corpus_admin` design from chat artefacts (2026-05-03)
- [ ] Schedule editor and full Vercel Cron integration deferred to Sprint 4 (read-only schedule display only in Sprint 1)

### Eval harness
- [ ] 20 real NDAs sourced (anonymised, with permission) and stored in `packages/eval/data/golden/nda/`
- [ ] Each NDA has expert-validated ground truth: expected critical, material, and minor issues
- [ ] Eval suite runs the full pipeline on each NDA and produces per-NDA scoring
- [ ] Metrics tracked: clause identification precision/recall, redline appropriateness (1-5 lawyer rating sampled at 20%), citation validity rate, hallucination rate
- [ ] Sprint 1 acceptance bar: ≥85% clause identification, ≥80% redline appropriateness, <2% hallucination rate, 100% citation validity
- [ ] Eval results committed to `packages/eval/results/sprint-1.json` and summarised in HANDOFF.md
- [ ] Eval baseline established on Sonnet 4.7 for the heavy stages — this baseline is what Sprint 2's Opus A/B compares against (DEF-041)

## Definition of done

- [ ] All acceptance criteria checked with evidence
- [ ] Tests written and passing (`pnpm test` clean)
- [ ] Zero TypeScript errors (`pnpm typecheck` clean)
- [ ] Lint clean (`pnpm lint` clean)
- [ ] Eval harness passes acceptance bar above
- [ ] HANDOFF.md updated and committed
- [ ] DEFERRED.md hygiene maintained (every TODO has a DEF entry; sprint-1 items either completed and moved to Completed, or carried into Sprint 2 with notes)
- [ ] Git history is meaningful — no `wip` commits squashed in
- [ ] Evaluator agent session run, score ≥90% per CLAUDE.md grading rubric

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
