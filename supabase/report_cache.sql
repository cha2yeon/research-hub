create table if not exists public.report_cache (
  cache_key text primary key,
  reports jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.report_cache enable row level security;

grant select, insert, update, delete on table public.report_cache to service_role;
