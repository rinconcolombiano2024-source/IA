-- IA persistent state store (Supabase)
-- Apply this only to a dedicated Supabase project for IA.
-- This table is server-only. Never grant anon/authenticated access.

create table if not exists public.ai_state_events (
  id uuid primary key default gen_random_uuid(),
  namespace text not null,
  kind text not null,
  event_id text not null,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  constraint ai_state_events_identity_unique unique (namespace, kind, event_id)
);

create index if not exists ai_state_events_lookup_idx
  on public.ai_state_events (namespace, kind, created_at desc);

alter table public.ai_state_events enable row level security;

revoke all on table public.ai_state_events from public, anon, authenticated;
grant select, insert, update, delete on table public.ai_state_events to service_role;

comment on table public.ai_state_events is
  'Server-only persistent state for the IA application. Do not expose to browser clients.';
