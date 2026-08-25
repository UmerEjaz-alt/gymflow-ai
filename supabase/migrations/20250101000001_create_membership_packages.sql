-- Migration: create membership_packages table
-- Description: Stores the membership package catalogue for each gym.

create table public.membership_packages (
  id                         uuid primary key default gen_random_uuid(),
  gym_id                     uuid not null references public.gyms (id) on delete cascade,
  package_name               text not null,
  duration_months            integer not null,
  price                      numeric(10, 2) not null,
  description                text,
  personal_training_included boolean not null default false,
  active                     boolean not null default true,
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now()
);

-- Keep updated_at current on every row change.
-- Reuses the set_updated_at() function created in the gyms migration.
create trigger membership_packages_set_updated_at
before update on public.membership_packages
for each row execute procedure public.set_updated_at();

-- Row Level Security
alter table public.membership_packages enable row level security;

-- Policy: authenticated users can read packages that belong to their gym.
create policy "membership_packages: gym owner can select"
  on public.membership_packages
  for select
  to authenticated
  using (
    gym_id in (
      select id from public.gyms where owner_user_id = auth.uid()
    )
  );

-- Policy: authenticated users can insert packages into their own gym.
create policy "membership_packages: gym owner can insert"
  on public.membership_packages
  for insert
  to authenticated
  with check (
    gym_id in (
      select id from public.gyms where owner_user_id = auth.uid()
    )
  );

-- Policy: authenticated users can update packages that belong to their gym.
create policy "membership_packages: gym owner can update"
  on public.membership_packages
  for update
  to authenticated
  using (
    gym_id in (
      select id from public.gyms where owner_user_id = auth.uid()
    )
  )
  with check (
    gym_id in (
      select id from public.gyms where owner_user_id = auth.uid()
    )
  );

-- Policy: authenticated users can delete packages that belong to their gym.
create policy "membership_packages: gym owner can delete"
  on public.membership_packages
  for delete
  to authenticated
  using (
    gym_id in (
      select id from public.gyms where owner_user_id = auth.uid()
    )
  );
