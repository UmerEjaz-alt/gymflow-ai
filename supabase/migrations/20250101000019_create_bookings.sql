-- ============================================================================
-- Migration: Create Bookings Table
-- File: 20250101000019_create_bookings.sql
-- Description:
--   - Production-quality multi-tenant, multi-branch bookings table.
--   - Scoped to (gym_id, branch_id) with compound FK reusing branches(id, gym_id).
--   - Enforces PostgreSQL-level atomic trainer conflict exclusion via btree_gist.
--   - Enforces resource integrity triggers (trainer branch match, conversation branch match).
--   - Enforces RLS (SELECT, INSERT, UPDATE) with no hard DELETE policy for history retention.
-- ============================================================================

-- Ensure btree_gist is enabled for exclusion constraints combining UUID and tstzrange
create extension if not exists btree_gist;

-- 1. Create Bookings Table
create table if not exists public.bookings (
  id uuid primary key default gen_random_uuid(),
  gym_id uuid not null references public.gyms(id) on delete cascade,
  branch_id uuid not null,
  conversation_id uuid references public.conversations(id) on delete set null,
  trainer_id uuid references public.trainers(id) on delete set null,
  customer_name text not null,
  customer_phone text,
  booking_type text not null check (booking_type in ('gym_visit', 'trial_session', 'pt_consultation', 'pt_session')),
  scheduled_at timestamptz not null,
  duration_minutes integer not null check (duration_minutes in (30, 45, 60, 90)),
  status text not null default 'upcoming' check (status in ('upcoming', 'completed', 'cancelled', 'no_show')),
  source text not null default 'manual' check (source in ('manual', 'whatsapp')),
  notes text,
  cancelled_at timestamptz,
  completed_at timestamptz,
  no_show_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 2. Compound Foreign Key ensuring branch belongs to gym
alter table public.bookings
  drop constraint if exists bookings_branch_gym_fk;

alter table public.bookings
  add constraint bookings_branch_gym_fk
  foreign key (branch_id, gym_id)
  references public.branches(id, gym_id)
  on delete restrict;

-- 3. Immutable Range Helper for GIST exclusion
create or replace function public.booking_tstzrange(p_start timestamptz, p_duration_minutes integer)
returns tstzrange
language sql
immutable
as $$
  select tstzrange(p_start, p_start + make_interval(mins => p_duration_minutes), '[)');
$$;

-- 4. Atomic Concurrency Guard: prevent overlapping upcoming bookings for the same trainer
alter table public.bookings
  drop constraint if exists bookings_no_overlapping_trainer_bookings;

alter table public.bookings
  add constraint bookings_no_overlapping_trainer_bookings
  exclude using gist (
    trainer_id with =,
    public.booking_tstzrange(scheduled_at, duration_minutes) with &&
  )
  where (trainer_id is not null and status = 'upcoming');

-- 5. Automatic updated_at trigger
drop trigger if exists bookings_set_updated_at on public.bookings;

create trigger bookings_set_updated_at
  before update on public.bookings
  for each row
  execute procedure public.set_updated_at();

-- 6. Integrity Trigger: Trainer and Conversation must belong to the same gym and branch
create or replace function public.enforce_booking_resource_integrity()
returns trigger
language plpgsql
as $$
begin
  -- 1. Ensure branch_id belongs to the booking gym_id
  if not exists (
    select 1 from public.branches b
    where b.id = new.branch_id and b.gym_id = new.gym_id
  ) then
    raise exception 'branch_id must belong to the booking gym';
  end if;

  -- 2. If trainer_id is provided, ensure trainer belongs to this gym and branch
  if new.trainer_id is not null and not exists (
    select 1 from public.trainers t
    where t.id = new.trainer_id and t.gym_id = new.gym_id and t.branch_id = new.branch_id
  ) then
    raise exception 'trainer_id must belong to the same gym and branch';
  end if;

  -- 3. If conversation_id is provided, ensure conversation belongs to this gym and branch (or unassigned branch)
  if new.conversation_id is not null and not exists (
    select 1 from public.conversations c
    where c.id = new.conversation_id
      and c.gym_id = new.gym_id
      and (c.branch_id is null or c.branch_id = new.branch_id)
  ) then
    raise exception 'conversation_id must belong to the same gym and branch';
  end if;

  return new;
end;
$$;

drop trigger if exists bookings_resource_integrity on public.bookings;

create trigger bookings_resource_integrity
  before insert or update on public.bookings
  for each row
  execute function public.enforce_booking_resource_integrity();

-- 7. Indexes for common query patterns
create index if not exists bookings_gym_branch_scheduled_idx
  on public.bookings (gym_id, branch_id, scheduled_at);

create index if not exists bookings_branch_status_scheduled_idx
  on public.bookings (branch_id, status, scheduled_at);

create index if not exists bookings_trainer_status_scheduled_idx
  on public.bookings (trainer_id, scheduled_at)
  where trainer_id is not null;

create index if not exists bookings_conversation_id_idx
  on public.bookings (conversation_id)
  where conversation_id is not null;

-- 8. Row Level Security
alter table public.bookings enable row level security;

drop policy if exists "bookings: gym owner can select" on public.bookings;
create policy "bookings: gym owner can select"
  on public.bookings
  for select
  to authenticated
  using (
    gym_id in (
      select id from public.gyms
      where owner_user_id = auth.uid()
    )
  );

drop policy if exists "bookings: gym owner can insert" on public.bookings;
create policy "bookings: gym owner can insert"
  on public.bookings
  for insert
  to authenticated
  with check (
    gym_id in (
      select id from public.gyms
      where owner_user_id = auth.uid()
    )
  );

drop policy if exists "bookings: gym owner can update" on public.bookings;
create policy "bookings: gym owner can update"
  on public.bookings
  for update
  to authenticated
  using (
    gym_id in (
      select id from public.gyms
      where owner_user_id = auth.uid()
    )
  )
  with check (
    gym_id in (
      select id from public.gyms
      where owner_user_id = auth.uid()
    )
  );

-- Notice: Normal booking deletion is prohibited. Cancellations transition status to 'cancelled'.
