-- Extend the existing isolated control fixture with the pre-35 member domain.
create table auth.users(id uuid primary key);
alter table public.branches add column country_code text;
alter table public.branches add column timezone text;
alter table public.branches add column branch_name text;
create table public.membership_packages(id uuid primary key default gen_random_uuid(),
  gym_id uuid not null references public.gyms(id), branch_id uuid not null references public.branches(id),
  package_name text not null, duration_months integer not null, active boolean not null default true,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create table public.memberships(id uuid primary key default gen_random_uuid(),
  gym_id uuid not null references public.gyms(id) on delete cascade,
  branch_id uuid not null references public.branches(id),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  membership_package_id uuid not null references public.membership_packages(id),
  start_date date not null, expiry_date date not null check (expiry_date > start_date),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create function public.enforce_membership_branch_consistency() returns trigger language plpgsql as $$ begin return new; end; $$;
create trigger memberships_branch_consistency before insert or update on public.memberships
  for each row execute function public.enforce_membership_branch_consistency();
create table public.automation_configs(id uuid primary key default gen_random_uuid(),
  gym_id uuid not null references public.gyms(id), branch_id uuid not null references public.branches(id),
  automation_type text not null, enabled boolean not null default true, auto_send boolean not null default true,
  delay_days integer not null default 7, max_follow_ups integer not null default 1,
  quiet_hours_start time, quiet_hours_end time);
alter table public.automation_executions add constraint automation_executions_conversation_id_fkey
  foreign key (conversation_id) references public.conversations(id) on delete cascade;
create function public.enforce_automation_execution_branch_consistency() returns trigger language plpgsql as $$ begin return new; end; $$;
create trigger automation_executions_branch_consistency before insert or update on public.automation_executions
  for each row execute function public.enforce_automation_execution_branch_consistency();
grant select on public.membership_packages, public.memberships, public.automation_configs to authenticated;
grant all on all tables in schema public to service_role;
alter table public.memberships enable row level security;
create policy membership_owner_read on public.memberships for select to authenticated
  using (gym_id in (select id from public.gyms where owner_user_id = auth.uid()));
