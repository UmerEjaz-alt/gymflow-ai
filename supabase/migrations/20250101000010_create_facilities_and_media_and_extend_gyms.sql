-- Migration: create facilities and media_assets tables and extend gyms table
-- Description:
--   - public.facilities: Stores the facilities offered by each gym.
--   - public.media_assets: Stores images, videos, and brochure URLs for various categories.
--   - public.gyms table: Add columns for faqs (jsonb) and ai_communication_style (text).

-- Create facilities table
create table public.facilities (
  id                   uuid primary key default gen_random_uuid(),
  gym_id               uuid not null references public.gyms (id) on delete cascade,
  name                 text not null,
  description          text,
  available            boolean not null default true,
  package_restrictions text[] not null default '{}',
  active               boolean not null default true,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

-- Keep updated_at current on every row change.
create trigger facilities_set_updated_at
before update on public.facilities
for each row execute procedure public.set_updated_at();

-- RLS policies for facilities
alter table public.facilities enable row level security;

create policy "facilities: gym owner can select"
  on public.facilities
  for select
  to authenticated
  using (
    gym_id in (
      select id from public.gyms where owner_user_id = auth.uid()
    )
  );

create policy "facilities: gym owner can insert"
  on public.facilities
  for insert
  to authenticated
  with check (
    gym_id in (
      select id from public.gyms where owner_user_id = auth.uid()
    )
  );

create policy "facilities: gym owner can update"
  on public.facilities
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

create policy "facilities: gym owner can delete"
  on public.facilities
  for delete
  to authenticated
  using (
    gym_id in (
      select id from public.gyms where owner_user_id = auth.uid()
    )
  );


-- Create media_assets table
create table public.media_assets (
  id          uuid primary key default gen_random_uuid(),
  gym_id      uuid not null references public.gyms (id) on delete cascade,
  title       text not null,
  media_type  text not null check (media_type in ('photo', 'video', 'brochure')),
  category    text not null check (category in ('gym', 'equipment', 'trainer', 'facility', 'other')),
  media_url   text not null,
  description text,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Keep updated_at current on every row change.
create trigger media_assets_set_updated_at
before update on public.media_assets
for each row execute procedure public.set_updated_at();

-- RLS policies for media_assets
alter table public.media_assets enable row level security;

create policy "media_assets: gym owner can select"
  on public.media_assets
  for select
  to authenticated
  using (
    gym_id in (
      select id from public.gyms where owner_user_id = auth.uid()
    )
  );

create policy "media_assets: gym owner can insert"
  on public.media_assets
  for insert
  to authenticated
  with check (
    gym_id in (
      select id from public.gyms where owner_user_id = auth.uid()
    )
  );

create policy "media_assets: gym owner can update"
  on public.media_assets
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

create policy "media_assets: gym owner can delete"
  on public.media_assets
  for delete
  to authenticated
  using (
    gym_id in (
      select id from public.gyms where owner_user_id = auth.uid()
    )
  );


-- Extend gyms table to include faqs and ai_communication_style
alter table public.gyms
  add column if not exists faqs jsonb not null default '[]'::jsonb,
  add column if not exists ai_communication_style text;
