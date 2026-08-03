create table if not exists public.shared_reports (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(trim(title)) > 0),
  organization text not null check (char_length(trim(organization)) > 0),
  published_at date not null,
  url text not null check (url ~ '^https?://'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.set_shared_reports_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists shared_reports_updated_at on public.shared_reports;
create trigger shared_reports_updated_at
before update on public.shared_reports
for each row execute function public.set_shared_reports_updated_at();

alter table public.shared_reports enable row level security;

-- The application accesses this table only through server-side Route Handlers.
revoke all on table public.shared_reports from anon, authenticated;
grant select, insert, update, delete on table public.shared_reports to service_role;
grant execute on function public.set_shared_reports_updated_at() to service_role;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'shared_reports_title_length_check'
  ) and not exists (
    select 1 from public.shared_reports where char_length(title) > 500
  ) then
    alter table public.shared_reports
      add constraint shared_reports_title_length_check check (char_length(title) <= 500);
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'shared_reports_organization_length_check'
  ) and not exists (
    select 1 from public.shared_reports where char_length(organization) > 200
  ) then
    alter table public.shared_reports
      add constraint shared_reports_organization_length_check check (char_length(organization) <= 200);
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'shared_reports_url_length_check'
  ) and not exists (
    select 1 from public.shared_reports where char_length(url) > 2048
  ) then
    alter table public.shared_reports
      add constraint shared_reports_url_length_check check (char_length(url) <= 2048);
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'shared_reports_url_key'
  ) then
    if exists (
      select 1 from public.shared_reports group by url having count(*) > 1
    ) then
      raise notice 'shared_reports URL unique constraint was not added because duplicate URLs already exist.';
    else
      alter table public.shared_reports add constraint shared_reports_url_key unique (url);
    end if;
  end if;
end;
$$;
