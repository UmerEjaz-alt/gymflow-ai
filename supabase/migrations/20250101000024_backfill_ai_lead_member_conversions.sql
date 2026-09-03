-- Corrects the initial AI-lead history backfill after it was applied with a
-- narrower snapshot of lead states. `lead_stage` is mutable, so a successful
-- Lead -> Member conversion otherwise loses the evidence needed by all-time
-- analytics.
--
-- These rows are provable GymFlow AI journeys: they have an AI reply, a
-- membership linked to the same conversation, and were not created through
-- the explicit member-import path.
update public.conversations c
set ai_lead_at = (
  select min(m.created_at)
  from public.messages m
  where m.conversation_id = c.id
    and m.sender_type = 'ai'
)
where c.ai_lead_at is null
  and c.lead_stage = 'member'
  and c.source is distinct from 'import'
  and exists (
    select 1
    from public.memberships membership
    where membership.conversation_id = c.id
      and membership.gym_id = c.gym_id
      and membership.branch_id is not distinct from c.branch_id
  )
  and exists (
    select 1
    from public.messages m
    where m.conversation_id = c.id
      and m.sender_type = 'ai'
  );

-- Also cover still-active historical leads which were missed by the original
-- backfill. The active-lead rule is the same rule used by the Leads workspace.
update public.conversations c
set ai_lead_at = (
  select min(m.created_at)
  from public.messages m
  where m.conversation_id = c.id
    and m.sender_type = 'ai'
)
where c.ai_lead_at is null
  and c.lead_stage in ('new_lead', 'qualified', 'trial_booked')
  and exists (
    select 1
    from public.messages m
    where m.conversation_id = c.id
      and m.sender_type = 'ai'
  );

-- Preserve the historical marker atomically during every future Lead ->
-- Member conversion. This intentionally uses the existing lead-stage model
-- and persisted AI messages; it does not introduce a second lead definition.
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
      lead_stage = 'member',
      ai_lead_at = case
        when c.ai_lead_at is not null then c.ai_lead_at
        when c.lead_stage in ('new_lead', 'qualified', 'trial_booked')
          and exists (
            select 1
            from public.messages message
            where message.conversation_id = c.id
              and message.sender_type = 'ai'
          )
          then now()
        else null
      end
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
