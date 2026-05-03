-- Migration 0002: Corpus
-- corpus_sources, corpus_ingestion_runs, corpus_documents, corpus_chunks
-- pgvector HNSW index + GIN FTS index for hybrid retrieval
-- RLS: authenticated reads (pipeline runs server-side with user session); writes via service role

-- ─── corpus_sources (configured ingestion sources) ───────────────────────────

create table public.corpus_sources (
  id                uuid         primary key default gen_random_uuid(),
  slug              text         not null unique,
  name              text         not null,
  jurisdiction      text         not null,
  source_type       text         not null,
  base_url          text         not null,
  -- schedule_display is read-only text in Sprint 1; Vercel Cron wired Sprint 4 (DEF-017)
  schedule_display  text,
  status            text         not null default 'idle'
                                 check (status in ('idle', 'running', 'healthy', 'warning', 'error')),
  last_run_at       timestamptz,
  document_count    int          not null default 0,
  created_at        timestamptz  not null default now(),
  updated_at        timestamptz  not null default now()
);

-- ─── corpus_ingestion_runs (one row per scraper invocation) ──────────────────

create table public.corpus_ingestion_runs (
  id                    uuid         primary key default gen_random_uuid(),
  source_id             uuid         not null references public.corpus_sources(id) on delete cascade,
  triggered_by          uuid         references public.profiles(id),  -- null = automated cron
  started_at            timestamptz  not null default now(),
  completed_at          timestamptz,
  status                text         not null default 'running'
                                     check (status in ('running', 'completed', 'failed')),
  documents_processed   int          not null default 0,
  documents_added       int          not null default 0,
  documents_updated     int          not null default 0,
  errors                jsonb        not null default '[]',
  created_at            timestamptz  not null default now()
);

-- ─── corpus_documents (top-level ingested legal sources) ─────────────────────

create table public.corpus_documents (
  id                uuid         primary key default gen_random_uuid(),
  source_id         uuid         references public.corpus_sources(id),
  source_type       text         not null,
  jurisdiction      text         not null,
  canonical_id      text         not null,
  title             text         not null,
  full_text         text         not null,
  source_url        text         not null,
  retrieved_at      timestamptz  not null,
  effective_date    date,
  superseded_at     timestamptz,
  superseded_by_id  uuid         references public.corpus_documents(id),
  metadata          jsonb        not null default '{}',
  created_at        timestamptz  not null default now(),
  unique (source_type, jurisdiction, canonical_id, retrieved_at)
);

-- ─── corpus_chunks (retrieval units with embeddings and FTS) ─────────────────

create table public.corpus_chunks (
  id                uuid         primary key default gen_random_uuid(),
  document_id       uuid         not null references public.corpus_documents(id) on delete cascade,
  parent_chunk_id   uuid         references public.corpus_chunks(id),
  chunk_index       int          not null,
  hierarchy         text[]       not null default '{}',
  text              text         not null,
  -- text_with_context includes hierarchy prefix for better embedding recall
  text_with_context text         not null,
  clause_types      text[]       not null default '{}',
  area_of_law       text[]       not null default '{}',
  embedding         vector(1024),
  -- fts generated always from text (not text_with_context, to avoid hierarchy noise in BM25)
  fts               tsvector     generated always as (to_tsvector('english', text)) stored,
  created_at        timestamptz  not null default now()
);

-- ─── Indexes ──────────────────────────────────────────────────────────────────

create index corpus_ingestion_runs_source_id_idx
  on public.corpus_ingestion_runs(source_id);

create index corpus_ingestion_runs_started_at_idx
  on public.corpus_ingestion_runs(started_at desc);

create index corpus_documents_jurisdiction_idx
  on public.corpus_documents(jurisdiction);

create index corpus_documents_source_type_idx
  on public.corpus_documents(source_type);

create index corpus_documents_canonical_idx
  on public.corpus_documents(source_type, jurisdiction, canonical_id);

create index corpus_documents_superseded_at_idx
  on public.corpus_documents(superseded_at)
  where superseded_at is null;  -- partial index on live documents

create index corpus_chunks_document_id_idx
  on public.corpus_chunks(document_id);

-- HNSW index for approximate nearest-neighbour vector search (cosine distance)
-- ef_construction=128, m=16 are Supabase-recommended defaults for legal text retrieval
create index corpus_chunks_embedding_hnsw_idx
  on public.corpus_chunks
  using hnsw (embedding vector_cosine_ops)
  with (m = 16, ef_construction = 128);

-- GIN index for BM25 full-text search
create index corpus_chunks_fts_gin_idx
  on public.corpus_chunks using gin (fts);

-- GIN index for clause_types array filtering at retrieval time
create index corpus_chunks_clause_types_gin_idx
  on public.corpus_chunks using gin (clause_types);

-- ─── Row-Level Security (DEF-009) ────────────────────────────────────────────

alter table public.corpus_sources enable row level security;
alter table public.corpus_ingestion_runs enable row level security;
alter table public.corpus_documents enable row level security;
alter table public.corpus_chunks enable row level security;

-- corpus_sources: all authenticated users can read (needed for admin UI)
create policy "corpus_sources_select_authenticated"
  on public.corpus_sources for select
  to authenticated
  using (true);

-- corpus_ingestion_runs: parasol_admin only (internal ops surface)
create policy "corpus_ingestion_runs_select_admin"
  on public.corpus_ingestion_runs for select
  to authenticated
  using (
    (select is_parasol_admin from public.profiles where id = auth.uid())
  );

create policy "corpus_ingestion_runs_insert_admin"
  on public.corpus_ingestion_runs for insert
  to authenticated
  with check (
    (select is_parasol_admin from public.profiles where id = auth.uid())
  );

create policy "corpus_ingestion_runs_update_admin"
  on public.corpus_ingestion_runs for update
  to authenticated
  using (
    (select is_parasol_admin from public.profiles where id = auth.uid())
  );

-- corpus_documents: all authenticated users can read
-- (retrieval runs server-side with the user's session; no service_role in app code per CLAUDE.md)
create policy "corpus_documents_select_authenticated"
  on public.corpus_documents for select
  to authenticated
  using (true);

-- corpus_chunks: all authenticated users can read
create policy "corpus_chunks_select_authenticated"
  on public.corpus_chunks for select
  to authenticated
  using (true);

-- ─── Seed: corpus sources for Sprint 1 Kenya corpus ──────────────────────────

insert into public.corpus_sources (slug, name, jurisdiction, source_type, base_url, schedule_display)
values
  ('kenya-constitution', 'Constitution of Kenya 2010', 'kenya', 'statute',
   'https://kenyalaw.org/lex/actview.xql?actid=Const2010', 'Manual only'),
  ('kenya-acts', 'Acts of Parliament (Kenya)', 'kenya', 'statute',
   'https://kenyalaw.org/kl/index.php?id=2467', 'Weekly'),
  ('kenya-court-of-appeal', 'Court of Appeal Judgments', 'kenya', 'case',
   'https://kenyalaw.org/caselaw/cases/advanced-search/', 'Daily'),
  ('kenya-high-court', 'High Court Judgments', 'kenya', 'case',
   'https://kenyalaw.org/caselaw/cases/advanced-search/', 'Daily'),
  ('kenya-odpc', 'ODPC Determinations', 'kenya', 'odpc_determination',
   'https://www.odpc.go.ke/resources/determinations/', 'Weekly'),
  ('kenya-gazette', 'Kenya Gazette', 'kenya', 'gazette',
   'https://www.kenyalaw.org/kl/index.php?id=454', 'Weekly');
