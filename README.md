# Parasol

AI legal copilot for in-house counsel and finance leaders at SMEs and mid-corporates across Kenya and East Africa. Reviews inbound third-party contracts (NDAs, DPAs, MSAs, SaaS terms) against playbook-encoded company positions, generates redlined responses with citations to Kenyan and EAC legal authority, and replaces the bulk of work otherwise sent to external counsel.

**Brand:** Parasol — protection from harmful sun's rays, where the rays are legal threats.
**Domain:** parasol.co.ke (.co.ug, .co.tz, .co.rw to follow)
**Entity:** Parasol Inc (Delaware) — selling cross-border to Kenyan customers via Stripe USD per Path A architecture.

## For Claude Code sessions

Read these files in order:

1. **[CLAUDE.md](./CLAUDE.md)** — Initializer spec. Stack, conventions, definition of done.
2. **[SPRINT.md](./SPRINT.md)** — Current sprint scope and acceptance criteria.
3. **[HANDOFF.md](./HANDOFF.md)** — State of the previous session.
4. **[DEFERRED.md](./DEFERRED.md)** — Run the deferred-tasks protocol per CLAUDE.md.

Then any of:

- [ROADMAP.md](./ROADMAP.md) — Sprint sequence to v1 and beyond
- [PRODUCT.md](./PRODUCT.md) — Product vision and ICP
- [BRAND.md](./BRAND.md) — Visual design system
- [PRICING.md](./PRICING.md) — Tier definitions and billing
- [ARCHITECTURE.md](./ARCHITECTURE.md) — System architecture
- [EVAL.md](./EVAL.md) — Evaluation methodology

Architecture detail in [`docs/`](./docs).

## Local setup

Prerequisites: Node 22, pnpm 9, Anthropic API key (ZDR-enabled), Voyage AI key, Supabase project (eu-west-2 with pgvector enabled), Resend account with parasol.co.ke verified.

```bash
pnpm install
cp .env.example .env.local   # populate keys
pnpm db:migrate              # supabase migrations
pnpm corpus:ingest:kenya     # populate Kenya corpus (long-running, run once)
pnpm dev                     # starts apps/web on :3000
```

## Common commands

```bash
pnpm dev               # run apps/web in dev mode
pnpm build             # build all packages and apps
pnpm typecheck         # tsc --noEmit across the workspace
pnpm lint              # eslint across the workspace
pnpm test              # vitest across packages and apps
pnpm eval              # run the eval harness against the golden dataset
pnpm eval:report       # render eval results as markdown
```

## Repository structure

```
parasol/
├── apps/
│   └── web/                  # Next.js 16 App Router (dashboard, web upload, API, admin)
└── packages/
    ├── core/                 # Shared types, repositories, errors, audit
    ├── ai/                   # Anthropic SDK wrapper, prompts, orchestration
    ├── corpus/               # kenyalaw.org ingestion, embedding, retrieval
    ├── playbooks/            # YAML playbooks + Zod schema
    └── eval/                 # Golden dataset, eval harness, scoring
```

## Stack

Turborepo + pnpm · Next.js 16 · TypeScript strict · Supabase (Postgres + pgvector + Auth + Realtime, eu-west-2 London) · Anthropic Claude (Opus 4.7 + Sonnet 4.7 + Haiku 4.5) · Voyage-3 embeddings + Voyage rerank-2 · Vercel · Resend (eu-west-1 Ireland) · Stripe (USD only in v1).

## Licence

UNLICENSED — proprietary.
