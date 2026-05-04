# Deferred Tasks Register

The single source of truth for everything intentionally deferred. Claude Code reads this file during every sprint kickoff and surfaces relevant items to Tim before that sprint begins.

## How this works

This is **not** a backlog. The product backlog is in ROADMAP.md and SPRINT.md. This is the register of *housekeeping, hardening, third-party integration, and operational* tasks that have been deliberately postponed because doing them earlier would be premature optimisation, blocked on a dependency, or distracting from the current sprint's acceptance criteria.

Each entry has a **Trigger** field that tells Claude Code when to surface it. At the start of every sprint, Claude Code:

1. Reads this file
2. Filters entries whose Trigger condition matches the current sprint or current state
3. Surfaces them to Tim in the Sprint planning conversation as "deferred items now relevant"
4. For items that are pure operator tasks (e.g. "rotate a key in a third-party UI"), Claude Code prompts Tim to do them and waits for confirmation
5. For items that are implementation work, Claude Code adds them to that sprint's SPRINT.md acceptance criteria

If a deferred item is completed, move it to the **Completed** section at the bottom (don't delete) so we have an audit trail.

## Trigger taxonomy

- `sprint:N` — surface at start of Sprint N
- `sprint:N day M` — surface at specific day within sprint
- `phase:v1-launch-hardening` — surface during Sprint 8 (launch hardening)
- `phase:v1.5` — surface during v1.5 planning
- `phase:v2` — surface during v2 planning
- `condition:<thing>` — surface when a specific condition becomes true (e.g. `condition:first-paying-customer`, `condition:50-workspaces-active`)
- `quarterly` — surface at start of each calendar quarter
- `annually` — surface at start of each calendar year

---

## Active deferred items

### Third-party account configuration

#### DEF-002: Resend — wildcard MX for workspace-prefixed addresses
- **Trigger**: `sprint:3` (workspace creation sprint)
- **What**: Configure `*.parasol.co.ke` wildcard MX in 101domain so that addresses like `ask@<workspace-slug>.parasol.co.ke` route correctly through Resend inbound. Verify with a test workspace before Sprint 3 closes. Note: root `parasol.co.ke` MX must remain pointed at Tim's primary email service (Microsoft 365 / Google Workspace) so normal mailboxes like `tim@parasol.co.ke` continue to work.
- **Why deferred**: Sprint 1 uses a single fixed dev subdomain (`ask.parasol.co.ke`). Workspace-as-subdomain pattern is a Sprint 3 feature when multi-tenant workspace creation lands.
- **Whose action**: Tim (DNS), Claude Code (verification script)

#### DEF-003: DMARC — tighten from `p=none` to `p=quarantine`
- **Trigger**: `phase:v1-launch-hardening`
- **What**: Update the `_dmarc` TXT record on parasol.co.ke from `v=DMARC1; p=none;` to `v=DMARC1; p=quarantine; rua=mailto:dmarc@parasol.co.ke; pct=100;`. Set up an inbox for `dmarc@parasol.co.ke` to receive aggregate reports.
- **Why deferred**: `p=none` is monitor-only and lets you verify SPF/DKIM are working in production before enforcement. Tightening too early bounces legitimate mail.
- **Whose action**: Tim (DNS update)

#### DEF-004: Anthropic — verify Zero Data Retention before each release
- **Trigger**: every release tag (Sprint 8 onwards)
- **What**: Confirm ZDR setting is still enabled on the Parasol workspace in console.anthropic.com before promoting any build to production. Workspace-level setting can change.
- **Why deferred**: Cannot be automated through Anthropic's API in v1.
- **Whose action**: Tim (manual check). Add to release runbook.
- **Claude Code role**: Block production release until Tim confirms.

#### DEF-006: Stripe — activate live account and configure tax handling
- **Trigger**: `sprint:3 day 1`
- **What**: Sandbox keys retrieved (stored in Tim's password manager). Sprint 3: complete Stripe live activation for Parasol Inc (Delaware); configure US tax compliance via Stripe Tax for Delaware; configure Kenya VAT collection on cross-border digital services (1.5% DST per Kenya Finance Act); set USD as primary currency; configure invoice templates with Parasol Inc as merchant of record. Wire sandbox keys for Sprint 3 development; switch to live keys at Sprint 8 launch.
- **Whose action**: Tim (Stripe dashboard + Delaware business documents)

#### DEF-009: Supabase — Row-Level Security policies on every table
- **Trigger**: each migration that adds a new table (continuous)
- **What**: Every table created via migration must include RLS policies in the same migration. CLAUDE.md mandates this. Auto-RLS is enabled on the project but auto-RLS only enables RLS without writing policies — the policies themselves must be authored per table.
- **Whose action**: Claude Code (writes policies) + evaluator agent (verifies policies exist on every table)

#### DEF-010: Supabase — Vault for sensitive at-rest secrets
- **Trigger**: `phase:v1-launch-hardening`
- **What**: Migrate `AUDIT_LOG_HASH_SECRET` and any per-workspace API tokens from environment variables into Supabase Vault. Rotate the audit log hash secret as part of the migration.
- **Why deferred**: Vault has been in flux through 2025-2026; environment variables are sufficient and more debuggable for v1 development.
- **Whose action**: Claude Code (migration) + Tim (verify)

### DNS and domain

#### DEF-011: Register .co.ug, .co.tz, .co.rw
- **Trigger**: `sprint:1 day 1`
- **What**: Register parasol.co.ug, parasol.co.tz, parasol.co.rw at appropriate registrars before someone else does. Forward to parasol.co.ke for now; activate as primary domains during v2 jurisdiction expansion.
- **Whose action**: Tim
- **Cost**: ~$50-80/year total

#### DEF-012: SSL certificates for wildcard subdomains
- **Trigger**: `sprint:3`
- **What**: Vercel handles certificates for the apex and primary subdomains automatically, but wildcard `*.parasol.co.ke` needs explicit configuration in Vercel for the workspace-prefixed addresses to work over HTTPS.
- **Whose action**: Claude Code (Vercel config) + Tim (verify in Vercel dashboard)

### Compliance and legal (Path A — customer-driven, not regulator-mandated)

Path A architecture means Parasol is a US-incorporated SaaS selling cross-border to Kenyan customers (same playbook as Legora, Harvey, Notion). The items below are *customer-procurement-driven* compliance, not regulator-mandated. They fire when customer demand or regulator enforcement signals make them necessary, not by default.

#### DEF-013: Kenya local presence (entity, ODPC registration) — IF customer evidence demands
- **Trigger**: `condition:enterprise-customer-requires-kenyan-entity` OR `condition:5-prospective-customers-blocked-by-no-local-presence`
- **What**: Evaluate Path B (Kenyan agent) or Path C (Kenyan subsidiary) per planning conversation. Path B = commercial agency agreement with a Kenyan operator (Wayawaya-style). Path C = Parasol Kenya Limited as wholly-owned Delaware subsidiary, ODPC registration as data processor, local director arrangement, KRA registration, local bank account. Cost varies materially by path.
- **Why deferred**: Path A is sufficient for the bulk of v1 ICP (mid-corporates with USD payment capability). Local presence is expensive, slow, and only justified by customer evidence that Path A is leaving real money on the table.
- **Whose action**: Tim (decision) + corporate counsel (execution)
- **Surface from Sprint 5 onwards**: At each sprint kickoff, Claude Code reviews lost-deal reasons from any sales/customer conversations Tim has logged. If 3+ deals cite "no local presence" or "no Kenyan entity" as the blocker, escalate this to active.

#### DEF-014: Customer DPA template authoring
- **Trigger**: `sprint:5`
- **What**: Author standard Customer DPA at `legal/dpa-template.md`. Standard form for Solo and Team tiers; negotiable for Business. Includes SCCs annex (cross-border transfer to US), sub-processor list, TOMs annex, data subject rights handling. Path A appropriate framing: "Parasol Inc (Delaware) as data processor; customer as data controller; Anthropic, Voyage, Supabase, Resend, Stripe as named sub-processors with regions specified."
- **Whose action**: Tim + external counsel (cost: USD 3-5k)

#### DEF-015: Penetration test before launch
- **Trigger**: `sprint:8`
- **What**: Engage external firm for penetration test. Specific focus: tenant isolation in Postgres RLS, audit log hash chain integrity, document storage access controls, prompt injection in customer documents.
- **Whose action**: Tim engages firm, Claude Code remediates findings
- **Cost**: USD 8-15k

#### DEF-016: Annual transparency report
- **Trigger**: `annually` starting Q1 2027
- **What**: Publish transparency report at parasol.co.ke/transparency covering: sub-processor changes, security incidents (if any), aggregate audit metrics, regulator interactions if any, law enforcement requests received and outcome.
- **Whose action**: Tim + Claude Code drafts initial version

### Operational and observability

#### DEF-017: Vercel Cron for daily corpus incremental ingestion
- **Trigger**: `sprint:4`
- **What**: Wire daily 02:00 EAT cron job that calls `/api/cron/corpus-daily` to incrementally ingest new judgments and ODPC determinations. Sprint 1 ships manual triggering only via the corpus admin UI.
- **Whose action**: Claude Code

#### DEF-018: Weekly Kenya Gazette diff job
- **Trigger**: `sprint:4`
- **What**: Weekly Monday 06:00 EAT cron pulling the latest Gazette and triggering re-ingestion of any Acts referenced in amendments. Diffs above 10% threshold held in the pending-diffs queue per admin-surfaces.md.
- **Whose action**: Claude Code

#### DEF-019: Pending-diff review UI
- **Trigger**: `sprint:5`
- **What**: Implement the pending-diff review screen at `/admin/corpus/diffs`. Side-by-side diff rendering, promote/reject/fork actions per docs/admin-surfaces.md. Sprint 1 ships the schema and the queue but no review UI.
- **Whose action**: Claude Code

#### DEF-020: Source-level circuit breakers and alerting
- **Trigger**: `sprint:8`
- **What**: For each corpus source, wrap scrapers with circuit breakers that back off on repeated failures. Alert via Slack #parasol-corpus on any failure. Specific patterns: kenyalaw.org structure changes (HTML class moves) must fail loudly, not ingest garbage.
- **Whose action**: Claude Code

#### DEF-021: Coverage health check job
- **Trigger**: `sprint:8`
- **What**: Weekly job querying ~50 known authorities (DPA 2019 s.49, Companies Act 2015 s.12, etc.) and verifying retrieval still surfaces them in top 5 results. Failure alerts before customers hit it.
- **Whose action**: Claude Code

#### DEF-022: Migrate hosting to af-south-1 (Cape Town) — IF latency or procurement evidence demands
- **Trigger**: `condition:nairobi-latency-customer-complaint` OR `phase:v2`
- **What**: Migrate Vercel and Supabase from current eu-west-2 (London) hosting to AWS af-south-1 (Cape Town). Customer notification required, downtime estimate documented in advance.
- **Why deferred**: Premature for v1; documented as architectural target. London at ~140ms from Nairobi is acceptable v1 latency and Supabase pgvector availability is more reliable in eu-west-2.
- **Whose action**: Claude Code (migration) + Tim (customer comms)

#### DEF-023: Quarterly Voyage embedding model refresh
- **Trigger**: `quarterly`
- **What**: Re-embed full corpus quarterly to capture Voyage model improvements. Run during low-traffic window. Eval suite must pass before promoting new embeddings.
- **Whose action**: Claude Code (with Tim approval to spend the embed cost)

#### DEF-024: Annual encryption key rotation
- **Trigger**: `annually`
- **What**: Rotate `AUDIT_LOG_HASH_SECRET` and any other application-managed keys. Document rotation procedure in `RUNBOOK.md` (also deferred until Sprint 8).
- **Whose action**: Claude Code + Tim coordinated

#### DEF-025: Annual sub-processor list audit
- **Trigger**: `annually`
- **What**: Review docs/data-residency.md sub-processor list. Verify each is still in use, still ZDR-configured (where applicable), still in their stated region. Update list and re-publish.
- **Whose action**: Claude Code + Tim

#### DEF-043: Outbound delivery telemetry — bounce / complaint / delay events
- **Trigger**: `sprint:2` or `sprint:3` (during billing/email-flows hardening)
- **What**: Add a second Resend webhook subscribed to `email.bounced`, `email.delivery_delayed`, `email.complained` events, posting to a new handler at `/api/outbound/events`. Persists each event to a `delivery_events` table linked to the originating `reviews.id` where applicable. Surfaces failed deliveries in the workspace activity feed and triggers retry-or-alert logic per event type.
- **Why deferred**: Sprint 1 critical path is inbound (`email.received`). Outbound responses use Resend's send API which returns delivery success synchronously enough for v1 — operational visibility into post-send failures is hardening, not core flow. A customer's response email silently failing is bad but not Sprint 1 blocking.
- **Why it matters when picked up**: Without this, an outbound response that bounces or gets marked as spam disappears from operator visibility. The customer assumes Parasol ignored them. Long-term reputation risk on Resend's sending IPs if complaint rate goes uncaught.
- **Whose action**: Claude Code (handler + table + activity feed wiring); Tim (configure the second webhook in Resend → Webhooks once handler ships)

#### DEF-049: Server-Sent Events / RSC streaming for /review/[id] live progress
- **Trigger**: `phase:v1-launch-hardening`
- **What**: The Sprint 1 day-11 review page polls every 5 seconds via `<meta http-equiv="refresh">` while the review is in `pending` / `processing`. Replace with either a Server-Sent Events stream (the orchestrator's `pipeline_events` table is the natural source) or a Next 16 RSC progressive-render pipeline that suspends until completion. Either way, the user gets stage-by-stage updates ("Identifying clauses → Applying playbook → Verifying citations") instead of a static "processing…" banner that flips to the result.
- **Why deferred**: The static-poll loop is functional and removes the most expensive failure mode (browser stuck on a stale page). Streaming is polish — meaningful UX improvement but not Sprint 1 blocking.
- **Whose action**: Claude Code

#### DEF-048: Migrate redline DOCX bytes from inline base64 to Supabase Storage
- **Trigger**: `phase:v1-launch-hardening` OR `condition:single-review-base64-exceeds-1mb`
- **What**: Migration 0007 adds `redline_docx_base64` as a TEXT column on `reviews`. Sprint 1 NDAs are 5-50 KB raw, well under any practical row-size concern, but storing binary as base64 in Postgres scales poorly — bytea is more efficient, and Supabase Storage with signed URLs is the canonical answer. Migrate by: (1) creating a `reviews` Storage bucket with workspace-scoped RLS-equivalent policies, (2) updating the persist step in process-review.ts to upload bytes and write the storage path to a new `redline_docx_storage_path` column, (3) updating /api/review/[id]/redline.docx to redirect to a 5-minute signed URL, (4) backfilling existing rows, (5) dropping the inline column.
- **Why deferred**: Adds a Supabase Storage bucket + RLS-equivalent policy work that's outside the day-11 critical path. Inline storage works fine for Sprint 1 NDA sizes; the URL surface (`/api/review/[id]/redline.docx`) is identical so the migration is internal only.
- **Whose action**: Claude Code

#### DEF-047: Vision-degraded intake — rasterise scanned PDFs and photograph attachments
- **Trigger**: `sprint:1 day 13` OR `phase:v1-launch-hardening`
- **What**: The Sprint 1 day-10 intake helper at `apps/web/src/lib/intake/extract-pages.ts` handles the clean path only: digital PDFs (text extracted via pdf-parse), DOCX (mammoth), text/plain. Scanned PDFs and photographs hit the `empty_document` failure branch instead of being routed to the orchestrator's `extract-text-degraded` stage (which already exists and accepts `imageBase64` + `imageMimeType` per page). Add a vision-degraded path: detect when a PDF has zero extractable text but high page count, rasterise each page to PNG (via `pdfjs-dist` + `canvas` or a serverless-friendly alternative), populate the `imageBase64` field on each `PageInput`, and let the orchestrator's quality-assess stage route to the Sonnet vision extractor.
- **Why deferred**: The CLAUDE.md strategic premise "format-agnostic intake" includes photographs of paper and scanned PDFs. But the rasterisation libraries are heavyweight (canvas alone is ~50MB and needs native deps that fight with Vercel's serverless runtime); landing this on Day 10 would have blown the day's scope. The clean path covers the digital-PDF and DOCX cases that account for the vast majority of inbound contracts in dev testing.
- **Why it matters**: Without vision intake, a Kenyan SME forwarding a phone photo of a paper NDA gets the unhelpful `empty_document` reply instead of an actual review. That's the exact ICP we promised to serve natively.
- **Workaround in Sprint 1**: The unsupported branch sends an explainer reply asking the sender to share the digital DOCX/PDF instead. Documented in HANDOFF day 10.
- **Whose action**: Claude Code

#### DEF-046: Native Word tracked-changes for the redline DOCX
- **Trigger**: `sprint:1 day 12` OR `phase:v1-launch-hardening`
- **What**: The Sprint 1 day-9 `assemble-output` produces a clean Word document with the issues summary + the original document body annotated with `[REDLINE — clauseId: ...]` markers next to flagged clauses. This is functional but doesn't use Word's native tracked-changes feature (Insertions / Deletions that the user can Accept/Reject in Word's Review tab). Upgrade to use the `docx` library's `InsertedTextRun` + `DeletedTextRun` + `Document.features.trackRevisions` so each redline appears as a strikethrough-original + colored-insert pair the user accepts in Word's native flow.
- **Why deferred**: Native tracked-changes generation requires careful preservation of the original document's paragraph and run structure — the current code reconstructs paragraphs from extracted plaintext, which loses the formatting that Word needs to anchor revision marks correctly. A robust implementation reads the original DOCX bytes, walks the OOXML, and inserts revision marks at the right offsets. That's a real engineering task — Day 12 polish slot or post-launch.
- **Why it matters**: Native tracked-changes is the canonical Word review experience. Without it, customers see "Parasol's review is helpful but I have to manually copy-paste the recommendations into my version of the document" — friction that erodes the email-front-door promise.
- **Workaround in Sprint 1**: The `[REDLINE — ...]` markers are clearly visible inline; the issue list at the top of the DOCX is the operative view. Customers can act on the recommendations, just not via Word's native review UI.
- **Whose action**: Claude Code

### Product hardening

#### DEF-026: Eval acceptance bar tightening at v1 launch
- **Trigger**: `sprint:8`
- **What**: Raise eval acceptance bars from Sprint 1 levels (F1 ≥0.85, redline ≥4.0, hallucination <2%) to v1 launch levels (F1 ≥0.88, redline ≥4.2, hallucination <1%). All four contract types.
- **Whose action**: Claude Code

#### DEF-027: Dataset expansion from 20 NDAs to 100-150 contracts
- **Trigger**: continuous through Sprint 2-7
- **What**: Expand golden dataset to 100-150 contracts across NDA, DPA, MSA, SaaS. Each expansion validated by external Kenyan corporate counsel. Budget tracked.
- **Whose action**: Tim (sourcing) + counsel (validation) + Claude Code (eval integration)
- **Cost**: USD 8-12k total

#### DEF-028: Playbook lawyer review before Sprint 1 acceptance
- **Trigger**: `sprint:1 day 5` hard deadline
- **What**: NDA playbook at packages/playbooks/kenya/nda.yaml is currently structural example. External Kenyan corporate counsel must review and revise before Sprint 1 acceptance bar can be ticked.
- **Whose action**: Tim engages counsel
- **Cost**: USD ~5-8k for v1 playbooks (NDA, DPA, MSA, SaaS combined)

#### DEF-029: Playbook UI editor (lawyer-editable through product)
- **Trigger**: `phase:v1.5`
- **What**: Build the playbook editor at /app/playbooks/edit per docs/ux-surfaces.md. v1 ships YAML-as-source; v1.5 introduces UI editor with test mode, version history, approval workflow.
- **Whose action**: Claude Code

#### DEF-030: Word add-in
- **Trigger**: `phase:v1.5`
- **What**: Office.js task pane, sideloaded for Business tier, AppSource-published for v2. Per docs/ux-surfaces.md.
- **Whose action**: Claude Code

#### DEF-031: Slack and Microsoft Teams bots
- **Trigger**: `phase:v1.5`
- **What**: Slack Events API + Bot Framework integration. Per docs/ux-surfaces.md.
- **Whose action**: Claude Code

#### DEF-032: Industry playbook variants
- **Trigger**: `phase:v2`
- **What**: Per-industry playbook variants (banking_finance, saas, manufacturing, etc.) per docs/playbook-schema.md. v1 ships single playbook per contract type.
- **Whose action**: Claude Code + counsel

### Customer and commercial

#### DEF-033: Pricing review at month 18
- **Trigger**: `condition:18-months-post-launch`
- **What**: Review pricing tiers per PRICING.md commitment ("we do not raise headline prices on existing customers for the first 18 months"). After 18 months, can adjust new-customer pricing while honouring grandfathered customers.
- **Whose action**: Tim

#### DEF-034: Founder discount sunset
- **Trigger**: `condition:50-workspaces-active`
- **What**: KSh 3,000/month founder pricing per PRICING.md is for first 12 months from each customer's signup. Audit and either let it auto-revert per signed terms or extend selectively.
- **Whose action**: Tim + Claude Code (billing logic)

#### DEF-035: First customer success case study
- **Trigger**: `condition:first-paying-customer-90-days-active`
- **What**: First paying customer at 90 days active gets a case study request. Used in pricing-page social proof and pitch deck. Customer gets 6 months free in exchange.
- **Whose action**: Tim

### Roadmap items not yet sprint-allocated

#### DEF-036: Repository search across reviewed contracts
- **Trigger**: `sprint:4` (the Repository sprint)
- **What**: Full-text search across a workspace's reviewed contracts with filters: type, severity, counterparty, date range, status.
- **Whose action**: Claude Code

#### DEF-037: Escalation flow to nominated external counsel
- **Trigger**: `sprint:5`
- **What**: Per workspace, configure 1-3 nominated external counsel firms. Reply with `escalate` in email or click "Escalate" in web triggers a pre-populated context email to nominated counsel with redline + analysis attached.
- **Whose action**: Claude Code

#### DEF-038: Audit log UI viewer
- **Trigger**: `sprint:5`
- **What**: `/admin/audit` for Parasol team and `/app/audit` for Business tier customers. Filterable, exportable. Schema and writes ship in Sprint 1; the UI viewer is later.
- **Whose action**: Claude Code

#### DEF-039: ROI calculator on pricing page
- **Trigger**: `sprint:7`
- **What**: Marketing site ROI calculator: input team size + monthly contract volume; output estimated counsel spend avoided. Conservative assumptions per PRICING.md.
- **Whose action**: Claude Code

#### DEF-040: Realtelligence-style content marketing newsletter
- **Trigger**: `sprint:7`
- **What**: Beehiiv newsletter for Kenyan in-house counsel. Cadence biweekly. Topics: regulatory updates, recent ODPC determinations, contract trend analysis from anonymised aggregate Parasol data.
- **Whose action**: Tim
- **Why now**: Trust-building channel that warms ICP before launch.

### Model routing and AI

#### DEF-041: Sprint 2 — A/B test Opus 4.7 on heavy reasoning stages
- **Trigger**: `sprint:2 day 1`
- **What**: With Sprint 1's eval baseline established on Sonnet 4.7, run a controlled A/B test: route `compare-playbook` and `generate-redline` to Opus 4.7, run the full eval suite, compare deltas. Adopt Opus on a stage if **all three** are true: (a) F1 (clause identification, severity-weighted) improves by ≥2 points, (b) redline appropriateness mean improves by ≥0.2/5, (c) hallucination rate drops by ≥0.5%, *and* p95 latency stays under the 60s Sprint 1 / 45s v1 launch bar. If only one or two metrics improve, document the trade-off and ask Tim to decide. If no metrics improve meaningfully, stay on Sonnet and revisit on next model release.
- **Why deferred**: Sprint 1 must ship on Sonnet to set a clean eval baseline. Switching mid-sprint contaminates the baseline and creates lock-in to a more expensive config without measurement to justify it.
- **Whose action**: Claude Code (run A/B, produce eval delta report); Tim (final adoption decision if metrics are mixed)
- **Cost impact if adopted**: per-review cost rises from ~$0.20 to ~$0.60. At v1-launch volume (~1,500 reviews/month) that's a ~$600/month delta — meaningful but trivial against revenue. v1 launch bars (F1 ≥0.88, redline ≥4.2, hallucination <1%) may be unreachable on Sonnet alone, in which case Opus adoption becomes a launch blocker rather than an optimisation.

### Payments

#### DEF-042: Sprint 7 — evaluate M-PESA acceptance options
- **Trigger**: `sprint:7` OR `condition:5-prospective-customers-blocked-by-no-mpesa`
- **What**: v1 ships Stripe-only USD billing per Path A architecture. By Sprint 7, evaluate M-PESA acceptance based on customer evidence: how many prospects flinch at USD-only? How many sign up despite it? Three options to evaluate at that point: (a) Merchant-of-Record providers like Paddle or Dodo Payments which now bundle M-PESA acceptance for non-Kenyan entities at ~5-8% all-in; (b) commercial agency arrangement with a Kenyan operator (Path B); (c) Kenyan subsidiary setup (Path C). Decision based on revenue projection from M-PESA-only segment vs setup cost vs ongoing complexity.
- **Why deferred**: v1 ICP (banks, listed mid-corporates, regulated mid-caps, NGOs) overwhelmingly pays in USD via card. Stripe-only is sufficient for the segment that matters most. Adding M-PESA before customer evidence justifies the cost (~5-8% MoR fee or equivalent setup time) is premature optimisation.
- **Whose action**: Tim (evidence assessment + decision); Claude Code (implementation of chosen path)

---

## Sprint 1 close summary (2026-05-05)

Sprint 1 carries into Sprint 2 the following items still tagged `sprint:1*`:
- **DEF-011**: register .co.ug, .co.tz, .co.rw — Tim, not blocking; carry as standing item.
- **DEF-028**: NDA playbook lawyer review — Tim engages counsel; production gate is v1 launch. Sprint 1 ships the playbook with `status: draft` flagged in the YAML and surfaced to the model in the cached system prefix.
- **DEF-046**: native Word tracked-changes for redline DOCX — code path produces visible `[REDLINE — clauseId: ...]` markers; native tracked-changes is Day 12 polish slot or post-launch.
- **DEF-047**: vision-degraded intake (rasterise scans + photographs) — Sprint 1 ships clean PDF/DOCX/text path; degraded inputs return an explainer reply.
- **DEF-048**: migrate redline DOCX bytes from inline base64 to Supabase Storage — phase v1-launch-hardening.
- **DEF-049**: SSE / RSC streaming for `/review/[id]` and `/admin/corpus` progress — phase v1-launch-hardening.

The Sprint 1 production-pipeline measurement (live latency on 3 NDAs, first true F1) is gated on deployment + `pnpm db:migrate` on the dev project. Documented in Day 13 + Day 14 HANDOFFs.

## Completed

(Move items here when done. Format: `DEF-NNN: title — completed YYYY-MM-DD by [Tim/Claude Code], notes if any`)

- **DEF-001**: Resend — enable inbound email reception on ask.parasol.co.ke — completed 2026-05-04 by Tim. MX record added at 101domain, domain verified in Resend. Webhook at `/api/inbound/email` is wired (handler classifies by recipient subdomain — intake / human-root / unexpected). End-to-end forward-an-email test queued for the day a deployed Vercel preview exists; until then the handler is exercised by unit tests only.
- **DEF-005**: Voyage AI — add payment method to lift free-tier rate limits — completed 2026-05-04 by Tim. Standard rate limits now apply; 200M-token free quota still in effect. Sprint 1 fixture corpus (six Kenya statutes, ~1,116 chunks) embedded successfully. The original Day-8 task ("calculate projected v1-launch usage from eval logs") remains relevant once Day 6+ eval-harness produces logs.
- **DEF-008**: Sentry — configure PII scrubbing — completed 2026-05-03 by Claude Code (Sprint 1 Day 1). `apps/web/src/lib/pii-scrub.ts` is the framework-agnostic scrubber wired into `sentry.{client,server}.config.ts` via `beforeSend`. Activates automatically once `SENTRY_DSN` is set in `.env.local` / Vercel.

---

## How to add a new deferred item

When a build session surfaces a task that should be deferred, Claude Code adds an entry here following the existing format:

1. Pick the next available DEF number
2. Set the Trigger to the most specific condition possible
3. Describe What and Why deferred
4. Identify whose action (Tim, Claude Code, or both)
5. Note any cost or dependency
6. Commit alongside the change that surfaced the deferral

The evaluator agent checks at session end that any "TODO post-launch" or "TODO Sprint N" comment in code has a corresponding DEFERRED.md entry.
