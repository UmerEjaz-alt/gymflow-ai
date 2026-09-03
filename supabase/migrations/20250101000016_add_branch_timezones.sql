-- Canonical IANA timezone for each physical branch. Existing GymFlow branches
-- are backfilled from the product's established Pakistan deployment only.
alter table public.branches add column timezone text;

update public.branches
set timezone = 'Asia/Karachi'
where timezone is null;

alter table public.branches
  add constraint branches_timezone_valid
    check (public.is_valid_iana_timezone(timezone));

-- Future direct branch inserts must supply a timezone through the application.
-- The automatic default branch has no physical location yet, so its timezone
-- remains NULL until onboarding configures it. Time-sensitive features block
-- rather than silently scheduling in an assumed timezone.
create or replace function public.create_default_branch_for_gym()
returns trigger
language plpgsql
as $$
begin
  insert into public.branches(
    gym_id, branch_name, is_default, address, city, phone, whatsapp_number,
    opening_hours, trial_policy, visit_policy, faqs, ai_communication_style,
    timezone
  ) values (
    new.id, new.gym_name, true, new.address, new.city, new.phone,
    new.whatsapp_number, new.opening_hours, new.trial_policy, new.visit_policy,
    coalesce(new.faqs, '[]'::jsonb), new.ai_communication_style, null
  );
  return new;
end
$$;

-- Existing offer rows keep their stored timezone as a legacy absolute-window
-- fallback. New all-branch offers opt into branch-local wall-clock scheduling.
alter table public.offers
  add column uses_branch_timezone boolean not null default false;
