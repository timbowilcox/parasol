-- Migration 0006: Explicit GRANTs for corpus tables
--
-- service_role bypasses RLS but still needs table-level GRANTs. The default
-- Supabase configuration grants ALL on future tables in public to anon /
-- authenticated / service_role via ALTER DEFAULT PRIVILEGES, but only when
-- the table is created by the postgres role. Tables created by the
-- migrator role (used by `supabase db push --db-url`) don't pick up that
-- default, so we grant explicitly.
--
-- Without these grants, the corpus ingestion CLI (which uses
-- SUPABASE_SERVICE_ROLE_KEY) hit "permission denied for table corpus_sources"
-- on its first DB call.

grant all on table public.corpus_sources to anon, authenticated, service_role;
grant all on table public.corpus_ingestion_runs to anon, authenticated, service_role;
grant all on table public.corpus_documents to anon, authenticated, service_role;
grant all on table public.corpus_chunks to anon, authenticated, service_role;

-- Same fix proactively applied to the other Sprint 1 tables since they were
-- created by the same migrator and are likely to need writes from server-
-- side admin code (audit hash chain, eval ingestion, etc.).
grant all on table public.workspaces to anon, authenticated, service_role;
grant all on table public.profiles to anon, authenticated, service_role;
grant all on table public.playbook_overrides to anon, authenticated, service_role;
grant all on table public.reviews to anon, authenticated, service_role;
grant all on table public.review_documents to anon, authenticated, service_role;
grant all on table public.extracted_clauses to anon, authenticated, service_role;
grant all on table public.issues to anon, authenticated, service_role;
grant all on table public.citations to anon, authenticated, service_role;
grant all on table public.pipeline_events to anon, authenticated, service_role;
grant all on table public.audit_log to anon, authenticated, service_role;

-- Sequence usage isn't needed (we use uuid defaults for primary keys), but
-- grant any future implicit sequences to be safe.
grant usage, select on all sequences in schema public to anon, authenticated, service_role;

-- Set up the default for future tables so we don't have to repeat this.
alter default privileges in schema public
  grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public
  grant usage, select on sequences to anon, authenticated, service_role;
