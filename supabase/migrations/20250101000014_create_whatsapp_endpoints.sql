-- ============================================================================
-- Migration: Create WhatsApp Endpoints & Adapt Conversations
-- File: 20250101000014_create_whatsapp_endpoints.sql
-- Description:
--   - Introduces public.whatsapp_endpoints table for dedicated and shared lines.
--   - Makes conversations.branch_id nullable (unresolved branch state).
--   - Adds conversations.whatsapp_endpoint_id.
--   - Updates conversation identity uniqueness to (gym_id, whatsapp_endpoint_id, customer_phone).
--   - Updates RLS, compound FKs, and triggers.
--   - Backfills existing branch numbers into whatsapp_endpoints.
--   - Creates resolve_whatsapp_endpoint RPC.
-- ============================================================================

-- 1. Create whatsapp_endpoints table
create table if not exists public.whatsapp_endpoints (
  id uuid primary key default gen_random_uuid(),
  gym_id uuid not null references public.gyms(id) on delete cascade,
  branch_id uuid references public.branches(id) on delete set null,
  phone_number text not null,
  phone_number_id text,
  display_phone_number text,
  label text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 2. Indexes and constraints on whatsapp_endpoints
create index if not exists whatsapp_endpoints_gym_id_idx
  on public.whatsapp_endpoints(gym_id);

create index if not exists whatsapp_endpoints_branch_id_idx
  on public.whatsapp_endpoints(branch_id);

create unique index if not exists whatsapp_endpoints_phone_number_id_unique
  on public.whatsapp_endpoints(phone_number_id)
  where phone_number_id is not null;

create unique index if not exists whatsapp_endpoints_normalized_phone_unique
  on public.whatsapp_endpoints(gym_id, regexp_replace(phone_number, '\D', '', 'g'))
  where phone_number is not null and phone_number != '';

-- Trigger for updated_at
drop trigger if exists whatsapp_endpoints_set_updated_at on public.whatsapp_endpoints;
create trigger whatsapp_endpoints_set_updated_at
  before update on public.whatsapp_endpoints
  for each row
  execute procedure public.set_updated_at();

-- Integrity trigger: endpoint branch must belong to endpoint gym
create or replace function public.enforce_endpoint_branch_gym_match()
returns trigger
language plpgsql
as $$
begin
  if new.branch_id is not null and not exists (
    select 1
    from public.branches b
    where b.id = new.branch_id
      and b.gym_id = new.gym_id
  ) then
    raise exception 'branch_id must belong to the endpoint gym';
  end if;

  return new;
end;
$$;

drop trigger if exists whatsapp_endpoints_branch_gym_match on public.whatsapp_endpoints;
create trigger whatsapp_endpoints_branch_gym_match
  before insert or update on public.whatsapp_endpoints
  for each row
  execute function public.enforce_endpoint_branch_gym_match();

-- 3. Enable RLS on whatsapp_endpoints
alter table public.whatsapp_endpoints enable row level security;

drop policy if exists "whatsapp_endpoints: gym owner can select" on public.whatsapp_endpoints;
create policy "whatsapp_endpoints: gym owner can select"
  on public.whatsapp_endpoints
  for select
  to authenticated
  using (
    gym_id in (
      select id from public.gyms where owner_user_id = auth.uid()
    )
  );

drop policy if exists "whatsapp_endpoints: gym owner can insert" on public.whatsapp_endpoints;
create policy "whatsapp_endpoints: gym owner can insert"
  on public.whatsapp_endpoints
  for insert
  to authenticated
  with check (
    gym_id in (
      select id from public.gyms where owner_user_id = auth.uid()
    )
  );

drop policy if exists "whatsapp_endpoints: gym owner can update" on public.whatsapp_endpoints;
create policy "whatsapp_endpoints: gym owner can update"
  on public.whatsapp_endpoints
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

drop policy if exists "whatsapp_endpoints: gym owner can delete" on public.whatsapp_endpoints;
create policy "whatsapp_endpoints: gym owner can delete"
  on public.whatsapp_endpoints
  for delete
  to authenticated
  using (
    gym_id in (
      select id from public.gyms where owner_user_id = auth.uid()
    )
  );

-- 4. Backfill existing branch and gym WhatsApp configurations into whatsapp_endpoints
insert into public.whatsapp_endpoints (
  gym_id,
  branch_id,
  phone_number,
  phone_number_id,
  display_phone_number,
  label,
  is_active
)
select
  b.gym_id,
  b.id,
  coalesce(b.whatsapp_number, b.phone, ''),
  b.whatsapp_phone_number_id,
  b.whatsapp_number,
  b.branch_name || ' WhatsApp',
  true
from public.branches b
where (b.whatsapp_number is not null and b.whatsapp_number != '')
   or b.whatsapp_phone_number_id is not null
on conflict do nothing;

-- 5. Adapt conversations table:
-- Add whatsapp_endpoint_id column
alter table public.conversations
  add column if not exists whatsapp_endpoint_id uuid
  references public.whatsapp_endpoints(id)
  on delete set null;

create index if not exists conversations_whatsapp_endpoint_id_idx
  on public.conversations(whatsapp_endpoint_id);

-- Backfill conversations.whatsapp_endpoint_id where deterministically known from branch
update public.conversations c
set whatsapp_endpoint_id = e.id
from public.whatsapp_endpoints e
where e.gym_id = c.gym_id
  and e.branch_id = c.branch_id
  and c.whatsapp_endpoint_id is null;

-- Make conversations.branch_id nullable
alter table public.conversations
  alter column branch_id drop not null;

-- Update compound FK on conversations to allow nullable branch_id
-- In Postgres standard, foreign key constraint allows NULL values for branch_id.

-- Update trigger enforce_resource_branch_gym_match on conversations to permit null branch_id
create or replace function public.enforce_resource_branch_gym_match()
returns trigger
language plpgsql
as $$
begin
  if new.branch_id is not null and not exists (
    select 1
    from public.branches b
    where b.id = new.branch_id
      and b.gym_id = new.gym_id
  ) then
    raise exception 'branch_id must belong to the resource gym';
  end if;

  return new;
end;
$$;

-- Add integrity trigger: conversation endpoint must belong to conversation gym
create or replace function public.enforce_conversation_endpoint_gym_match()
returns trigger
language plpgsql
as $$
begin
  if new.whatsapp_endpoint_id is not null and not exists (
    select 1
    from public.whatsapp_endpoints e
    where e.id = new.whatsapp_endpoint_id
      and e.gym_id = new.gym_id
  ) then
    raise exception 'whatsapp_endpoint_id must belong to the conversation gym';
  end if;

  return new;
end;
$$;

drop trigger if exists conversations_endpoint_gym_match on public.conversations;
create trigger conversations_endpoint_gym_match
  before insert or update on public.conversations
  for each row
  execute function public.enforce_conversation_endpoint_gym_match();

-- 6. Update conversation uniqueness constraints
-- Drop the old branch-specific unique constraint/index
alter table public.conversations
  drop constraint if exists conversations_gym_branch_customer_phone_key;

drop index if exists public.conversations_gym_branch_customer_phone_key;

-- Unique identity based on gym + whatsapp_endpoint_id + customer_phone
create unique index if not exists conversations_gym_endpoint_customer_phone_key
  on public.conversations(gym_id, whatsapp_endpoint_id, customer_phone)
  where whatsapp_endpoint_id is not null;

-- Fallback unique identity for non-endpoint channels (e.g. simulator, playground)
create unique index if not exists conversations_gym_null_endpoint_customer_phone_key
  on public.conversations(gym_id, customer_phone, source)
  where whatsapp_endpoint_id is null;

-- 7. Update RLS policies on conversations for nullable branch_id and endpoint safety
drop policy if exists "conversations: branch-safe insert" on public.conversations;
create policy "conversations: branch-safe insert"
  on public.conversations
  for insert
  to authenticated
  with check (
    gym_id in (select id from public.gyms where owner_user_id = auth.uid())
    and (
      conversations.branch_id is null
      or exists (
        select 1 from public.branches b
        where b.id = conversations.branch_id and b.gym_id = conversations.gym_id
      )
    )
    and (
      conversations.whatsapp_endpoint_id is null
      or exists (
        select 1 from public.whatsapp_endpoints e
        where e.id = conversations.whatsapp_endpoint_id and e.gym_id = conversations.gym_id
      )
    )
  );

drop policy if exists "conversations: branch-safe update" on public.conversations;
create policy "conversations: branch-safe update"
  on public.conversations
  for update
  to authenticated
  using (
    gym_id in (select id from public.gyms where owner_user_id = auth.uid())
  )
  with check (
    gym_id in (select id from public.gyms where owner_user_id = auth.uid())
    and (
      conversations.branch_id is null
      or exists (
        select 1 from public.branches b
        where b.id = conversations.branch_id and b.gym_id = conversations.gym_id
      )
    )
    and (
      conversations.whatsapp_endpoint_id is null
      or exists (
        select 1 from public.whatsapp_endpoints e
        where e.id = conversations.whatsapp_endpoint_id and e.gym_id = conversations.gym_id
      )
    )
  );

-- 8. Create production-safe resolve_whatsapp_endpoint RPC
create or replace function public.resolve_whatsapp_endpoint(
  p_phone_number_id text,
  p_display_phone_number text
)
returns table(
  gym_id uuid,
  endpoint_id uuid,
  branch_id uuid
)
language sql
security definer
set search_path = public
stable
as $$
  with matched_by_endpoint_phone_id as (
    select
      e.gym_id,
      e.id as endpoint_id,
      e.branch_id
    from public.whatsapp_endpoints e
    where p_phone_number_id is not null
      and e.phone_number_id = p_phone_number_id
      and e.is_active = true
    limit 1
  ),

  matched_by_endpoint_phone_number as (
    select
      e.gym_id,
      e.id as endpoint_id,
      e.branch_id
    from public.whatsapp_endpoints e
    where p_display_phone_number is not null
      and regexp_replace(e.phone_number, '\D', '', 'g') = regexp_replace(p_display_phone_number, '\D', '', 'g')
      and e.is_active = true
      and not exists (select 1 from matched_by_endpoint_phone_id)
    limit 1
  ),

  matched_by_legacy_branch as (
    select
      b.gym_id,
      null::uuid as endpoint_id,
      b.id as branch_id
    from public.branches b
    where not exists (select 1 from matched_by_endpoint_phone_id)
      and not exists (select 1 from matched_by_endpoint_phone_number)
      and (
        (p_phone_number_id is not null and b.whatsapp_phone_number_id = p_phone_number_id)
        or (p_display_phone_number is not null and regexp_replace(b.whatsapp_number, '\D', '', 'g') = regexp_replace(p_display_phone_number, '\D', '', 'g'))
      )
    limit 1
  ),

  matched_by_legacy_gym as (
    select
      g.id as gym_id,
      null::uuid as endpoint_id,
      null::uuid as branch_id
    from public.gyms g
    where not exists (select 1 from matched_by_endpoint_phone_id)
      and not exists (select 1 from matched_by_endpoint_phone_number)
      and not exists (select 1 from matched_by_legacy_branch)
      and p_display_phone_number is not null
      and regexp_replace(g.whatsapp_number, '\D', '', 'g') = regexp_replace(p_display_phone_number, '\D', '', 'g')
    limit 1
  )

  select gym_id, endpoint_id, branch_id from matched_by_endpoint_phone_id
  union all
  select gym_id, endpoint_id, branch_id from matched_by_endpoint_phone_number
  union all
  select gym_id, endpoint_id, branch_id from matched_by_legacy_branch
  union all
  select gym_id, endpoint_id, branch_id from matched_by_legacy_gym;
$$;

-- Maintain backwards-compatible resolve_whatsapp_branch wrapper
create or replace function public.resolve_whatsapp_branch(
  p_phone_number_id text,
  p_display_phone_number text
)
returns table(
  gym_id uuid,
  branch_id uuid
)
language sql
security definer
set search_path = public
stable
as $$
  select r.gym_id, r.branch_id
  from public.resolve_whatsapp_endpoint(p_phone_number_id, p_display_phone_number) r;
$$;
