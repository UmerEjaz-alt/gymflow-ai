-- Migration: create trainers table
-- Description: Stores trainer profiles belonging to each gym.

create table public.trainers (
  id                    uuid primary key default gen_random_uuid(),
  gym_id                uuid not null references public.gyms (id) on delete cascade,
  full_name             text not null,
  specialization        text,
  bio                   text,
  profile_photo_url     text,
  phone                 text,
  email                 text,
  accepting_new_clients boolean not null default true,
  active                boolean not null default true,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

-- Keep updated_at current on every row change.
-- Reuses the set_updated_at() function created in the gyms migration.
create trigger trainers_set_updated_at
before update on public.trainers
for each row execute procedure public.set_updated_at();

-- Row Level Security
alter table public.trainers enable row level security;

-- Policy: authenticated users can read trainers belonging to their gym.
create policy "trainers: gym owner can select"
  on public.trainers
  for select
  to authenticated
  using (
    gym_id in (
      select id from public.gyms where owner_user_id = auth.uid()
    )
  );

-- Policy: authenticated users can insert trainers into their own gym.
create policy "trainers: gym owner can insert"
  on public.trainers
  for insert
  to authenticated
  with check (
    gym_id in (
      select id from public.gyms where owner_user_id = auth.uid()
    )
  );

-- Policy: authenticated users can update trainers belonging to their gym.
create policy "trainers: gym owner can update"
  on public.trainers
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

-- Policy: authenticated users can delete trainers belonging to their gym.
create policy "trainers: gym owner can delete"
  on public.trainers
  for delete
  to authenticated
  using (
    gym_id in (
      select id from public.gyms where owner_user_id = auth.uid()
    )
  );
