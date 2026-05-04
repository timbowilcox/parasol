-- Migration 0007: Review artifacts inline storage
--
-- Sprint 1 Day 11 ships the web review surface, which needs the redlined
-- DOCX downloadable from /review/[id]. The fully-formed answer here is
-- Supabase Storage with signed URLs, but standing up a Storage bucket with
-- the right RLS-equivalent policies is a non-trivial chunk of work that
-- doesn't have to land for Sprint 1.
--
-- Pragmatic Sprint 1 path: store the redline DOCX bytes inline as a base64
-- text column on the reviews row. Sprint 1 NDAs are 5-50 KB raw, so the
-- base64 form is well under 100 KB — comfortably within Postgres row limits
-- and Supabase's free-tier storage budget. v2 (DEF-048) migrates the bytes
-- out to Supabase Storage and drops the column.

alter table public.reviews
  add column redline_docx_base64 text;

-- The web view JSON (assembled.webView) is also persisted so the review
-- page can render without re-running the orchestrator. JSONB rather than
-- text because we want to query summary counts for the workspace dashboard
-- (Sprint 2+) without parsing.
alter table public.reviews
  add column web_view_json jsonb;

-- The reply email body (assembled.email) is persisted for the audit trail —
-- the customer's email client has the only other copy, and we want to be
-- able to show "what we sent" on the review page without storing it on the
-- email side.
alter table public.reviews
  add column email_body_json jsonb;

comment on column public.reviews.redline_docx_base64 is
  'Sprint 1: inline base64 of the redlined .docx. v2 migrates to Storage (DEF-048).';
comment on column public.reviews.web_view_json is
  'Sprint 1: assembled.webView from @parasol/ai assemble-output. Hydrates /review/[id].';
comment on column public.reviews.email_body_json is
  'Sprint 1: { subjectSuffix, plainText, html } sent to the customer in the reply.';
