-- Migration 0003: Reviews
-- reviews, review_documents, extracted_clauses, issues, citations, pipeline_events
-- All tables workspace-scoped with RLS

-- ─── reviews (one contract review) ───────────────────────────────────────────

create table public.reviews (
  id                uuid         primary key default gen_random_uuid(),
  workspace_id      uuid         not null references public.workspaces(id) on delete cascade,
  created_by        uuid         not null references public.profiles(id),
  contract_type     text,
  jurisdiction      text         not null default 'kenya',
  status            text         not null default 'pending'
                                 check (status in (
                                   'pending', 'processing', 'completed', 'failed', 'unsupported'
                                 )),
  -- versions snapshot the config at review time for replay / audit
  playbook_version  text,
  corpus_version    text,
  -- intake metadata
  intake_source     text         not null check (intake_source in ('web', 'email', 'api')),
  sender_email      text,         -- hashed on write via app layer; raw value never stored
  original_filename text,
  error_message     text,
  created_at        timestamptz  not null default now(),
  updated_at        timestamptz  not null default now()
);

-- ─── review_documents (storage references for original + extracted + redlined) ─

create table public.review_documents (
  id              uuid         primary key default gen_random_uuid(),
  review_id       uuid         not null references public.reviews(id) on delete cascade,
  document_type   text         not null
                               check (document_type in ('original', 'extracted', 'redlined')),
  storage_path    text         not null,
  mime_type       text         not null,
  byte_size       int,
  created_at      timestamptz  not null default now()
);

-- ─── extracted_clauses (structured output from extract-clauses stage) ─────────

create table public.extracted_clauses (
  id                uuid         primary key default gen_random_uuid(),
  review_id         uuid         not null references public.reviews(id) on delete cascade,
  -- clause_id matches playbook clause id, or 'unknown_<n>' for unrecognised clauses
  clause_id         text         not null,
  display_name      text         not null,
  clause_type       text,
  raw_text          text         not null,
  section_reference text,
  clause_order      int          not null,
  created_at        timestamptz  not null default now()
);

-- ─── issues (flagged deviations from playbook) ───────────────────────────────

create table public.issues (
  id                    uuid         primary key default gen_random_uuid(),
  review_id             uuid         not null references public.reviews(id) on delete cascade,
  extracted_clause_id   uuid         references public.extracted_clauses(id),
  clause_id             text         not null,
  severity              text         not null check (severity in ('critical', 'material', 'minor')),
  confidence            text         not null
                                     check (confidence in (
                                       'high', 'medium', 'manual_review_recommended'
                                     )),
  current_position      text         not null,
  recommended_position  text         not null,
  reasoning             text         not null,
  redline_text          text,
  issue_order           int          not null,
  created_at            timestamptz  not null default now()
);

-- ─── citations (normalised authority references linked to issues) ─────────────

create table public.citations (
  id                uuid         primary key default gen_random_uuid(),
  issue_id          uuid         not null references public.issues(id) on delete cascade,
  corpus_chunk_id   uuid         references public.corpus_chunks(id),
  source_type       text         not null,
  canonical_id      text         not null,
  section           text,
  display_text      text         not null,
  source_url        text,
  -- validated = true only after citation-validator stage confirms resolution in corpus
  validated         boolean      not null default false,
  validation_error  text,
  created_at        timestamptz  not null default now()
);

-- ─── pipeline_events (stage timing and observability; debug data) ─────────────

create table public.pipeline_events (
  id                  uuid         primary key default gen_random_uuid(),
  review_id           uuid         not null references public.reviews(id) on delete cascade,
  stage               text         not null,
  status              text         not null
                                   check (status in ('started', 'completed', 'failed', 'retried')),
  model_role          text,
  model_id            text,
  prompt_version      text,
  input_tokens        int,
  output_tokens       int,
  cache_read_tokens   int,
  cache_write_tokens  int,
  duration_ms         int,
  retry_count         int          not null default 0,
  error_message       text,
  created_at          timestamptz  not null default now()
);

-- ─── Indexes ──────────────────────────────────────────────────────────────────

create index reviews_workspace_id_idx
  on public.reviews(workspace_id);

create index reviews_created_by_idx
  on public.reviews(created_by);

create index reviews_status_idx
  on public.reviews(status);

create index reviews_created_at_idx
  on public.reviews(created_at desc);

create index review_documents_review_id_idx
  on public.review_documents(review_id);

create index extracted_clauses_review_id_idx
  on public.extracted_clauses(review_id);

create index issues_review_id_idx
  on public.issues(review_id);

create index issues_severity_idx
  on public.issues(review_id, severity);

create index citations_issue_id_idx
  on public.citations(issue_id);

create index citations_corpus_chunk_id_idx
  on public.citations(corpus_chunk_id);

create index pipeline_events_review_id_idx
  on public.pipeline_events(review_id);

create index pipeline_events_created_at_idx
  on public.pipeline_events(created_at desc);

-- ─── Row-Level Security (DEF-009) ────────────────────────────────────────────

alter table public.reviews enable row level security;
alter table public.review_documents enable row level security;
alter table public.extracted_clauses enable row level security;
alter table public.issues enable row level security;
alter table public.citations enable row level security;
alter table public.pipeline_events enable row level security;

-- ─── Reusable membership check (inline subquery pattern for Supabase RLS) ────

-- reviews: workspace members can read
create policy "reviews_select_workspace"
  on public.reviews for select
  to authenticated
  using (
    workspace_id in (
      select workspace_id from public.profiles where id = auth.uid()
    )
  );

-- reviews: workspace members can insert (created_by must match caller)
create policy "reviews_insert_workspace"
  on public.reviews for insert
  to authenticated
  with check (
    workspace_id in (
      select workspace_id from public.profiles where id = auth.uid()
    )
    and created_by = auth.uid()
  );

-- reviews: workspace members can update (for status updates during pipeline)
create policy "reviews_update_workspace"
  on public.reviews for update
  to authenticated
  using (
    workspace_id in (
      select workspace_id from public.profiles where id = auth.uid()
    )
  );

-- review_documents: accessible to workspace members via reviews join
create policy "review_documents_select_workspace"
  on public.review_documents for select
  to authenticated
  using (
    review_id in (
      select id from public.reviews
      where workspace_id in (
        select workspace_id from public.profiles where id = auth.uid()
      )
    )
  );

create policy "review_documents_insert_workspace"
  on public.review_documents for insert
  to authenticated
  with check (
    review_id in (
      select id from public.reviews
      where workspace_id in (
        select workspace_id from public.profiles where id = auth.uid()
      )
    )
  );

-- extracted_clauses: workspace members can read
create policy "extracted_clauses_select_workspace"
  on public.extracted_clauses for select
  to authenticated
  using (
    review_id in (
      select id from public.reviews
      where workspace_id in (
        select workspace_id from public.profiles where id = auth.uid()
      )
    )
  );

create policy "extracted_clauses_insert_workspace"
  on public.extracted_clauses for insert
  to authenticated
  with check (
    review_id in (
      select id from public.reviews
      where workspace_id in (
        select workspace_id from public.profiles where id = auth.uid()
      )
    )
  );

-- issues: workspace members can read
create policy "issues_select_workspace"
  on public.issues for select
  to authenticated
  using (
    review_id in (
      select id from public.reviews
      where workspace_id in (
        select workspace_id from public.profiles where id = auth.uid()
      )
    )
  );

create policy "issues_insert_workspace"
  on public.issues for insert
  to authenticated
  with check (
    review_id in (
      select id from public.reviews
      where workspace_id in (
        select workspace_id from public.profiles where id = auth.uid()
      )
    )
  );

-- citations: workspace members can read (via issues → reviews join)
create policy "citations_select_workspace"
  on public.citations for select
  to authenticated
  using (
    issue_id in (
      select i.id from public.issues i
      join public.reviews r on r.id = i.review_id
      where r.workspace_id in (
        select workspace_id from public.profiles where id = auth.uid()
      )
    )
  );

create policy "citations_insert_workspace"
  on public.citations for insert
  to authenticated
  with check (
    issue_id in (
      select i.id from public.issues i
      join public.reviews r on r.id = i.review_id
      where r.workspace_id in (
        select workspace_id from public.profiles where id = auth.uid()
      )
    )
  );

-- pipeline_events: workspace owners/admins + parasol_admin (debug/observability data)
create policy "pipeline_events_select_admin"
  on public.pipeline_events for select
  to authenticated
  using (
    (select is_parasol_admin from public.profiles where id = auth.uid())
    or review_id in (
      select id from public.reviews
      where workspace_id in (
        select workspace_id from public.profiles
        where id = auth.uid() and role in ('owner', 'admin')
      )
    )
  );

create policy "pipeline_events_insert_workspace"
  on public.pipeline_events for insert
  to authenticated
  with check (
    review_id in (
      select id from public.reviews
      where workspace_id in (
        select workspace_id from public.profiles where id = auth.uid()
      )
    )
  );
