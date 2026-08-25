-- Migration: create gyms table
-- Description: Stores the gym profile for each owner account.

create table public.gyms (
  id               uuid primary key default gen_random_uuid(),
  owner_user_id    uuid not null references auth.users (id) on delete cascade,
  gym_name         text not null,
  logo_url         text,
  address          text,
  city             text,
  phone            text,
  email            text,
  whatsapp_number  text,
  opening_hours    jsonb,
  trial_policy     text,
  visit_policy     text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- Enforce one gym per owner account.
create unique index gyms_owner_user_id_key on public.gyms (owner_user_id);

-- Keep updated_at current on every row change.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger gyms_set_updated_at
before update on public.gyms
for each row execute procedure public.set_updated_at();

-- Row Level Security
alter table public.gyms enable row level security;

-- Policy: authenticated users can read their own gym row.
create policy "gyms: owner can select"
  on public.gyms
  for select
  to authenticated
  using (owner_user_id = auth.uid());

-- Policy: authenticated users can insert a gym row for themselves.
create policy "gyms: owner can insert"
  on public.gyms
  for insert
  to authenticated
  with check (owner_user_id = auth.uid());

-- Policy: authenticated users can update their own gym row.
create policy "gyms: owner can update"
  on public.gyms
  for update
  to authenticated
  using (owner_user_id = auth.uid())
  with check (owner_user_id = auth.uid());

-- Policy: authenticated users can delete their own gym row.
create policy "gyms: owner can delete"
  on public.gyms
  for delete
  to authenticated
  using (owner_user_id = auth.uid());
