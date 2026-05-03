-- Migration 0005: Corpus retrieval RPC
-- Vector retrieval over corpus_chunks with optional jurisdiction / clause-type
-- filtering. BM25 retrieval is done via @supabase/supabase-js .textSearch();
-- vector retrieval needs an RPC because the JS client has no native pgvector
-- operator support.
--
-- Returns the top-N chunks ordered by cosine similarity to the supplied query
-- embedding, with the document join eagerly resolved so the JS layer can build
-- AuthorityResult rows without a second round-trip.

create or replace function public.match_corpus_chunks(
  query_embedding vector(1024),
  match_count int default 50,
  jurisdiction_filter text default null,
  source_type_filter text[] default null,
  clause_types_filter text[] default null
) returns table (
  id uuid,
  document_id uuid,
  chunk_index int,
  hierarchy text[],
  text text,
  text_with_context text,
  clause_types text[],
  area_of_law text[],
  similarity float,
  document_canonical_id text,
  document_title text,
  document_source_type text,
  document_jurisdiction text,
  document_source_url text
)
language sql
stable
as $$
  select
    c.id,
    c.document_id,
    c.chunk_index,
    c.hierarchy,
    c.text,
    c.text_with_context,
    c.clause_types,
    c.area_of_law,
    1 - (c.embedding <=> query_embedding) as similarity,
    d.canonical_id as document_canonical_id,
    d.title as document_title,
    d.source_type as document_source_type,
    d.jurisdiction as document_jurisdiction,
    d.source_url as document_source_url
  from public.corpus_chunks c
  join public.corpus_documents d on d.id = c.document_id
  where
    c.embedding is not null
    and d.superseded_at is null
    and (jurisdiction_filter is null or d.jurisdiction = jurisdiction_filter)
    and (source_type_filter is null or d.source_type = any(source_type_filter))
    and (clause_types_filter is null or c.clause_types && clause_types_filter)
  order by c.embedding <=> query_embedding
  limit match_count;
$$;

-- ─── BM25 RPC ────────────────────────────────────────────────────────────────
-- We expose a parallel RPC for BM25 so the JS layer can call both retrievals
-- with identical filter semantics. The JS client's .textSearch() helper works
-- but doesn't expose ts_rank_cd scoring, which we need for the RRF merge.

create or replace function public.bm25_corpus_chunks(
  query_text text,
  match_count int default 50,
  jurisdiction_filter text default null,
  source_type_filter text[] default null,
  clause_types_filter text[] default null
) returns table (
  id uuid,
  document_id uuid,
  chunk_index int,
  hierarchy text[],
  text text,
  text_with_context text,
  clause_types text[],
  area_of_law text[],
  rank float,
  document_canonical_id text,
  document_title text,
  document_source_type text,
  document_jurisdiction text,
  document_source_url text
)
language sql
stable
as $$
  with q as (
    -- websearch_to_tsquery is forgiving of natural-language input; it ignores
    -- syntax errors that to_tsquery would reject.
    select websearch_to_tsquery('english', query_text) as tsq
  )
  select
    c.id,
    c.document_id,
    c.chunk_index,
    c.hierarchy,
    c.text,
    c.text_with_context,
    c.clause_types,
    c.area_of_law,
    ts_rank_cd(c.fts, q.tsq) as rank,
    d.canonical_id as document_canonical_id,
    d.title as document_title,
    d.source_type as document_source_type,
    d.jurisdiction as document_jurisdiction,
    d.source_url as document_source_url
  from public.corpus_chunks c
  join public.corpus_documents d on d.id = c.document_id
  cross join q
  where
    c.fts @@ q.tsq
    and d.superseded_at is null
    and (jurisdiction_filter is null or d.jurisdiction = jurisdiction_filter)
    and (source_type_filter is null or d.source_type = any(source_type_filter))
    and (clause_types_filter is null or c.clause_types && clause_types_filter)
  order by rank desc
  limit match_count;
$$;

-- Allow authenticated users to invoke both retrieval RPCs.
-- The pipeline runs server-side with the user's session; service_role is not
-- required for retrieval (only for ingestion, where the CLI uses it).
grant execute on function public.match_corpus_chunks(vector, int, text, text[], text[]) to authenticated;
grant execute on function public.bm25_corpus_chunks(text, int, text, text[], text[]) to authenticated;
