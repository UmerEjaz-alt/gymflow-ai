-- Branch-local country context is required only when owners import local-format
-- phone numbers. Existing branches remain unset rather than assuming a country.
alter table public.branches add column if not exists country_code text;

alter table public.branches drop constraint if exists branches_country_code_format;
alter table public.branches add constraint branches_country_code_format
  check (country_code is null or country_code ~ '^[A-Z]{2}$');

-- Creates or converts the branch-local customer conversation and membership in
-- one transaction. Phone canonicalisation and all file parsing stay in the app;
-- this function enforces tenant, branch, package, and expiry integrity.
create or replace function public.import_member_to_branch(
  p_branch_id uuid,
  p_customer_name text,
  p_customer_phone text,
  p_membership_package_id uuid,
  p_start_date date,
  p_expiry_date date default null
)
returns public.memberships
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_gym_id uuid;
  v_conversation public.conversations;
  v_package public.membership_packages;
  v_expiry_date date;
  v_membership public.memberships;
begin
  select b.gym_id into v_gym_id
  from public.branches b
  join public.gyms g on g.id = b.gym_id
  where b.id = p_branch_id and g.owner_user_id = auth.uid();

  if v_gym_id is null then raise exception 'Branch not found.'; end if;
  if p_customer_name is null or btrim(p_customer_name) = '' then
    raise exception 'Member name is required.';
  end if;
  if p_customer_phone is null or btrim(p_customer_phone) = '' then
    raise exception 'Member phone is required.';
  end if;
  if p_start_date is null then raise exception 'Membership start date is required.'; end if;

  select * into v_package
  from public.membership_packages
  where id = p_membership_package_id
    and gym_id = v_gym_id
    and branch_id = p_branch_id
    and active = true;
  if not found then raise exception 'Membership package not found or inactive.'; end if;

  v_expiry_date := coalesce(
    p_expiry_date,
    (p_start_date + make_interval(months => v_package.duration_months))::date
  );
  if v_expiry_date <= p_start_date then
    raise exception 'Membership expiry date must be after the start date.';
  end if;

  select * into v_conversation
  from public.conversations
  where gym_id = v_gym_id
    and branch_id = p_branch_id
    and customer_phone = btrim(p_customer_phone)
  for update;

  if found then
    if exists (select 1 from public.memberships m where m.conversation_id = v_conversation.id) then
      raise exception 'Member already exists for this phone number.';
    end if;
    update public.conversations
    set customer_name = btrim(p_customer_name), lead_stage = 'member'
    where id = v_conversation.id
    returning * into v_conversation;
  else
    insert into public.conversations (
      gym_id, branch_id, customer_name, customer_phone, source, lead_stage
    ) values (
      v_gym_id, p_branch_id, btrim(p_customer_name), btrim(p_customer_phone), 'import', 'member'
    ) returning * into v_conversation;
  end if;

  insert into public.memberships (
    gym_id, branch_id, conversation_id, membership_package_id, start_date, expiry_date
  ) values (
    v_gym_id, p_branch_id, v_conversation.id, v_package.id, p_start_date, v_expiry_date
  ) returning * into v_membership;

  return v_membership;
end;
$$;
