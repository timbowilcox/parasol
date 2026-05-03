-- Migration 0001: Foundation
-- pgvector extension, workspaces, profiles, playbook_overrides
-- RLS policies on every table per CLAUDE.md mandate (DEF-009)

-- Required extensions
create extension if not exists "uuid-ossp";
create extension if not exists "pgcrypto";
create extension if not exists "vector";

-- ─── workspaces (tenant boundary) ────────────────────────────────────────────

create table public.workspaces (
  id                    uuid         primary key default gen_random_uuid(),
  slug                  text         not null unique,
  name                  text         not null,
  tier                  text         not null default 'solo'
                                     check (tier in ('solo', 'team', 'business')),
  seat_limit            int          not null default 1,
  allowed_sender_domains text[]      not null default '{}',
  timezone              text         not null default 'Africa/Nairobi',
  created_at            timestamptz  not null default now(),
  updated_at            timestamptz  not null default now()
);

-- ─── profiles (extends auth.users) ───────────────────────────────────────────

create table public.profiles (
  id                uuid         primary key references auth.users(id) on delete cascade,
  workspace_id      uuid         not null references public.workspaces(id) on delete cascade,
  full_name         text,
  role              text         not null default 'member'
                                 check (role in ('owner', 'admin', 'member')),
  is_parasol_admin  boolean      not null default false,
  created_at        timestamptz  not null default now(),
  updated_at        timestamptz  not null default now()
);

-- ─── playbook_overrides (workspace customisations; UI in v1.5 per DEF-029) ──

create table public.playbook_overrides (
  id                uuid         primary key default gen_random_uuid(),
  workspace_id      uuid         not null references public.workspaces(id) on delete cascade,
  jurisdiction      text         not null,
  contract_type     text         not null,
  clause_id         text         not null,
  field             text         not null check (field in ('standard', 'fallback', 'hard_limit')),
  override_value    text         not null,
  override_rationale text,
  created_by        uuid         references public.profiles(id),
  created_at        timestamptz  not null default now(),
  updated_at        timestamptz  not null default now(),
  unique (workspace_id, jurisdiction, contract_type, clause_id, field)
);

-- ─── Indexes ──────────────────────────────────────────────────────────────────

create index profiles_workspace_id_idx
  on public.profiles(workspace_id);

create index playbook_overrides_workspace_id_idx
  on public.playbook_overrides(workspace_id);

create index playbook_overrides_lookup_idx
  on public.playbook_overrides(workspace_id, jurisdiction, contract_type);

-- ─── Row-Level Security (DEF-009: every table, same migration) ───────────────

alter table public.workspaces enable row level security;
alter table public.profiles enable row level security;
alter table public.playbook_overrides enable row level security;

-- workspaces: authenticated users can read their own workspace only
create policy "workspaces_select_own"
  on public.workspaces for select
  to authenticated
  using (
    id in (
      select workspace_id from public.profiles where id = auth.uid()
    )
  );

-- profiles: authenticated users can read all profiles in their workspace
create policy "profiles_select_own_workspace"
  on public.profiles for select
  to authenticated
  using (
    workspace_id in (
      select workspace_id from public.profiles where id = auth.uid()
    )
  );

-- profiles: users can insert their own profile row (created on signup)
create policy "profiles_insert_own"
  on public.profiles for insert
  to authenticated
  with check (id = auth.uid());

-- profiles: users can update their own profile only
create policy "profiles_update_own"
  on public.profiles for update
  to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- playbook_overrides: workspace members can read
create policy "playbook_overrides_select_workspace"
  on public.playbook_overrides for select
  to authenticated
  using (
    workspace_id in (
      select workspace_id from public.profiles where id = auth.uid()
    )
  );

-- playbook_overrides: workspace owners/admins can insert
create policy "playbook_overrides_insert_admin"
  on public.playbook_overrides for insert
  to authenticated
  with check (
    workspace_id in (
      select workspace_id from public.profiles
      where id = auth.uid() and role in ('owner', 'admin')
    )
  );

-- playbook_overrides: workspace owners/admins can update
create policy "playbook_overrides_update_admin"
  on public.playbook_overrides for update
  to authenticated
  using (
    workspace_id in (
      select workspace_id from public.profiles
      where id = auth.uid() and role in ('owner', 'admin')
    )
  )
  with check (
    workspace_id in (
      select workspace_id from public.profiles
      where id = auth.uid() and role in ('owner', 'admin')
    )
  );

-- playbook_overrides: workspace owners can delete
create policy "playbook_overrides_delete_owner"
  on public.playbook_overrides for delete
  to authenticated
  using (
    workspace_id in (
      select workspace_id from public.profiles
      where id = auth.uid() and role = 'owner'
    )
  );
