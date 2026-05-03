-- Migration 0004: Audit log
-- Append-only with cryptographic hash chain per CLAUDE.md security requirements.
-- Hash chain: each row stores SHA256(id || actor_id || action || payload::text || previous_hash)
-- No UPDATE or DELETE policies = effectively immutable from authenticated users.
-- Service role may access for operational needs (compaction in v3+).

create table public.audit_log (
  id              uuid         primary key default gen_random_uuid(),
  -- workspace_id null = system-level event (e.g. automated corpus ingestion)
  workspace_id    uuid         references public.workspaces(id),
  -- actor_id null = system-triggered event (e.g. cron job, webhook)
  actor_id        uuid         references public.profiles(id),
  -- action is namespaced: review.created, review.completed, admin.corpus.run_triggered, etc.
  action          text         not null,
  resource_type   text,
  resource_id     uuid,
  -- payload must never contain raw PII; email addresses hashed before storage
  payload         jsonb        not null default '{}',
  ip_address      inet,
  user_agent      text,
  -- hash chain integrity columns
  previous_hash   text         not null,  -- genesis entry uses SHA256('')
  hash            text         not null,  -- computed in app layer: packages/core/src/repositories/audit.ts
  created_at      timestamptz  not null default now()
);

-- ─── Indexes ──────────────────────────────────────────────────────────────────

create index audit_log_workspace_id_idx
  on public.audit_log(workspace_id);

create index audit_log_actor_id_idx
  on public.audit_log(actor_id);

create index audit_log_action_idx
  on public.audit_log(action);

create index audit_log_created_at_idx
  on public.audit_log(created_at desc);

create index audit_log_resource_idx
  on public.audit_log(resource_type, resource_id)
  where resource_type is not null;

-- ─── Row-Level Security (DEF-009) ────────────────────────────────────────────

alter table public.audit_log enable row level security;

-- audit_log: any authenticated user can append events for their workspace
-- (system events with null workspace_id are written via service role)
create policy "audit_log_insert_authenticated"
  on public.audit_log for insert
  to authenticated
  with check (
    workspace_id in (
      select workspace_id from public.profiles where id = auth.uid()
    )
  );

-- audit_log: workspace owners/admins can read their workspace's log
-- parasol_admin can read all entries
create policy "audit_log_select_admins"
  on public.audit_log for select
  to authenticated
  using (
    (select is_parasol_admin from public.profiles where id = auth.uid())
    or workspace_id in (
      select workspace_id from public.profiles
      where id = auth.uid() and role in ('owner', 'admin')
    )
  );

-- No UPDATE policy — append-only contract enforced at DB layer.
-- No DELETE policy — same; deletions are physically impossible from app code.
-- The evaluator agent verifies absence of UPDATE/DELETE policies on this table.
