create table if not exists public.report_detail_cache (
  cache_key text primary key,
  organization text not null,
  source_url text not null check (source_url ~ '^https://'),
  content text not null default '',
  status text not null check (status in ('success', 'unavailable')),
  extractor_version integer not null,
  extracted_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.report_detail_cache enable row level security;

revoke all on table public.report_detail_cache from anon, authenticated;
grant select, insert, update, delete on table public.report_detail_cache to service_role;

create index if not exists report_detail_cache_version_idx
  on public.report_detail_cache (extractor_version);
