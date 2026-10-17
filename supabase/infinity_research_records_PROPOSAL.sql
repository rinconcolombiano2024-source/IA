-- INFINITY MEMORY proposal ONLY. Do not execute against production without approval.
-- Dedicated server-only research records with tenant ownership enforced by trusted backend.
-- Tenant identifiers supplied by clients are NOT sufficient authentication.
create table if not exists public.infinity_research_records (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null check (tenant_id ~ '^[a-zA-Z0-9_-]{1,100}$'),
  owner_user_id text not null check (length(owner_user_id) between 1 and 200),
  project_id text,
  record jsonb not null check (jsonb_typeof(record) = 'object'),
  evidence_verified boolean not null default false,
  review_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint infinity_research_record_size check (octet_length(record::text) <= 65536)
);
create index if not exists infinity_research_records_owner_idx
  on public.infinity_research_records (tenant_id, owner_user_id, created_at desc);
alter table public.infinity_research_records enable row level security;
revoke all on table public.infinity_research_records from public, anon, authenticated;
grant select, insert, update, delete on table public.infinity_research_records to service_role;
comment on table public.infinity_research_records is
  'INFINITY experimental server-only memory. No browser access; server must enforce authenticated tenant and owner. Migration requires separate approval.';
-- No RLS policies granting client access. Service-role bypasses RLS:
-- server MUST derive tenant_id and owner_user_id from verified authentication.
-- Pending before activation: retention/deletion policy, backup, encryption requirements,
-- quota/rate limiting, authenticated API, audit trail, and integration tests.
