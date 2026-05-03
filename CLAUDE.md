# Parasol — Claude Code Initializer

This file is the harness initializer for Claude Code sessions on Parasol. It encodes assumptions and decisions you should operate under without re-deriving. Read this first, then SPRINT.md, then HANDOFF.md, then run the deferred-tasks protocol against DEFERRED.md.

---

## What this codebase is

Parasol is an AI legal copilot for in-house counsel and finance leaders at SMEs and mid-corporates across Kenya, Uganda, Tanzania, and Rwanda. It reviews inbound third-party contracts (NDAs, DPAs, MSAs, SaaS terms) against playbook-encoded company positions, generates redlined responses with citations to Kenyan and EAC legal authority, and replaces the bottom 60-70% of work otherwise sent to external counsel.

Brand: **Parasol** — protection from harmful sun's rays, where the rays are legal threats. Domain: parasol.co.ke (.co.ug, .co.tz, .co.rw to follow).

## Who buys this

ICP: Solo GCs, 3-15 person in-house legal teams, finance leaders with legal-adjacent sign-off, founders at scaleups, NGO operations leads. Tier examples: Equity Bank mid-corporate desks, M-KOPA, Sun King, Wasoko, EABL regional, Britam mid-corporate, Aga Khan University, Strathmore, listed mid-caps on the NSE.

NOT the ICP: Bowmans, A&K, Cliffe Dekker, Kaplan & Stratton. Large law firms are eventual referral partners through the escalate-to-counsel flow, not customers.

## Strategic premises (non-negotiable)

1. **Self-serve only.** No demo required for any tier. The product is its own salesperson. If a feature can't be configured by the user, it doesn't ship.
2. **Trust is the moat.** Every flagged clause cites verifiable Kenyan or EAC authority (statute, case, regulator determination). Calibrated confidence (high/medium/manual-review-recommended) is surfaced in the UI. Audit log on every action.
3. **Local context is the moat.** Kenya-specific playbooks, EAC jurisdictional awareness, KRA/ODPC/CBK regulatory grounding. Global competitors will eventually localise but won't bother for years; that gap is the window.
4. **Email is the front door.** Web upload and mobile PWA capture are equal-priority intake surfaces. Word add-in is v1.5, not v1. Slack/Teams bot is v1.5.
5. **Format-agnostic intake.** PDF (digital), PDF (scanned), photographs of paper, .docx, Google Docs links, pasted text. The Kenyan SME reality includes scans and phone photos; we serve them natively.
6. **No managed services arm.** Pure SaaS only. Robin AI's collapse is the cautionary tale — managed services compresses gross margin and competes with the AI it depends on. Refer escalations to nominated external counsel; do not employ lawyers.
7. **Path A entity architecture.** Parasol Inc (Delaware). No Kenyan entity in v1. Sells across borders to Kenyan customers in USD via Stripe. Same playbook as Legora, Harvey, Notion, Figma. Local presence is documented in DEFERRED.md as a customer-driven decision (DEF-013, DEF-022) — not a v1 default.

## Stack

| Layer | Choice | Notes |
|-------|--------|-------|
| Monorepo | Turborepo + pnpm | Same pattern as Kounta, mm-hub, SoloDesk |
| Web | Next.js 16 (App Router) | TypeScript strict |
| Database | Postgres on Supabase | pgvector for embeddings; eu-west-2 (London) for v1 |
| Embeddings | Voyage-3 (1024 dims) + Voyage rerank-2 | Same as SoloDesk |
| AI | Anthropic SDK only | Opus 4.7 + Sonnet 4.7 + Haiku 4.5; no multi-vendor in v1 |
| Auth | Supabase Auth | Email + Microsoft + Google OAuth |
| Hosting | Vercel | Default routing for v1; af-south-1 plan in `docs/data-residency.md` for v2 |
| Email | Resend | eu-west-1 (Ireland); workspace-prefixed inbound aliases at ask.parasol.co.ke (Sprint 1) → ask@\<workspace\>.parasol.co.ke (Sprint 3) |
| Payments | Stripe (USD only, v1) | M-PESA acceptance evaluated in Sprint 7 based on demand signal — see DEF-042 |

## Architecture decisions made

- **Vision-first OCR.** Claude vision (Sonnet 4.7 for degraded inputs, Haiku 4.5 for clean) handles all document extraction including scans and photos. No Mistral OCR, no Document AI, no Tesseract. Architecture detail: `docs/intake-pipeline.md`.
- **Three-tier model routing.** Haiku 4.5 does triage, classification, and clean-input extraction. Sonnet 4.7 is the Sprint 1 default for reasoning stages (compare-playbook, generate-redline, verify-citations, degraded vision). Opus 4.7 is the Sprint 2 A/B candidate for compare-playbook and generate-redline; adopted only on positive eval delta per DEF-041. Stages declare a model role, not a specific model. Routing detail: `docs/orchestration.md`.
- **Hybrid retrieval.** BM25 + dense vector retrieval, merged via reciprocal rank fusion, reranked with Voyage rerank-2. Clause-type-aware tagging at ingest.
- **Playbooks as YAML, not prompts.** Structured, versioned, lawyer-editable. Schema in `docs/playbook-schema.md`. Sample at `packages/playbooks/kenya/nda.yaml`.
- **Citation validator runs on every output.** Anything claiming "DPA 2019 s.40" must resolve in the corpus or the redline regenerates. Hard requirement, not a best-effort.
- **Aggressive prompt caching on playbook context.** Playbooks rarely change within a session. Cache them.
- **Stripe-only billing in v1.** USD only. KSh price displays on the marketing page convert at locked rate. M-PESA acceptance via MoR (Paddle/Dodo) or local-entity setup is a Sprint 7+ decision contingent on customer evidence — see DEF-042.

## Pricing (locked)

- Solo: KSh 6,000/month or KSh 60,000/year (single seat) — billed in USD via Stripe at locked KES/USD rate
- Team: KSh 12,000/seat/month (2-seat min) — same
- Business: KSh 40,000/seat/month (5-seat min) — same

Detail and overage logic in `PRICING.md`. Self-serve checkout for all three tiers. SSO, custom roles, API access, dedicated CSM are Business-only — these are the upgrade forcing functions.

## What "done" looks like in this codebase

Definition of done is binary, not subjective.

1. Acceptance criteria in SPRINT.md are checked with proof (test output, screenshot, curl result, eval harness pass).
2. TypeScript: zero errors. Run `pnpm typecheck` from root.
3. Tests: written and passing. Coverage on new modules ≥80%. Run `pnpm test` from root.
4. Lint: clean. Run `pnpm lint` from root.
5. Eval harness: any change touching playbooks, prompts, retrieval, or model routing must run the eval suite and report deltas. Hallucination rate must not regress. Citation validity must remain 100%.
6. HANDOFF.md updated with what was completed, what is NOT done, exact next step.
7. DEFERRED.md hygiene maintained: every new TODO has a corresponding DEF entry; sprint-relevant items surfaced at kickoff.
8. Committed to git with meaningful message (no "wip" or "fix stuff" — the message reads as a changelog entry).
9. No console.log, no commented-out code, no `any` types unless documented why.

If any of the above is false, the session is not done. Do not claim completion.

## Quality grading rubric (per session)

Every Claude Code session output is graded against:

| Criterion | Weight | Pass threshold |
|-----------|--------|----------------|
| Acceptance criteria met with evidence | 25% | All ticked, evidence cited |
| Code matches existing codebase patterns | 15% | Reviewer can't tell where boundaries are |
| Tests written, meaningful, passing | 20% | Coverage ≥80%, asserts behaviour not implementation |
| Eval harness clean (where applicable) | 15% | No regression on any metric |
| HANDOFF.md complete and honest | 10% | Includes what's NOT done |
| DEFERRED.md hygiene | 5% | Every TODO has a DEF entry; sprint-relevant items surfaced at kickoff |
| TypeScript strict, lint clean | 5% | Zero warnings |
| Commit hygiene | 5% | Logical chunks, descriptive messages |

The evaluator agent (separate session) scores against this rubric. Anything below 90% goes back for fix.

## Conventions

**Naming.** kebab-case for files, PascalCase for components, camelCase for functions and variables, UPPER_SNAKE for env vars. Database tables snake_case plural. Routes kebab-case.

**Auth.** Supabase Auth via SSR helpers in `apps/web`. Server actions for mutations. Row-level security policies on every table — no `service_role` use in app code outside admin scripts.

**Data access.** Repository pattern in `packages/core/src/repositories/*`. Never call Supabase client directly from components. API routes thin, repositories thick.

**Errors.** Throw `AppError` subclasses (defined in `packages/core/src/errors`). Never throw strings. Server actions return discriminated unions, not exceptions, for expected failures.

**AI calls.** All Anthropic SDK calls go through `packages/ai/src/client.ts`. Never instantiate the client directly elsewhere. Prompts are versioned in `packages/ai/src/prompts/*` and tested in eval. Stages declare a `modelRole` (`'haiku' | 'sonnet' | 'opus'`); the orchestrator resolves role to model at call time.

**Citations.** Every authority reference is a structured object `{ source: 'kenya-statute' | 'kenya-case' | 'odpc-determination' | ..., id: string, section?: string, url: string }`. Stringly-typed citations are forbidden.

**Playbooks.** YAML in `packages/playbooks/<jurisdiction>/<contract-type>.yaml`. Schema-validated at build time via Zod. Lawyer-editable through the UI in v1.5; v1 is YAML-as-source-of-truth.

## Sensitive operations

- Customer documents are processed by Anthropic via the Claude API under a Zero Data Retention agreement. ZDR is verified before each release per DEF-004.
- Audit log writes are append-only, with cryptographic hash chain. See `packages/core/src/audit`.
- No PII in logs, ever. Customer email addresses are hashed for analytics.
- Customer-facing data handling commitments documented in `docs/data-residency.md` (framed as procurement-ready, not regulator-mandated — Path A architecture).

## Pointers

| File | Purpose |
|------|---------|
| `SPRINT.md` | Current sprint scope and acceptance criteria |
| `HANDOFF.md` | State of last session (read after SPRINT.md) |
| `DEFERRED.md` | Register of intentionally deferred tasks; consult at every sprint kickoff |
| `ROADMAP.md` | Sprint sequence to v1 launch and v2 |
| `PRODUCT.md` | Product vision, ICP, feature surface |
| `BRAND.md` | Visual design system, voice, logo usage |
| `PRICING.md` | Tier definitions, overage logic, billing flow |
| `ARCHITECTURE.md` | System architecture overview |
| `EVAL.md` | Evaluation methodology and metrics |
| `docs/playbook-schema.md` | Playbook YAML schema reference |
| `docs/corpus-pipeline.md` | Corpus ingestion architecture |
| `docs/orchestration.md` | AI pipeline architecture |
| `docs/intake-pipeline.md` | Document intake and OCR routing |
| `docs/ux-surfaces.md` | Email, web, mobile, Word add-in surfaces |
| `docs/admin-surfaces.md` | Internal admin tooling (corpus management, eval, observability) |
| `docs/competitive-landscape.md` | What we know about competitors |
| `docs/data-residency.md` | Customer-facing data handling commitments |

## What you should refuse to do

- Begin building without an acknowledged SPRINT.md.
- Skip the deferred-tasks protocol at sprint kickoff.
- Declare a session "done" without evidence against acceptance criteria.
- Add a managed services arm or any human-in-the-loop product layer.
- Add multi-vendor AI fallbacks in v1.
- Add a Kenyan entity, ODPC registration, or local processor (Flutterwave, Pesapal, DPO) without explicit user direction — these are Path B/C decisions deferred to v1.5+ pending customer evidence.
- Build the Word add-in before the email and web surfaces are solid.
- Ship anything that bypasses the citation validator.
- Mock the citation validator in tests instead of running it.
- Use `any` in TypeScript without a comment explaining why.
- Skip the eval suite on changes that touch playbooks, prompts, retrieval, or routing.
- Ship UI that uses the brand amber decoratively. Amber is the brand mark only.

When in doubt, stop and ask in HANDOFF.md rather than guess.

## Deferred-tasks protocol

DEFERRED.md is the single source of truth for everything intentionally postponed. Treat it as binding, not advisory.

**At the start of every sprint:**

1. Read DEFERRED.md in full
2. Filter entries whose Trigger condition matches the current sprint number, current phase, or current state
3. Surface them to Tim before any other Sprint planning conversation, formatted as:
   ```
   Deferred items now relevant to Sprint <N>:
   - DEF-NNN: <title> — <whose action> — <one-line summary>
   ```
4. For Tim-action items (third-party UI changes, DNS updates, account configuration): prompt Tim to do them and wait for explicit confirmation before proceeding with the sprint
5. For Claude-Code-action items (implementation work): add them to that sprint's SPRINT.md acceptance criteria in the appropriate section
6. For coordinated items: split the work and confirm both halves before proceeding

**During every sprint:**

If a build session surfaces a task that should be deferred, add it to DEFERRED.md as a new DEF-NNN entry in the same commit that introduced the surfacing. Do not leave naked `TODO post-launch` comments in code without a corresponding DEFERRED.md entry — the evaluator agent checks for this.

**At every session end:**

Update HANDOFF.md with any deferred items that were actioned during the session, marking them complete in DEFERRED.md by moving the entry to the "Completed" section (do not delete; we keep audit history).

**At every release:**

Surface all `phase:v1-launch-hardening`, `annually`, and `quarterly` items whose triggers fire. Block the release until Tim has acknowledged each one.
