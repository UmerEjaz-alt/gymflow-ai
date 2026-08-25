-- ============================================================================
-- Migration: Add General Gym Policies
-- File: 20250101000013_add_general_policies.sql
-- Description:
--   - Adds general_policies column to public.gyms and public.branches.
--   - Updates create_default_branch_for_gym trigger function to copy general_policies.
-- ============================================================================

-- 1. Add general_policies column to gyms and branches
alter table public.gyms
  add column if not exists general_policies text;

alter table public.branches
  add column if not exists general_policies text;

-- 2. Update default branch creation trigger function to include general_policies
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
    general_policies,
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
    new.general_policies,
    new.trial_policy,
    new.visit_policy,
    coalesce(new.faqs, '[]'::jsonb),
    new.ai_communication_style
  );

  return new;
end;
$$;

-- 3. Backfill default branch for existing gyms if general_policies exists on gyms
update public.branches b
set general_policies = g.general_policies
from public.gyms g
where g.id = b.gym_id
  and b.is_default = true
  and b.general_policies is null
  and g.general_policies is not null;
