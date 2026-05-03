# Parasol Architecture

System architecture overview. Layer-specific detail in `docs/`.

## Architecture in one diagram

```
                ┌─────────────────────────────────────────┐
                │           Intake surfaces                │
                │  Email · Web upload · Mobile PWA · API   │
                └────────────────────┬────────────────────┘
                                     │
                ┌────────────────────▼────────────────────┐
                │         Format & quality routing         │
                │  Clean digital → direct text extraction │
                │  Scan/photo/messy → Sonnet vision        │
                │  Quality score per page                  │
                └────────────────────┬────────────────────┘
                                     │
                ┌────────────────────▼────────────────────┐
                │           Triage (Haiku 4.5)             │
                │  Contract type · Jurisdiction · Parties  │
                └────────────────────┬────────────────────┘
                                     │
                ┌────────────────────▼────────────────────┐
                │      Clause extraction (Haiku 4.5)       │
                │  Structured JSON of clauses & defined    │
                │  terms with hierarchy preserved          │
                └────────────────────┬────────────────────┘
                                     │
                ┌────────────────────▼────────────────────┐
                │  Playbook comparison (Sonnet 4.7 →       │
                │  Opus 4.7 candidate, Sprint 2 A/B)       │
                │  Each clause matched to playbook         │
                │  position; deviations identified         │
                └────────────────────┬────────────────────┘
                                     │
                ┌────────────────────▼────────────────────┐
                │     Authority retrieval (corpus)         │
                │  BM25 + dense vector + Voyage rerank    │
                │  Clause-type-aware filtering             │
                └────────────────────┬────────────────────┘
                                     │
                ┌────────────────────▼────────────────────┐
                │  Redline generation (Sonnet 4.7 →        │
                │  Opus 4.7 candidate, Sprint 2 A/B)       │
                │  Cited recommendations with confidence   │
                └────────────────────┬────────────────────┘
                                     │
                ┌────────────────────▼────────────────────┐
                │      Citation validator (deterministic)  │
                │  Every cite resolves in corpus or fail   │
                └────────────────────┬────────────────────┘
                                     │
                ┌────────────────────▼────────────────────┐
                │         Output assembly                  │
                │  Tracked-change .docx · Email body ·     │
                │  Web view · Audit log entry              │
                └─────────────────────────────────────────┘
```

Detail in [`docs/orchestration.md`](./docs/orchestration.md).

## Layered responsibilities

### Layer 1: Foundation models
Anthropic Claude Opus 4.7, Sonnet 4.7, and Haiku 4.5. Three-tier routing balances reasoning depth, latency, and cost.

Sonnet 4.7 is the Sprint 1 default for reasoning stages: redline reasoning, citation generation, output verification, vision extraction on degraded inputs, clause comparison against playbook.

Haiku 4.5 used for: triage and classification, quality assessment, clean-input extraction, structured clause extraction, defined-terms basic checks.

Opus 4.7 is the Sprint 2 A/B candidate for `compare-playbook` and `generate-redline` per DEF-041. Adopted on a stage only if the eval delta justifies the ~5× per-token cost and ~1.5-2× latency premium.

Stages declare a model role (`'haiku' | 'sonnet' | 'opus'`); the orchestrator resolves the role to a concrete model at call time via env var. This lets tier-based overrides (Business+ workspaces getting Opus on heavy stages, Solo on Sonnet) become a config change rather than a refactor.

No multi-vendor fallback in v1. Abstract behind `packages/ai/src/client.ts` so v2 can add fallbacks without rewrites.

### Layer 2: Knowledge corpus
The actual differentiator. Detail in [`docs/corpus-pipeline.md`](./docs/corpus-pipeline.md).

Corpus tables (Postgres):
- `corpus_documents` — top-level items (Acts, judgments, regulator determinations)
- `corpus_chunks` — section-aware chunks with parent reference
- `corpus_chunks_embedding` — pgvector column, Voyage-3 1024-dim
- `corpus_chunks_fts` — full-text search index for BM25

Sources for v1 (Kenya only):
- Constitution of Kenya 2010
- All Acts of Parliament (kenyalaw.org)
- Subsidiary Legislation
- Court of Appeal, High Court, Supreme Court judgments (last 10 years priority, then expand)
- KRA tax tribunal decisions
- ODPC determinations
- CBK prudential guidelines
- CMA notices
- Kenya Gazette weekly extracts (regulatory amendments)

v2 sources (Uganda, Tanzania, Rwanda) per ROADMAP.md.

### Layer 3: Playbooks
Proprietary IP. YAML files at `packages/playbooks/<jurisdiction>/<contract-type>.yaml`. Schema-validated via Zod at build time. Detail in [`docs/playbook-schema.md`](./docs/playbook-schema.md).

v1 playbooks (all Kenya): NDA, DPA, MSA, SaaS.

Each clause definition includes: standard position, fallback position, hard limit, market rationale, citation array. Constructed by external consulting Kenyan corporate lawyers, not Claude — this is deliberate. Budget USD 30-50k for v1 playbook construction.

### Layer 4: Retrieval
Hybrid retrieval pipeline. BM25 keyword + dense vector retrieval, merged via reciprocal rank fusion, reranked with Voyage rerank-2. Clause-type-aware filtering at retrieval time so indemnification queries return indemnification authority, not random chunks.

Implementation in `packages/corpus/src/retrieval.ts`. Public API:

```ts
retrieveAuthority(query: string, options: {
  jurisdictions: Jurisdiction[];
  clauseTypes?: ClauseType[];
  documentTypes?: DocumentType[];
  topK?: number;
  rerank?: boolean;
}): Promise<AuthorityResult[]>
```

### Layer 5: Orchestration
Pipelines, not prompts. The contract review is a series of stages, each a versioned prompt artefact under git. Stages can run in parallel where dependencies allow. Aggressive prompt caching on playbook context.

Orchestrator in `packages/ai/src/orchestrator.ts`. Each stage in `packages/ai/src/stages/`:
- `triage.ts`
- `extract-clauses.ts`
- `compare-playbook.ts`
- `generate-redline.ts`
- `verify-citations.ts`
- `assemble-output.ts`

### Layer 6: Verification
Citation validator runs on every output. Decompose Sonnet's output into individual factual claims; cross-reference each against corpus; flag inconsistencies before reaching the user. If any citation does not resolve, the pipeline regenerates that section, up to 2 retries, then falls back to a "manual review recommended" flag with confidence dropped.

Confidence calibration produced inline by Sonnet but post-validated against ground truth: high-confidence claims that fail validator drop to medium; medium that fail drop to manual-review.

### Layer 7: Evaluation
First-class concern, not retrofitted. Detail in [`EVAL.md`](./EVAL.md). Golden dataset of 100-150 real contracts with expert-validated ground truth. Eval suite runs on every change to playbooks, prompts, retrieval logic, or model routing. Hallucination rate must not regress. Citation validity floor at 100%.

## Data model (high level)

```
workspaces                  ── tenant boundary
  users                     ── many users per workspace
  playbook_overrides        ── workspace customisations to default playbooks
  external_counsel          ── nominated firms for escalation
  audit_log                 ── append-only with hash chain

reviews                     ── one contract review
  documents                 ── original + extracted + redlined files (Storage)
  extracted_clauses         ── structured JSON per clause
  issues                    ── flagged deviations with severity, citations, confidence
  citations                 ── normalised authority refs, joined to corpus
  events                    ── stage timing, retries, failures (debugging)

corpus_documents            ── Kenya/EAC legal sources
corpus_chunks               ── retrieval units
```

Detail and migrations in `apps/web/supabase/migrations/`.

## Surface architecture

| Surface | Implementation | Priority |
|---------|----------------|----------|
| Email forwarding | Resend inbound webhook → API → orchestrator → reply via Resend | v1 (P0) |
| Web upload + dashboard | Next.js 16 App Router, Supabase SSR | v1 (P0) |
| Admin — corpus management | Internal-only `/admin/corpus`; gated to `parasol_admin` role | v1 (P0) |
| Mobile PWA capture | Same Next.js codebase, mobile-optimised camera flow | v1 (P1) |
| API + SDK | Next.js API routes, OpenAPI spec | v1.5 |
| Slack bot | Slack Events API → API → orchestrator | v1.5 |
| Microsoft Teams bot | Bot Framework → API → orchestrator | v1.5 |
| Word add-in | Office.js task pane, calls API | v1.5 |
| Custom playbook editor | Next.js, schema-driven form | v1.5 |

Detail in [`docs/ux-surfaces.md`](./docs/ux-surfaces.md). Internal admin tooling in [`docs/admin-surfaces.md`](./docs/admin-surfaces.md).

## Hosting and data residency

v1 hosting:
- Web (Vercel): default routing. Edge delivery via Vercel's CloudFlare partnerships covers African users with acceptable latency.
- Database (Supabase): eu-west-2 (London). pgvector supported; ~140ms latency from Nairobi.
- AI (Anthropic): API region per Anthropic's deployment, ZDR configured.
- Email (Resend): eu-west-1 (Ireland). DKIM/SPF/DMARC verified on parasol.co.ke; inbound MX on `ask.parasol.co.ke` from Sprint 1 day 5.

v2 plan:
- Hosting migration to AWS af-south-1 (Cape Town) is documented as DEF-022, contingent on customer evidence (latency complaints or procurement-driven local-presence demand). Premature for v1.

Customer-facing data handling commitments in [`docs/data-residency.md`](./docs/data-residency.md). Sub-processor list maintained as part of the customer DPA template (DEF-014).

## Security and audit

- Supabase Row-Level Security on every table; no `service_role` use in app code outside admin scripts (DEF-009)
- Audit log append-only with cryptographic hash chain — every action by every user logged with previous-hash
- PII never in application logs; customer email addresses hashed for analytics
- Anthropic API zero-data-retention configured; verified before each release (DEF-004)
- Customer documents encrypted at rest in Supabase Storage; encrypted in transit via TLS 1.3
- Bring-your-own-key (BYOK) is a Business+ tier feature for v2

## Observability

- Vercel logs for web/API
- Supabase logs for database
- Custom event log in `audit_log` for product analytics (not tied to a third-party until volume warrants)
- Error tracking via Sentry with PII scrubbing (DEF-008)
- Eval results dashboard in `/admin/eval` (internal only)

## Deployment

- Branch deploys via Vercel for every PR
- `main` deploys to staging
- Production deploys via tagged release
- Database migrations gated through `apps/web/supabase/migrations/` with manual approval
- Eval suite runs in CI on PRs touching playbooks, prompts, retrieval, or routing — fails the PR on regression

## What this architecture explicitly is not

- Not a microservices architecture. Monolithic Next.js + shared packages. Service boundaries can be added in v3 if scale warrants.
- Not multi-cloud. Vercel + Supabase + Anthropic + Voyage + Resend + Stripe in v1. Single-vendor risk per layer accepted in exchange for velocity.
- Not multi-region in v1. EAC users hit eu-west-2 with acceptable latency. Cape Town in v2 if customer evidence demands.
- Not real-time collaborative. Two users editing the same review at once is not supported in v1. Optimistic last-write-wins.
- Not on-premise. Cloud-only product. On-premise is a v3+ Enterprise tier conversation.
- Not Kenyan-incorporated. Parasol Inc (Delaware) sells cross-border via Stripe USD per Path A, same as Legora/Harvey/Notion. Kenyan entity decision deferred to DEF-013.
