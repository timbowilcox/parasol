# Admin Surfaces

Internal-only tooling. Not customer-facing. Gated to Parasol team accounts via the `parasol_admin` role.

## Surfaces

| Route | Purpose | Sprint |
|-------|---------|--------|
| `/admin/corpus` | Corpus management — sources, schedules, runs, pending diffs | Sprint 1 (read-only + manual run); Sprint 4 (full); Sprint 5 (diff review) |
| `/admin/eval` | Eval results dashboard, golden dataset management, A/B test runner | Sprint 2 |
| `/admin/observability` | Per-stage timing, token cost, cache hit rate, retry distribution | Sprint 7 |
| `/admin/workspaces` | Workspace inspector — usage, plan, audit log, support actions | Sprint 5 |
| `/admin/playbooks` | Default playbook authoring and version control | Sprint 2 |
| `/admin/audit` | Internal audit log across all admin actions | Sprint 5 |

All admin surfaces share the layout and design system from `BRAND.md`. Distinctive: amber pill in nav (`Internal · admin`) so screenshots aren't confused with customer surfaces.

## /admin/corpus (Sprint 1 P0)

**Why this is P0 in Sprint 1:** the corpus is the moat. We must be able to operate it from day one — see what's ingested, when it last ran, whether sources are healthy, manually trigger an ingestion when something looks wrong.

**Page anatomy:** Health summary (4 stats: total documents, total chunks, healthy sources, pending diffs) → Sources list (per-source status, schedule, last run, doc count, action buttons) → Recent runs (last 7 days). Matches the `parasol_corpus_admin` design from chat artefacts (2026-05-03).

**Source row data shape:**

```ts
interface CorpusSource {
  id: string;
  name: string;                    // 'kenyalaw.org — Acts of Parliament'
  category: 'statute' | 'case' | 'regulation' | 'gazette' | 'tribunal';
  jurisdiction: 'kenya' | 'uganda' | 'tanzania' | 'rwanda';
  scraperPath: string;             // 'packages/corpus/src/scrapers/kenyalaw-acts.ts'
  schedule: CronExpression | 'manual';
  lastRunAt: Date | null;
  lastRunStatus: 'healthy' | 'warning' | 'error' | 'never-run';
  documentCount: number;
  chunkCount: number;
  pendingDiffCount: number;
}
```

**Actions per source:**

- **Run now** — triggers immediate incremental ingestion. State streams in the UI: queued → running → healthy/warning/error.
- **View runs** — drills into last 30 runs for this source.
- **View pending diffs** (Sprint 5+) — drills into the diff review queue if any items pending.
- **Edit schedule** (Sprint 4) — when full schedule editing lands. Sprint 1 displays schedule read-only.

**Sprint 1 scope:**
- Read-only health summary, sources list, recent runs panel
- Per-source "Run now" button writing to a job queue
- Recent runs panel updates as runs complete
- All admin actions write to `audit_log` with action namespace `admin.corpus.*`

**Sprint 4 scope (DEF-017, DEF-018):**
- Schedule editor inline (cron expression with human-readable preview)
- Vercel Cron wired to actually execute scheduled runs
- Daily job for kenyalaw.org incremental judgments and statute amendments
- Weekly job for Kenya Gazette diff scan

**Sprint 5 scope (DEF-019):**
- Pending-diff review screen at `/admin/corpus/diffs`
- Side-by-side diff rendering of old vs new ingested version
- Promote / reject / fork actions
- Diffs above 10% threshold automatically queued; below threshold auto-promoted with audit entry

**Routing:** `apps/web/src/app/admin/corpus/page.tsx` (list) and `apps/web/src/app/admin/corpus/[sourceId]/page.tsx` (drill-in). API at `apps/web/src/app/api/admin/corpus/{sources,runs,diffs}/route.ts`.

## /admin/eval (Sprint 2 P0)

Why P0 by Sprint 2: with four contract types in scope and the Opus A/B test running per DEF-041, eval is too important to inspect via terminal output alone.

**Page anatomy:**

- Latest run summary: per-contract-type metrics (F1, redline appropriateness, citation validity, hallucination rate, p95 latency)
- Trend chart: last 30 runs across the metrics
- Failure case browser: drills into specific failed cases with model output, ground truth, diff, model version, prompt version, playbook version
- A/B test panel: configure a model-routing override, run subset of dataset, compare deltas
- Acceptance bar status: green/yellow/red against current sprint's bar

Critical UX: clicking a failure case shows the full pipeline trace, not just final output. Triage decisions, clause extraction JSON, playbook comparison reasoning, retrieval results, redline output, citation validation results — all visible.

## /admin/observability (Sprint 7+)

Operational metrics. Per-stage timing histograms, token cost trend, cache hit rate, retry distribution, error rate by stage. Wires Sentry events and Anthropic API metadata for cost attribution.

**Tier-aware cost reporting:** cost per review broken down by Solo / Team / Business tier so model-routing decisions can be informed by per-tier economics. If Opus is enabled for Business tier only (per DEF-041), this surface shows whether the per-tier margin justifies it.

## /admin/workspaces (Sprint 5)

Workspace inspector for support and billing tasks. Search by domain, slug, contact email. Per-workspace view: plan, billing status, seat usage, review volume, last activity, audit log, support notes.

Specific support actions: extend trial, manually grant tier upgrade, override seat count for short-term pilots, soft-pause a workspace pending payment resolution.

## /admin/playbooks (Sprint 2)

Default playbook editor for the Parasol team's consulting counsel relationship. Distinct from the customer-facing `/app/playbooks/edit` (DEF-029, v1.5).

Sprint 2 ships a thin version: list playbooks, view YAML inline, mark a version as "lawyer-reviewed" with reviewer name and date. Full editing remains in IDE for the consulting counsel relationship; v2+ extends this to in-product authoring once we have multiple consulting lawyers.

## /admin/audit (Sprint 5)

Cross-workspace audit log of admin actions. Append-only with hash chain. Filterable by actor, action namespace, time range. Exportable.

## Routing and authorisation

- All `/admin/*` routes guarded by middleware that requires the user's workspace role to include `parasol_admin`
- Non-admin users hitting `/admin/*` get a 404 (not a 401 — surface intentionally undiscoverable)
- All admin actions write to `audit_log` with the actor's user ID, the action namespace (`admin.corpus.run`, `admin.eval.run`, `admin.workspace.extend-trial`, etc.), and a structured payload

## Design notes

- Reuses customer-side BRAND.md design system unchanged
- Distinctive: amber pill in nav (`Internal · admin`) so screenshots aren't confused with customer surfaces
- No live data on dashboards — refresh-driven. Avoid websocket complexity until v2.
- Tabular density higher than customer surfaces (admins read tables, customers don't)
- Empty states explain what would normally be there ("No runs in the last 7 days. Click Run now on any source to trigger ingestion.")
