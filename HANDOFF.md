# Handoff: Sprint 1, Day 5 — Playbook validator + email webhook + Day 4 acceptance test

Date: 2026-05-04
Session type: Sprint 1 Day 5

## What was completed

Day 5 scope per `docs/sprint-1-plan.md`: Zod-based playbook schema + validator + loader + CLI, Resend inbound email webhook, and the lawyer-review workaround agreed with Tim. Plus the Day 4 acceptance test (DPA s.49 in top 3) which I couldn't run on Day 4 because Voyage was rate-limited.

### Playbook infrastructure (`packages/playbooks/src/`)

- **`schema.ts`** — Zod schema mirroring `docs/playbook-schema.md`. Top-level `playbookSchema` covers `schema_version`, jurisdiction enum, contract-type enum, `display_name`, `applicable_industries`, `authored_by`, `reviewed_at` (nullable, YYYY-MM-DD), `status` enum (`production` | `draft`, defaults to `draft`), `last_updated`, and a non-empty `clauses` array. Per-clause schema enforces snake_case ids, importance enum (`critical | material | minor`), all three positions (`standard`, `fallback`, `hard_limit`) required and non-empty, and a structured citation array. Cross-clause invariants (via `superRefine`): unique clause ids; `status: production` requires non-null `reviewed_at`. Citation source enum covers `kenya-statute | kenya-case | kenya-regulation | odpc-determination | kra-ruling | cbk-circular | cma-notice | eac-treaty | market-norm | parasol-internal`. `NON_CORPUS_CITATION_SOURCES` set marks the two source types (`market-norm`, `parasol-internal`) that are intentionally not expected to resolve in the corpus.
- **`validator.ts`** — three-stage check: (1) Zod parse, (2) critical-clause citation rule (every `importance: critical` clause must have at least one citation), (3) corpus resolution (every citation with a corpus-typed source must resolve to a `corpus_documents` row by canonical id, when a `CitationResolver` is supplied). Returns a structured `ValidationResult` with per-issue `path` + `message` + `severity`. `allowDraft` (default true) downgrades the draft-status check from error → warning so CI passes while counsel review pends. `validatePlaybookFile(path)` is the disk-loading convenience wrapper.
- **`loader.ts`** — `loadPlaybook(jurisdiction, contractType)` returns a typed `Playbook` from `packages/playbooks/<jurisdiction>/<contract-type>.yaml`, throwing `NotFoundError` (file missing) or `ValidationError` (file present but malformed). Schema-only validation by default (no corpus check) for runtime use; CI runs the full corpus check via the validate CLI.
- **`cli/validate.ts`** — `pnpm --filter @parasol/playbooks run validate`. Walks `SHIPPED_PLAYBOOKS`, runs full validation (with corpus resolver if Supabase env present), prints structured issues, exits non-zero on errors. Flags: `--strict` (treat warnings as errors), `--no-corpus` (skip corpus check even when env supports it).

### Resend inbound webhook (`apps/web/src/lib/inbound/email-webhook.ts` + `apps/web/src/app/api/inbound/email/route.ts`)

The webhook lives in two layers: a framework-agnostic verification + parsing module under `lib/`, and a Next.js POST route handler. Splitting them lets the verification logic be unit-tested without spinning up a request.

**`email-webhook.ts`** exports:
- `inboundEmailPayloadSchema` — Zod schema for the `email.received` event matching Resend's documented shape (top-level `type`/`created_at`/`data`; `data` has `email_id`, `from`, `to`, `cc`, `bcc`, `message_id`, `subject`, `attachments[]`).
- `verifyInboundWebhook({ rawBody, headers, secret })` — verifies the Svix signature using the `svix` library against the **raw request bytes** (signature is byte-sensitive; re-stringifying parsed JSON breaks it), then validates the payload against the schema. Returns a discriminated union with `ok: false` reasons of `missing_headers`, `bad_signature`, `wrong_event_type`, `malformed_payload`. Outbound events (delivered/bounced/etc.) hitting the same URL are reported as `wrong_event_type` so the route handler can return 200 to acknowledge them.
- `extractEmailAddress`, `extractDomain`, `isSenderAllowed` — pure helpers. `isSenderAllowed` matches both exact domain and any subdomain of the allowlist entry (so `acme.com` matches `legal@acme.com` and `legal@subsidiary.acme.com`) and is case-insensitive.

**`route.ts`** (`POST /api/inbound/email`):
- Reads the raw body (`req.text()` — must NOT be `req.json()` because we need the exact bytes for signature verification).
- Calls `verifyInboundWebhook`. Bad signature → 401. Missing/malformed → 400. Wrong event type → 200 with `{ignored: true}` (Resend doesn't retry these). Verified → continues.
- Looks up the workspace by Sprint 1 fixed slug `sprint1-dev` (Sprint 3 will parse the slug from the recipient address per DEF-002). No workspace seeded → 200 `{ignored, reason: 'no_workspace_configured'}` so the smoke-test path stays green on a fresh project.
- Checks `isSenderAllowed(senderEmail, workspace.allowed_sender_domains)`. Not in allowlist → 200 `{ignored, reason: 'sender_not_in_allowlist'}` (will become a polite "explainer reply" in Sprint 2).
- Hashes the sender email with SHA-256 (no PII at rest) and inserts a `reviews` row in `pending` status with `intake_source: 'email'`. The actual orchestrator pipeline kick-off is a TODO for Day 9.
- Returns `200 {accepted: true, review_id}`.

### Lawyer-review workaround (`packages/playbooks/kenya/nda.yaml`)

Per Tim: he can't engage a Kenyan lawyer for Sprint 1, so the production-readiness gate moves to v1 launch. I:

- Added a `status: draft` field to the schema. Defaults to `draft`. Production = counsel-validated. Draft surfaces a warning at validate time and (per Day 9 wiring) a "Draft playbook — positions not yet counsel-validated" caption on every redline output until flipped.
- Rewrote the YAML's preamble from "PLACEHOLDER — pending counsel review" → "draft v0.1 grounded in publicly available Kenyan authority". `authored_by` reflects the same.
- Added a new `data_protection` clause covering DPA 2019 obligations (processor duties under s.42, breach notification under s.43, cross-border transfer under s.49). This is the single most important Kenya-specific clause in the playbook because the DPA is the only Kenya statute that imposes contractual constraints on confidentiality flows.
- Replaced empty / placeholder citation arrays with real ones where the statutory hook is genuinely on point: `dispute_resolution` cites Arbitration Act 1995 s.36 (NY Convention enforcement) and NCIA Act 2013 (institutional seat); `counterparts_and_execution` cites KICA 1998 (electronic transactions). Where a position is genuinely "market norm" rather than statute-derived (term length, jurisdiction allowlist, definition test), the citation is explicitly tagged `source: market-norm` rather than fabricated.
- Playbook is now 15 clauses (was 13).

### Corpus expansion (`packages/corpus/src/scrapers/kenyalaw.ts`)

Added Arbitration Act 1995 (`1995/4`) and NCIA Act 2013 (`2013/26`) to `SPRINT1_ACT_IDS` so the playbook validator's corpus-resolution check passes. Both URLs verified live. Total Sprint 1 fixture corpus is now 6 statutes (was 4): Constitution + DPA + Companies Act + KICA + Arbitration + NCIA.

Bumped `politeFetch` default timeout from 30s → 90s after observing two of the four Day-4 ingestions abort exactly at 30s (the larger statutes — DPA 600KB AKN HTML, Companies Act 1.5MB — exceed the budget once Voyage embed pipelining is in flight).

### Day 4 acceptance test — PASSED

```
query: "data protection cross-border transfer"
filters: jurisdictions=['kenya'], topK=5

#1  score=0.6445  via=[dense]
    Data Protection Act, 2019
    "Conditions for transfer out of Kenya — A data controller or
     data processor may transfer personal data to another country
     only where ..."

#2  score=0.6094  via=[dense]
    Data Protection Act, 2019
    "Safeguards prior to transfer of personal data out of Kenya"

#3  score=0.5156  via=[dense]
    Data Protection Act, 2019
    "Principles of data protection"

DPA s.49 in top 3: ✓ PASS
```

Caveat to revisit on Day 6: every result surfaced via the dense (vector) leg. BM25 didn't fire on this query, likely because the `english` Postgres FTS dictionary stems and stops the query terms differently than how they appear in the chunk text. Not a Day 4 blocker (the acceptance test is "in top 3", which we exceed) but the eval harness on Day 6 should include a query-rewriter or a stem-matched alternate to ensure BM25 contributes meaningfully on real-world legal queries.

### Tests added (53 new)

| Suite | Tests |
|-------|-------|
| `packages/playbooks/src/schema.test.ts` | 18 — citation/clause/playbook schema parsing; snake_case enforcement; status×reviewed_at invariant; duplicate-id detection; date format |
| `packages/playbooks/src/validator.test.ts` | 12 — schema layer, critical-clause rule, corpus-resolver pass/fail/skip, draft status warning vs error |
| `apps/web/src/lib/inbound/email-webhook.test.ts` | 23 — payload schema parse + defaults, Svix sign-and-verify happy path, missing headers / bad signature / tampered body / wrong secret / wrong event type / malformed payload, `extractEmailAddress`/`extractDomain`/`isSenderAllowed` (8 cases including subdomain matching, case-insensitivity, substring trap) |

Cumulative repo test count: **202 passing across 6 packages** (+53 today).

## Verification evidence

```
pnpm turbo typecheck test lint
→ 18 successful, 18 total
→ Zero TS errors, zero lint warnings, 202 tests passing

pnpm --filter @parasol/playbooks run validate -- --no-corpus
→ kenya/nda.yaml: 0 errors, 1 warning (draft status, expected)
→ "ok (15 clauses, schema-only, status=draft)"

Day 4 acceptance test (manual TSX script against live Supabase):
→ DPA cross-border transfer query returns DPA 2019 s.49 at #1 (dense, score 0.6445)
→ DPA s.49 in top 3: ✓ PASS
```

## Database state

All 6 migrations applied. corpus_documents has the Constitution, DPA 2019, and KICA ingested (Companies Act ingest still in progress as of this writeup). Total chunks: ~469 with 311 embedded. `pending` ingestions: Companies Act 2015 (2015/17), Arbitration Act 1995 (1995/4 — added today), NCIA Act 2013 (2013/26 — added today).

## What is NOT done

- **Companies Act 2015, Arbitration Act 1995, NCIA Act 2013 ingestion** — three statutes still need to land in the corpus. Two of them are referenced by the playbook's citations, so the *full corpus-resolution* validator pass currently shows 2 errors (will go to 0 once they ingest). Schema-only validation is clean. Re-run with `pnpm --filter @parasol/corpus run ingest:kenya -- --skip-unchanged` once the in-flight task completes.
- **Real Resend inbound MX configuration on `ask.parasol.co.ke`** — Tim is working on this now (DEF-001). Once DNS verifies, an end-to-end forward-an-email test becomes possible.
- **`sprint1-dev` workspace seed row** — webhook handler returns `200 {ignored: 'no_workspace_configured'}` until a workspace with that slug exists. Seed migration deferred to Day 8 alongside the broader workspace bootstrap. For end-to-end email tests before then, manually insert a row with that slug + an allowed_sender_domains array.
- **Lawyer counsel review of `kenya/nda.yaml`** (DEF-028, status: still open). Per Tim's instruction the workaround is in place and Sprint 1 ships with `status: draft`. The hard deadline moved from Day 5 to v1 launch.
- **Email orchestrator kickoff** — webhook creates a `pending` review and returns 200; actual pipeline run is queued for Day 9 once the orchestrator stages are wired.
- BM25 contribution to retrieval is currently zero on natural-language queries due to FTS dictionary mismatch. Address in Day 6 (eval harness) or note as a tuning issue.

## DEFERRED.md updates

No new entries today. DEF-005 (Voyage payment method) is now resolved: Tim added a card and the embedder works at standard limits. DEF-001 (Resend MX) is in progress as of this writeup.

## Exact next step (Day 6) — Eval harness skeleton

Day 6 plan from `docs/sprint-1-plan.md`:
1. `packages/eval/src/runner.ts` — load golden NDAs from `packages/eval/data/golden/nda/`, run the full pipeline (stub stages where Day 7+ hasn't landed yet), collect per-NDA scores.
2. `packages/eval/src/metrics.ts` — clause identification precision/recall, redline appropriateness (1-5), citation validity rate, hallucination rate.
3. `packages/eval/src/reporter.ts` — write `packages/eval/results/sprint-1.json`; print summary table.
4. `packages/eval/data/golden/nda/` — ground-truth annotation YAML schema + at least 5 annotated NDAs (full 20 by Day 13). I'll draft annotations from the NDA + the Kenya playbook; counsel review of the annotations is a separate v1-launch gate.
5. CI eval gate in `.github/workflows/ci.yml` — fail PR if citation validity drops below 100% or hallucination rate rises above 2%.
6. `pnpm eval` runs successfully (even against a stub pipeline).

Day 6 has no Tim action items.

## Tim action items still open

- **DEF-001 (Resend inbound MX)** — in progress as of this writeup. Once DNS propagates and the domain shows "Verified" in Resend, the inbound endpoint is fully testable end-to-end.
- **DEF-028 (Kenyan lawyer counsel review)** — moved from Day 5 hard deadline → v1 launch hard deadline per Tim's "work around it" instruction. No immediate action; pre-launch the playbook content needs counsel sign-off before flipping to `status: production`.
- **DEF-011 (.co.ug, .co.tz, .co.rw domain registration)** — was Day 1 Tim action; status unknown to me. Not blocking Sprint 1 but blocks v2 jurisdiction expansion.
