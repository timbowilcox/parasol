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

#### DEF-001: Resend — enable inbound email reception on ask.parasol.co.ke
- **Trigger**: `sprint:1 day 5`
- **What**: Toggle "Enable Receiving" in Resend's UI for the parasol.co.ke domain. Add the inbound MX record Resend provides — placed on the `ask` subdomain at 101domain (Name: `ask`, Type: MX, Value as Resend specifies). Confirm webhook URL in Resend's webhook config matches the deployed Vercel endpoint at `https://app.parasol.co.ke/api/inbound/email`.
- **Why deferred**: Inbound configuration depends on the route handler at `apps/web/src/app/api/inbound/email/route.ts` actually existing and being deployed. Sprint 1 day 5 is when that endpoint becomes real.
- **Whose action**: Tim (Resend UI + 101domain DNS), Claude Code (route handler implementation)
- **Notes**: Webhook is already created in Resend pointing at the placeholder URL. Signing secret is already in `.env.local` as `RESEND_INBOUND_WEBHOOK_SECRET`. The remaining steps are toggling receiving on, adding the MX record, and verifying.

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

#### DEF-005: Voyage AI — confirm rerank-2 quota before Sprint 1 closes
- **Trigger**: `sprint:1 day 8`
- **What**: Check Voyage AI dashboard for monthly rerank-2 usage. Eval suite runs against 20 NDAs, each retrieval reranks ~30 chunks; sprint 1 should consume well under free tier. If projected v1 launch usage exceeds free tier, upgrade plan during Sprint 7.
- **Whose action**: Tim (read dashboard), Claude Code (calculate projected usage from eval logs)

#### DEF-006: Stripe — activate live account and configure tax handling
- **Trigger**: `sprint:3 day 1`
- **What**: Sandbox keys retrieved (stored in Tim's password manager). Sprint 3: complete Stripe live activation for Parasol Inc (Delaware); configure US tax compliance via Stripe Tax for Delaware; configure Kenya VAT collection on cross-border digital services (1.5% DST per Kenya Finance Act); set USD as primary currency; configure invoice templates with Parasol Inc as merchant of record. Wire sandbox keys for Sprint 3 development; switch to live keys at Sprint 8 launch.
- **Whose action**: Tim (Stripe dashboard + Delaware business documents)

#### DEF-008: Sentry — configure PII scrubbing
- **Trigger**: `sprint:1 day 1`
- **What**: Sentry account already exists; configure `beforeSend` hook in `apps/web/sentry.config.ts` to scrub email addresses, document content, and any field marked sensitive. Test with a deliberate test error containing fake PII.
- **Why deferred**: Sentry can't be added safely without scrubbing; scrubbing config is part of initial setup.
- **Whose action**: Claude Code (implement during Sprint 1)

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

## Completed

(Move items here when done. Format: `DEF-NNN: title — completed YYYY-MM-DD by [Tim/Claude Code], notes if any`)

(none yet)

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
