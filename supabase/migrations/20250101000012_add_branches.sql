-- ============================================================================
-- Migration: Add Branches (Multi-Branch Architecture)
-- File: 20250101000012_add_branches.sql
-- Description:
--   - Introduces public.branches table for multi-branch gym tenancy.
--   - Scopes all operational resources to (gym_id, branch_id).
--   - Automatically creates and backfills a default branch for existing gyms.
--   - Guarantees database-level compound foreign keys, RLS, and consistency triggers.
--   - Ensures WhatsApp routing resolves strictly to concrete non-null branches.
-- ============================================================================


-- ============================================================================
-- 1. Create Branches Table
-- ============================================================================

create table if not exists public.branches (
  id uuid primary key default gen_random_uuid(),
  gym_id uuid not null references public.gyms(id) on delete cascade,
  branch_name text not null,
  is_default boolean not null default false,
  address text,
  city text,
  phone text,
  whatsapp_number text,
  whatsapp_phone_number_id text,
  google_maps_url text,
  opening_hours jsonb,
  trial_policy text,
  visit_policy text,
  refund_policy text,
  freeze_policy text,
  cancellation_policy text,
  guest_policy text,
  membership_transfer_policy text,
  faqs jsonb not null default '[]'::jsonb,
  ai_communication_style text,
  ai_instructions text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (jsonb_typeof(faqs) = 'array')
);


-- ============================================================================
-- 2. Indexes and Unique Constraints on Branches
-- ============================================================================

create unique index if not exists branches_one_default_per_gym
  on public.branches(gym_id)
  where is_default;

create unique index if not exists branches_meta_phone_id_unique
  on public.branches(whatsapp_phone_number_id)
  where whatsapp_phone_number_id is not null;

create unique index if not exists branches_whatsapp_number_normalized_unique
  on public.branches(regexp_replace(whatsapp_number, '\D', '', 'g'))
  where whatsapp_number is not null;

create index if not exists branches_gym_id_idx
  on public.branches(gym_id);

create unique index if not exists branches_id_gym_id_unique
  on public.branches(id, gym_id);


-- ============================================================================
-- 3. Automatic updated_at trigger for branches
-- ============================================================================

drop trigger if exists branches_set_updated_at on public.branches;

create trigger branches_set_updated_at
  before update on public.branches
  for each row
  execute procedure public.set_updated_at();


-- ============================================================================
-- 4. Default branch creation on new gym insert
-- ============================================================================

create or replace function public.create_default_branch_for_gym()
returns trigger
language plpgsql
as $$
begin
  insert into public.branches(
    gym_id,
    branch_name,
    is_default,
    address,
    city,
    phone,
    whatsapp_number,
    opening_hours,
    trial_policy,
    visit_policy,
    faqs,
    ai_communication_style
  )
  values (
    new.id,
    new.gym_name,
    true,
    new.address,
    new.city,
    new.phone,
    new.whatsapp_number,
    new.opening_hours,
    new.trial_policy,
    new.visit_policy,
    coalesce(new.faqs, '[]'::jsonb),
    new.ai_communication_style
  );

  return new;
end
$$;

drop trigger if exists gyms_create_default_branch on public.gyms;

create trigger gyms_create_default_branch
  after insert on public.gyms
  for each row
  execute procedure public.create_default_branch_for_gym();


-- ============================================================================
-- 5. Enable RLS on branches table
-- ============================================================================

alter table public.branches enable row level security;

drop policy if exists "branches: gym owner can select"
  on public.branches;

create policy "branches: gym owner can select"
  on public.branches
  for select
  to authenticated
  using (
    gym_id in (
      select id
      from public.gyms
      where owner_user_id = auth.uid()
    )
  );


drop policy if exists "branches: gym owner can insert"
  on public.branches;

create policy "branches: gym owner can insert"
  on public.branches
  for insert
  to authenticated
  with check (
    gym_id in (
      select id
      from public.gyms
      where owner_user_id = auth.uid()
    )
  );


drop policy if exists "branches: gym owner can update"
  on public.branches;

create policy "branches: gym owner can update"
  on public.branches
  for update
  to authenticated
  using (
    gym_id in (
      select id
      from public.gyms
      where owner_user_id = auth.uid()
    )
  )
  with check (
    gym_id in (
      select id
      from public.gyms
      where owner_user_id = auth.uid()
    )
  );


drop policy if exists "branches: gym owner can delete"
  on public.branches;

create policy "branches: gym owner can delete"
  on public.branches
  for delete
  to authenticated
  using (
    gym_id in (
      select id
      from public.gyms
      where owner_user_id = auth.uid()
    )
  );


-- ============================================================================
-- 6. Add branch_id columns to operational tables
-- ============================================================================

alter table public.membership_packages
  add column if not exists branch_id uuid
  references public.branches(id)
  on delete restrict;

alter table public.trainers
  add column if not exists branch_id uuid
  references public.branches(id)
  on delete restrict;

alter table public.facilities
  add column if not exists branch_id uuid
  references public.branches(id)
  on delete restrict;

alter table public.media_assets
  add column if not exists branch_id uuid
  references public.branches(id)
  on delete restrict;

alter table public.conversations
  add column if not exists branch_id uuid
  references public.branches(id)
  on delete restrict;

alter table public.memberships
  add column if not exists branch_id uuid
  references public.branches(id)
  on delete restrict;

alter table public.automation_configs
  add column if not exists branch_id uuid
  references public.branches(id)
  on delete restrict;

alter table public.automation_executions
  add column if not exists branch_id uuid
  references public.branches(id)
  on delete restrict;


-- ============================================================================
-- 7. Backfill default branch for existing gyms without a default branch
-- ============================================================================

insert into public.branches(
  gym_id,
  branch_name,
  is_default,
  address,
  city,
  phone,
  whatsapp_number,
  opening_hours,
  trial_policy,
  visit_policy,
  faqs,
  ai_communication_style
)
select
  g.id,
  g.gym_name,
  true,
  g.address,
  g.city,
  g.phone,
  g.whatsapp_number,
  g.opening_hours,
  g.trial_policy,
  g.visit_policy,
  coalesce(g.faqs, '[]'::jsonb),
  g.ai_communication_style
from public.gyms g
where not exists (
  select 1
  from public.branches b
  where b.gym_id = g.id
    and b.is_default = true
);


-- ============================================================================
-- 8. Backfill legacy records to each gym's default branch
-- ============================================================================

update public.membership_packages r
set branch_id = b.id
from public.branches b
where b.gym_id = r.gym_id
  and b.is_default = true
  and r.branch_id is null;

update public.trainers r
set branch_id = b.id
from public.branches b
where b.gym_id = r.gym_id
  and b.is_default = true
  and r.branch_id is null;

update public.facilities r
set branch_id = b.id
from public.branches b
where b.gym_id = r.gym_id
  and b.is_default = true
  and r.branch_id is null;

update public.media_assets r
set branch_id = b.id
from public.branches b
where b.gym_id = r.gym_id
  and b.is_default = true
  and r.branch_id is null;

update public.conversations r
set branch_id = b.id
from public.branches b
where b.gym_id = r.gym_id
  and b.is_default = true
  and r.branch_id is null;

update public.memberships r
set branch_id = b.id
from public.branches b
where b.gym_id = r.gym_id
  and b.is_default = true
  and r.branch_id is null;

update public.automation_configs r
set branch_id = b.id
from public.branches b
where b.gym_id = r.gym_id
  and b.is_default = true
  and r.branch_id is null;

update public.automation_executions r
set branch_id = b.id
from public.branches b
where b.gym_id = r.gym_id
  and b.is_default = true
  and r.branch_id is null;


-- ============================================================================
-- 9. Enforce NOT NULL on branch_id
-- ============================================================================

alter table public.membership_packages
  alter column branch_id set not null;

alter table public.trainers
  alter column branch_id set not null;

alter table public.facilities
  alter column branch_id set not null;

alter table public.media_assets
  alter column branch_id set not null;

alter table public.conversations
  alter column branch_id set not null;

alter table public.memberships
  alter column branch_id set not null;

alter table public.automation_configs
  alter column branch_id set not null;

alter table public.automation_executions
  alter column branch_id set not null;


-- ============================================================================
-- 10. Native compound foreign keys
-- ============================================================================

alter table public.membership_packages
  drop constraint if exists membership_packages_branch_gym_fk;

alter table public.membership_packages
  add constraint membership_packages_branch_gym_fk
  foreign key (branch_id, gym_id)
  references public.branches(id, gym_id)
  on delete restrict;


alter table public.trainers
  drop constraint if exists trainers_branch_gym_fk;

alter table public.trainers
  add constraint trainers_branch_gym_fk
  foreign key (branch_id, gym_id)
  references public.branches(id, gym_id)
  on delete restrict;


alter table public.facilities
  drop constraint if exists facilities_branch_gym_fk;

alter table public.facilities
  add constraint facilities_branch_gym_fk
  foreign key (branch_id, gym_id)
  references public.branches(id, gym_id)
  on delete restrict;


alter table public.media_assets
  drop constraint if exists media_assets_branch_gym_fk;

alter table public.media_assets
  add constraint media_assets_branch_gym_fk
  foreign key (branch_id, gym_id)
  references public.branches(id, gym_id)
  on delete restrict;


alter table public.conversations
  drop constraint if exists conversations_branch_gym_fk;

alter table public.conversations
  add constraint conversations_branch_gym_fk
  foreign key (branch_id, gym_id)
  references public.branches(id, gym_id)
  on delete restrict;


alter table public.memberships
  drop constraint if exists memberships_branch_gym_fk;

alter table public.memberships
  add constraint memberships_branch_gym_fk
  foreign key (branch_id, gym_id)
  references public.branches(id, gym_id)
  on delete restrict;


alter table public.automation_configs
  drop constraint if exists automation_configs_branch_gym_fk;

alter table public.automation_configs
  add constraint automation_configs_branch_gym_fk
  foreign key (branch_id, gym_id)
  references public.branches(id, gym_id)
  on delete restrict;


alter table public.automation_executions
  drop constraint if exists automation_executions_branch_gym_fk;

alter table public.automation_executions
  add constraint automation_executions_branch_gym_fk
  foreign key (branch_id, gym_id)
  references public.branches(id, gym_id)
  on delete restrict;


-- ============================================================================
-- 11. Unique constraints and indexes
-- ============================================================================

alter table public.automation_configs
  drop constraint if exists automation_configs_gym_id_automation_type_key;

alter table public.automation_configs
  drop constraint if exists automation_configs_gym_branch_type_key;

alter table public.automation_configs
  add constraint automation_configs_gym_branch_type_key
  unique (gym_id, branch_id, automation_type);


-- Remove the old gym-wide conversation uniqueness if it exists.
alter table public.conversations
  drop constraint if exists conversations_gym_id_customer_phone_key;

drop index if exists public.conversations_gym_id_customer_phone_key;

create unique index if not exists conversations_gym_branch_customer_phone_key
  on public.conversations(gym_id, branch_id, customer_phone);


create index if not exists membership_packages_gym_branch_idx
  on public.membership_packages(gym_id, branch_id);

create index if not exists trainers_gym_branch_idx
  on public.trainers(gym_id, branch_id);

create index if not exists facilities_gym_branch_idx
  on public.facilities(gym_id, branch_id);

create index if not exists media_assets_gym_branch_idx
  on public.media_assets(gym_id, branch_id);

create index if not exists conversations_gym_branch_idx
  on public.conversations(gym_id, branch_id);

create index if not exists memberships_gym_branch_idx
  on public.memberships(gym_id, branch_id);

create index if not exists automation_configs_gym_branch_idx
  on public.automation_configs(gym_id, branch_id);

create index if not exists automation_executions_gym_branch_idx
  on public.automation_executions(gym_id, branch_id);


-- ============================================================================
-- 12. Integrity trigger:
--     branch must belong to the same gym as the resource
-- ============================================================================

create or replace function public.enforce_resource_branch_gym_match()
returns trigger
language plpgsql
as $$
begin
  if not exists (
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


drop trigger if exists membership_packages_branch_gym_match
  on public.membership_packages;

create trigger membership_packages_branch_gym_match
  before insert or update on public.membership_packages
  for each row
  execute function public.enforce_resource_branch_gym_match();


drop trigger if exists trainers_branch_gym_match
  on public.trainers;

create trigger trainers_branch_gym_match
  before insert or update on public.trainers
  for each row
  execute function public.enforce_resource_branch_gym_match();


drop trigger if exists facilities_branch_gym_match
  on public.facilities;

create trigger facilities_branch_gym_match
  before insert or update on public.facilities
  for each row
  execute function public.enforce_resource_branch_gym_match();


drop trigger if exists media_assets_branch_gym_match
  on public.media_assets;

create trigger media_assets_branch_gym_match
  before insert or update on public.media_assets
  for each row
  execute function public.enforce_resource_branch_gym_match();


drop trigger if exists conversations_branch_gym_match
  on public.conversations;

create trigger conversations_branch_gym_match
  before insert or update on public.conversations
  for each row
  execute function public.enforce_resource_branch_gym_match();


drop trigger if exists memberships_branch_gym_match
  on public.memberships;

create trigger memberships_branch_gym_match
  before insert or update on public.memberships
  for each row
  execute function public.enforce_resource_branch_gym_match();


drop trigger if exists automation_configs_branch_gym_match
  on public.automation_configs;

create trigger automation_configs_branch_gym_match
  before insert or update on public.automation_configs
  for each row
  execute function public.enforce_resource_branch_gym_match();


drop trigger if exists automation_executions_branch_gym_match
  on public.automation_executions;

create trigger automation_executions_branch_gym_match
  before insert or update on public.automation_executions
  for each row
  execute function public.enforce_resource_branch_gym_match();


-- ============================================================================
-- 13. Consistency triggers for memberships and automation executions
-- ============================================================================

create or replace function public.enforce_membership_branch_consistency()
returns trigger
language plpgsql
as $$
begin
  if not exists (
    select 1
    from public.conversations c
    where c.id = new.conversation_id
      and c.gym_id = new.gym_id
      and c.branch_id = new.branch_id
  ) then
    raise exception 'membership must match conversation branch';
  end if;

  if not exists (
    select 1
    from public.membership_packages p
    where p.id = new.membership_package_id
      and p.gym_id = new.gym_id
      and p.branch_id = new.branch_id
  ) then
    raise exception 'membership package must match membership branch';
  end if;

  return new;
end;
$$;


drop trigger if exists memberships_branch_consistency
  on public.memberships;

create trigger memberships_branch_consistency
  before insert or update on public.memberships
  for each row
  execute function public.enforce_membership_branch_consistency();


create or replace function public.enforce_automation_execution_branch_consistency()
returns trigger
language plpgsql
as $$
begin
  if not exists (
    select 1
    from public.automation_configs c
    where c.id = new.automation_config_id
      and c.gym_id = new.gym_id
      and c.branch_id = new.branch_id
  ) then
    raise exception 'automation execution must match config branch';
  end if;

  if not exists (
    select 1
    from public.conversations c
    where c.id = new.conversation_id
      and c.gym_id = new.gym_id
      and c.branch_id = new.branch_id
  ) then
    raise exception 'automation execution must match conversation branch';
  end if;

  return new;
end;
$$;


drop trigger if exists automation_executions_branch_consistency
  on public.automation_executions;

create trigger automation_executions_branch_consistency
  before insert or update on public.automation_executions
  for each row
  execute function public.enforce_automation_execution_branch_consistency();


-- ============================================================================
-- 14. Lead to Member conversion RPC
-- ============================================================================

create or replace function public.convert_conversation_to_member(
  p_conversation_id uuid,
  p_membership_package_id uuid,
  p_customer_name text,
  p_customer_phone text,
  p_start_date date
)
returns public.memberships
language plpgsql
security invoker
set search_path = public
as $$
declare
  c public.conversations;
  p public.membership_packages;
  m public.memberships;
begin
  select *
  into c
  from public.conversations
  where id = p_conversation_id
  for update;

  if not found
     or not exists (
       select 1
       from public.gyms
       where id = c.gym_id
         and owner_user_id = auth.uid()
     )
  then
    raise exception 'Conversation not found.';
  end if;

  if c.branch_id is null then
    raise exception 'Choose a branch before converting this customer to a member.';
  end if;

  select *
  into p
  from public.membership_packages
  where id = p_membership_package_id
    and gym_id = c.gym_id
    and branch_id = c.branch_id
    and active = true;

  if not found then
    raise exception 'Membership package does not belong to this conversation branch or is inactive.';
  end if;

  if nullif(btrim(p_customer_name), '') is null
     or nullif(btrim(p_customer_phone), '') is null
  then
    raise exception 'Name and phone are required.';
  end if;

  update public.conversations
  set customer_name = btrim(p_customer_name),
      customer_phone = btrim(p_customer_phone),
      lead_stage = 'member'
  where id = c.id;

  insert into public.memberships(
    gym_id,
    branch_id,
    conversation_id,
    membership_package_id,
    start_date,
    expiry_date
  )
  values (
    c.gym_id,
    c.branch_id,
    c.id,
    p.id,
    p_start_date,
    (p_start_date + make_interval(months => p.duration_months))::date
  )
  returning *
  into m;

  return m;
end;
$$;


-- ============================================================================
-- 15. WhatsApp destination routing:
--     strictly resolves to a concrete branch
-- ============================================================================

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
  with matched_by_phone_id as (
    select
      b.gym_id,
      b.id as branch_id
    from public.branches b
    where p_phone_number_id is not null
      and b.whatsapp_phone_number_id = p_phone_number_id
  ),

  matched_by_branch_number as (
    select
      b.gym_id,
      b.id as branch_id
    from public.branches b
    where p_phone_number_id is null
      and p_display_phone_number is not null
      and regexp_replace(
        b.whatsapp_number,
        '\D',
        '',
        'g'
      ) = regexp_replace(
        p_display_phone_number,
        '\D',
        '',
        'g'
      )
  ),

  matched_by_gym_number as (
    select
      g.id as gym_id,
      b.id as branch_id
    from public.gyms g
    join public.branches b
      on b.gym_id = g.id
     and b.is_default = true
    where p_phone_number_id is null
      and p_display_phone_number is not null
      and regexp_replace(
        g.whatsapp_number,
        '\D',
        '',
        'g'
      ) = regexp_replace(
        p_display_phone_number,
        '\D',
        '',
        'g'
      )
      and not exists (
        select 1
        from public.branches b2
        where regexp_replace(
          b2.whatsapp_number,
          '\D',
          '',
          'g'
        ) = regexp_replace(
          p_display_phone_number,
          '\D',
          '',
          'g'
        )
      )
  )

  select gym_id, branch_id
  from matched_by_phone_id

  union all

  select gym_id, branch_id
  from matched_by_branch_number

  union all

  select gym_id, branch_id
  from matched_by_gym_number;
$$;


-- ============================================================================
-- 16. Update RLS policies for branch-scoped write safety (Explicit static DDL)
-- ============================================================================

-- 16.1. membership_packages
drop policy if exists "membership_packages: gym owner can insert" on public.membership_packages;
drop policy if exists "membership_packages: gym owner can update" on public.membership_packages;
drop policy if exists "membership_packages: branch-safe insert" on public.membership_packages;
drop policy if exists "membership_packages: branch-safe update" on public.membership_packages;

create policy "membership_packages: branch-safe insert"
  on public.membership_packages
  for insert
  to authenticated
  with check (
    gym_id in (select id from public.gyms where owner_user_id = auth.uid())
    and exists (select 1 from public.branches b where b.id = membership_packages.branch_id and b.gym_id = membership_packages.gym_id)
  );

create policy "membership_packages: branch-safe update"
  on public.membership_packages
  for update
  to authenticated
  using (
    gym_id in (select id from public.gyms where owner_user_id = auth.uid())
  )
  with check (
    gym_id in (select id from public.gyms where owner_user_id = auth.uid())
    and exists (select 1 from public.branches b where b.id = membership_packages.branch_id and b.gym_id = membership_packages.gym_id)
  );

-- 16.2. trainers
drop policy if exists "trainers: gym owner can insert" on public.trainers;
drop policy if exists "trainers: gym owner can update" on public.trainers;
drop policy if exists "trainers: branch-safe insert" on public.trainers;
drop policy if exists "trainers: branch-safe update" on public.trainers;

create policy "trainers: branch-safe insert"
  on public.trainers
  for insert
  to authenticated
  with check (
    gym_id in (select id from public.gyms where owner_user_id = auth.uid())
    and exists (select 1 from public.branches b where b.id = trainers.branch_id and b.gym_id = trainers.gym_id)
  );

create policy "trainers: branch-safe update"
  on public.trainers
  for update
  to authenticated
  using (
    gym_id in (select id from public.gyms where owner_user_id = auth.uid())
  )
  with check (
    gym_id in (select id from public.gyms where owner_user_id = auth.uid())
    and exists (select 1 from public.branches b where b.id = trainers.branch_id and b.gym_id = trainers.gym_id)
  );

-- 16.3. facilities
drop policy if exists "facilities: gym owner can insert" on public.facilities;
drop policy if exists "facilities: gym owner can update" on public.facilities;
drop policy if exists "facilities: branch-safe insert" on public.facilities;
drop policy if exists "facilities: branch-safe update" on public.facilities;

create policy "facilities: branch-safe insert"
  on public.facilities
  for insert
  to authenticated
  with check (
    gym_id in (select id from public.gyms where owner_user_id = auth.uid())
    and exists (select 1 from public.branches b where b.id = facilities.branch_id and b.gym_id = facilities.gym_id)
  );

create policy "facilities: branch-safe update"
  on public.facilities
  for update
  to authenticated
  using (
    gym_id in (select id from public.gyms where owner_user_id = auth.uid())
  )
  with check (
    gym_id in (select id from public.gyms where owner_user_id = auth.uid())
    and exists (select 1 from public.branches b where b.id = facilities.branch_id and b.gym_id = facilities.gym_id)
  );

-- 16.4. media_assets
drop policy if exists "media_assets: gym owner can insert" on public.media_assets;
drop policy if exists "media_assets: gym owner can update" on public.media_assets;
drop policy if exists "media_assets: branch-safe insert" on public.media_assets;
drop policy if exists "media_assets: branch-safe update" on public.media_assets;

create policy "media_assets: branch-safe insert"
  on public.media_assets
  for insert
  to authenticated
  with check (
    gym_id in (select id from public.gyms where owner_user_id = auth.uid())
    and exists (select 1 from public.branches b where b.id = media_assets.branch_id and b.gym_id = media_assets.gym_id)
  );

create policy "media_assets: branch-safe update"
  on public.media_assets
  for update
  to authenticated
  using (
    gym_id in (select id from public.gyms where owner_user_id = auth.uid())
  )
  with check (
    gym_id in (select id from public.gyms where owner_user_id = auth.uid())
    and exists (select 1 from public.branches b where b.id = media_assets.branch_id and b.gym_id = media_assets.gym_id)
  );

-- 16.5. conversations
drop policy if exists "conversations: gym owner can insert" on public.conversations;
drop policy if exists "conversations: gym owner can update" on public.conversations;
drop policy if exists "conversations: branch-safe insert" on public.conversations;
drop policy if exists "conversations: branch-safe update" on public.conversations;

create policy "conversations: branch-safe insert"
  on public.conversations
  for insert
  to authenticated
  with check (
    gym_id in (select id from public.gyms where owner_user_id = auth.uid())
    and exists (select 1 from public.branches b where b.id = conversations.branch_id and b.gym_id = conversations.gym_id)
  );

create policy "conversations: branch-safe update"
  on public.conversations
  for update
  to authenticated
  using (
    gym_id in (select id from public.gyms where owner_user_id = auth.uid())
  )
  with check (
    gym_id in (select id from public.gyms where owner_user_id = auth.uid())
    and exists (select 1 from public.branches b where b.id = conversations.branch_id and b.gym_id = conversations.gym_id)
  );

-- 16.6. memberships
drop policy if exists "memberships: gym owner can insert" on public.memberships;
drop policy if exists "memberships: gym owner can update" on public.memberships;
drop policy if exists "memberships: branch-safe insert" on public.memberships;
drop policy if exists "memberships: branch-safe update" on public.memberships;

create policy "memberships: branch-safe insert"
  on public.memberships
  for insert
  to authenticated
  with check (
    gym_id in (select id from public.gyms where owner_user_id = auth.uid())
    and exists (select 1 from public.branches b where b.id = memberships.branch_id and b.gym_id = memberships.gym_id)
  );

create policy "memberships: branch-safe update"
  on public.memberships
  for update
  to authenticated
  using (
    gym_id in (select id from public.gyms where owner_user_id = auth.uid())
  )
  with check (
    gym_id in (select id from public.gyms where owner_user_id = auth.uid())
    and exists (select 1 from public.branches b where b.id = memberships.branch_id and b.gym_id = memberships.gym_id)
  );

-- 16.7. automation_configs
drop policy if exists "automation_configs: gym owner can insert" on public.automation_configs;
drop policy if exists "automation_configs: gym owner can update" on public.automation_configs;
drop policy if exists "automation_configs: branch-safe insert" on public.automation_configs;
drop policy if exists "automation_configs: branch-safe update" on public.automation_configs;

create policy "automation_configs: branch-safe insert"
  on public.automation_configs
  for insert
  to authenticated
  with check (
    gym_id in (select id from public.gyms where owner_user_id = auth.uid())
    and exists (select 1 from public.branches b where b.id = automation_configs.branch_id and b.gym_id = automation_configs.gym_id)
  );

create policy "automation_configs: branch-safe update"
  on public.automation_configs
  for update
  to authenticated
  using (
    gym_id in (select id from public.gyms where owner_user_id = auth.uid())
  )
  with check (
    gym_id in (select id from public.gyms where owner_user_id = auth.uid())
    and exists (select 1 from public.branches b where b.id = automation_configs.branch_id and b.gym_id = automation_configs.gym_id)
  );

-- 16.8. automation_executions
drop policy if exists "automation_executions: gym owner can insert" on public.automation_executions;
drop policy if exists "automation_executions: gym owner can update" on public.automation_executions;
drop policy if exists "automation_executions: branch-safe insert" on public.automation_executions;
drop policy if exists "automation_executions: branch-safe update" on public.automation_executions;

create policy "automation_executions: branch-safe insert"
  on public.automation_executions
  for insert
  to authenticated
  with check (
    gym_id in (select id from public.gyms where owner_user_id = auth.uid())
    and exists (select 1 from public.branches b where b.id = automation_executions.branch_id and b.gym_id = automation_executions.gym_id)
  );

create policy "automation_executions: branch-safe update"
  on public.automation_executions
  for update
  to authenticated
  using (
    gym_id in (select id from public.gyms where owner_user_id = auth.uid())
  )
  with check (
    gym_id in (select id from public.gyms where owner_user_id = auth.uid())
    and exists (select 1 from public.branches b where b.id = automation_executions.branch_id and b.gym_id = automation_executions.gym_id)
  );