-- Additive member identity. Applied migrations 1-34 remain untouched.
begin;

create table public.members (
  id uuid primary key default gen_random_uuid(),
  gym_id uuid not null references public.gyms(id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 200),
  phone_e164 text check (phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  email text check (email is null or length(email) <= 254),
  source text not null check (source in ('manual', 'import', 'lead_conversion', 'legacy')),
  created_by uuid references auth.users(id) on delete set null,
  identity_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, gym_id),
  unique (gym_id, phone_e164),
  constraint member_phone_required check (phone_e164 is not null or source = 'legacy')
);
create trigger members_updated_at before update on public.members
  for each row execute function public.set_updated_at();
alter table public.members enable row level security;
create policy members_owner_read on public.members for select to authenticated
  using (exists(select 1 from public.gyms g where g.id = gym_id and g.owner_user_id = auth.uid()));
grant select on public.members to authenticated;
grant all on public.members to service_role;

alter table public.conversations add column member_id uuid;
alter table public.conversations add constraint conversations_member_gym_fk
  foreign key (member_id, gym_id) references public.members(id, gym_id) on delete restrict;
create index conversations_member_id_idx on public.conversations(member_id) where member_id is not null;
alter table public.memberships add column member_id uuid;
alter table public.memberships add column source text not null default 'legacy';
alter table public.memberships add column created_by uuid references auth.users(id) on delete set null;
alter table public.memberships add column request_id uuid;
alter table public.memberships add column registration_input jsonb;
alter table public.memberships alter column conversation_id drop not null;
alter table public.memberships drop constraint memberships_conversation_id_fkey;
alter table public.memberships add constraint memberships_conversation_id_fkey
  foreign key (conversation_id) references public.conversations(id) on delete set null;
alter table public.memberships add constraint memberships_member_gym_fk
  foreign key (member_id, gym_id) references public.members(id, gym_id) on delete restrict;
create unique index memberships_request_id_idx on public.memberships(gym_id, request_id) where request_id is not null;
create index memberships_member_branch_dates_idx on public.memberships(member_id, branch_id, start_date, expiry_date);

-- Only unambiguous international representations are normalized in SQL.
-- Local/invalid phones remain quarantined, with their raw value preserved for
-- the libphonenumber-based review tool. Never guess a default calling country.
create function public.member_comparison_phone(p_phone text, p_source text)
returns text language sql immutable set search_path = public as $$
  select case when clean ~ '^\+[1-9][0-9]{7,14}$' then clean
    when p_source = 'whatsapp' and clean ~ '^[1-9][0-9]{7,14}$' then '+' || clean
    else null end
  from (select regexp_replace(btrim(p_phone), '[ ().-]', '', 'g') clean) s;
$$;

-- Conservative conflict detection, never identity assignment. A local-format
-- legacy phone with the same national-number suffix requires review. Unknown
-- identities do not block unrelated registrations throughout the entire gym.
create function public.member_legacy_phone_conflict(p_gym_id uuid, p_phone_e164 text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.members p
    where p.gym_id = p_gym_id and p.phone_e164 is null
      and coalesce((p.identity_metadata->>'identity_review_required')::boolean, false)
      and (public.member_comparison_phone(p.identity_metadata->>'raw_phone', 'whatsapp') = p_phone_e164
        or (p.identity_metadata->>'raw_phone' ~ '^[+0-9 ().-]+$'
          and length(ltrim(regexp_replace(p.identity_metadata->>'raw_phone', '[^0-9]', '', 'g'), '0')) >= 7
          and right(p_phone_e164, length(ltrim(regexp_replace(p.identity_metadata->>'raw_phone', '[^0-9]', '', 'g'), '0')))
            = ltrim(regexp_replace(p.identity_metadata->>'raw_phone', '[^0-9]', '', 'g'), '0'))));
$$;

-- Gym-level serialization also protects legacy writers during rolling deploys.
-- Conversation locks precede gym locks everywhere that needs both.
create function public.ensure_legacy_member(p_conversation_id uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare c public.conversations; person public.members; phone text; compatible boolean;
begin
  select * into c from public.conversations where id = p_conversation_id for update;
  if c.id is null then raise exception 'Conversation not found.'; end if;
  if c.member_id is not null then return c.member_id; end if;
  perform pg_advisory_xact_lock(hashtextextended('member-gym:' || c.gym_id, 0));
  phone := public.member_comparison_phone(c.customer_phone, c.source);
  compatible := phone is not null and nullif(btrim(c.customer_name), '') is not null and not exists (
    select 1 from public.conversations other
    where other.gym_id = c.gym_id and other.id <> c.id
      and exists(select 1 from public.memberships m where m.conversation_id = other.id)
      and public.member_comparison_phone(other.customer_phone, other.source) = phone
      and lower(regexp_replace(btrim(coalesce(other.customer_name, '')), '\s+', ' ', 'g'))
        is distinct from lower(regexp_replace(btrim(coalesce(c.customer_name, '')), '\s+', ' ', 'g'))
  );
  if compatible then
    select * into person from public.members where gym_id = c.gym_id and phone_e164 = phone for update;
    if person.id is not null and lower(regexp_replace(btrim(person.name), '\s+', ' ', 'g'))
      <> lower(regexp_replace(btrim(coalesce(c.customer_name, '')), '\s+', ' ', 'g')) then
      compatible := false;
    end if;
  end if;
  if not compatible then person := null; phone := null; end if;
  if person.id is null then
    insert into public.members(gym_id, name, phone_e164, source, created_by, identity_metadata)
    values(c.gym_id, coalesce(nullif(btrim(c.customer_name), ''), 'Unknown member'), phone,
      case when phone is null then 'legacy'
        when c.source = 'import' or exists(select 1 from public.conversations other
          where other.gym_id = c.gym_id and other.source = 'import'
            and public.member_comparison_phone(other.customer_phone, other.source) = phone
            and exists(select 1 from public.memberships m where m.conversation_id = other.id)) then 'import'
        when c.ai_lead_at is not null and not exists(select 1 from public.conversations other
          where other.gym_id = c.gym_id and other.ai_lead_at is null
            and public.member_comparison_phone(other.customer_phone, other.source) = phone
            and exists(select 1 from public.memberships m where m.conversation_id = other.id)) then 'lead_conversion'
        else 'legacy' end, auth.uid(),
      jsonb_build_object('legacy_conversation_id', c.id, 'raw_phone', c.customer_phone,
        'identity_review_required', not compatible)) returning * into person;
  elsif c.source = 'import' and person.source = 'legacy' then
    -- Mixed import/AI journeys must not manufacture AI acquisition credit.
    update public.members set source = 'import' where id = person.id;
  end if;
  update public.conversations set member_id = person.id where id = c.id;
  return person.id;
end; $$;

-- Null-conversation rows now validate member and package authority instead.
create or replace function public.enforce_membership_branch_consistency()
returns trigger language plpgsql security definer set search_path = public as $$
declare c public.conversations;
begin
  if new.conversation_id is not null then
    select * into c from public.conversations where id = new.conversation_id for update;
    if c.id is null or c.gym_id <> new.gym_id
      or ((tg_op = 'INSERT' or new.conversation_id is distinct from old.conversation_id)
          and c.branch_id is distinct from new.branch_id) then
      raise exception 'membership must match conversation branch'; end if;
    if new.member_id is null then new.member_id := public.ensure_legacy_member(c.id); end if;
    if c.member_id is not null and c.member_id <> new.member_id then
      raise exception 'membership identity must match conversation'; end if;
  end if;
  if new.member_id is null or not exists(select 1 from public.members p where p.id = new.member_id and p.gym_id = new.gym_id) then
    raise exception 'membership must match member gym'; end if;
  if not exists(select 1 from public.membership_packages p where p.id = new.membership_package_id
    and p.gym_id = new.gym_id and p.branch_id = new.branch_id) then
    raise exception 'membership package must match membership branch'; end if;
  if tg_op = 'INSERT' then new.created_by := coalesce(new.created_by, auth.uid()); end if;
  return new;
end; $$;

-- Preserve all periods and all historic synthetic conversations.
do $$ declare c uuid; begin
  for c in select conversation_id from public.memberships where conversation_id is not null
    group by conversation_id order by min(created_at), conversation_id loop
    perform public.ensure_legacy_member(c);
  end loop;
end; $$;
update public.memberships m set member_id = c.member_id,
  source = case when c.source = 'import' then 'import' when c.ai_lead_at is not null then 'lead_conversion' else 'legacy' end
from public.conversations c where c.id = m.conversation_id;
alter table public.memberships alter column member_id set not null;

create function public.register_member_membership(
  p_request_id uuid, p_branch_id uuid, p_name text, p_phone_e164 text,
  p_email text, p_package_id uuid, p_start_date date, p_expiry_date date,
  p_source text, p_existing_member_id uuid default null, p_conversation_id uuid default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare b public.branches; package public.membership_packages; c public.conversations;
  person public.members; period public.memberships; end_date date; fingerprint jsonb;
begin
  -- No service-role registration bypass: creation always belongs to an owner.
  select * into b from public.branches where id = p_branch_id;
  if auth.uid() is null or b.id is null or not exists(select 1 from public.gyms g where g.id = b.gym_id and g.owner_user_id = auth.uid()) then
    raise exception 'Branch not found or access denied.'; end if;
  if p_request_id is null or p_source is null or p_source not in ('manual', 'import', 'lead_conversion')
    or p_name is null or length(btrim(p_name)) not between 1 and 200 or p_phone_e164 is null
    or p_phone_e164 !~ '^\+[1-9][0-9]{7,14}$' then raise exception 'Valid name, normalized phone and request ID are required.'; end if;
  if p_email is not null and (length(p_email) > 254 or p_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$') then raise exception 'Invalid email.'; end if;
  if p_conversation_id is not null then
    select * into c from public.conversations where id = p_conversation_id for update;
    if c.id is null or c.gym_id <> b.gym_id or c.branch_id is distinct from b.id or c.source = 'import' then
      raise exception 'Conversation does not belong to this branch.'; end if;
    if public.member_comparison_phone(c.customer_phone, c.source) is distinct from p_phone_e164 then
      raise exception 'Member phone must match the authoritative conversation phone.'; end if;
  elsif p_source = 'lead_conversion' then raise exception 'Lead conversion requires a real conversation.';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('member-gym:' || b.gym_id, 0));
  fingerprint := jsonb_build_object('branch', b.id, 'name', btrim(p_name), 'phone', p_phone_e164,
    'email', nullif(btrim(p_email), ''), 'package', p_package_id, 'start', p_start_date,
    'end', p_expiry_date, 'source', p_source, 'member', p_existing_member_id, 'conversation', p_conversation_id);
  select * into period from public.memberships where gym_id = b.gym_id and request_id = p_request_id;
  if period.id is not null then
    if period.registration_input is distinct from fingerprint then raise exception 'This request ID was already used with different details.'; end if;
    select * into person from public.members where id = period.member_id;
    return jsonb_build_object('member', to_jsonb(person), 'membership', to_jsonb(period), 'replayed', true);
  end if;
  select * into package from public.membership_packages where id = p_package_id and gym_id = b.gym_id and branch_id = b.id and active for share;
  if package.id is null then raise exception 'Package is unavailable in this branch.'; end if;
  end_date := coalesce(p_expiry_date, (p_start_date + make_interval(months => package.duration_months))::date);
  if p_start_date is null or end_date <= p_start_date then raise exception 'Expiry date must be after start date.'; end if;
  -- Quarantined identities require review before allowing a potentially duplicate
  -- person. The normalization report resolves local phones with libphonenumber.
  if public.member_legacy_phone_conflict(b.gym_id, p_phone_e164) then
    raise exception 'A historical member may use this phone. Review that identity before registration. No data was changed.'; end if;
  select * into person from public.members where gym_id = b.gym_id and phone_e164 = p_phone_e164 for update;
  if person.id is not null then
    if p_source = 'manual' and p_existing_member_id is distinct from person.id then
      raise exception 'Existing member found. Confirm Add membership to this member.'; end if;
    if p_existing_member_id is not null and p_existing_member_id <> person.id then raise exception 'Existing member does not match this phone.'; end if;
    if p_source = 'import' and lower(regexp_replace(btrim(person.name), '\s+', ' ', 'g')) <> lower(regexp_replace(btrim(p_name), '\s+', ' ', 'g')) then
      raise exception 'Phone belongs to a member with a different name. Review this row.'; end if;
  else
    if p_existing_member_id is not null then raise exception 'Existing member does not match this phone.'; end if;
    insert into public.members(gym_id, name, phone_e164, email, source, created_by)
      values(b.gym_id, btrim(p_name), p_phone_e164, nullif(btrim(p_email), ''), p_source, auth.uid()) returning * into person;
  end if;
  if c.member_id is not null and c.member_id <> person.id then raise exception 'Conversation is already linked to another member.'; end if;
  -- Dates are inclusive in existing product status rules. Different branches may
  -- legitimately overlap; accidental overlaps within one branch are rejected.
  if exists(select 1 from public.memberships m where m.member_id = person.id and m.branch_id = b.id
    and m.start_date <= end_date and m.expiry_date >= p_start_date) then
    raise exception 'Membership period overlaps an existing period in this branch.'; end if;
  if c.id is not null then
    update public.conversations set member_id = person.id, lead_stage = 'member',
      ai_lead_at = case when ai_lead_at is not null then ai_lead_at
        when c.lead_stage in ('new_lead', 'qualified', 'trial_booked') and exists(
          select 1 from public.messages msg where msg.conversation_id = c.id and msg.sender_type = 'ai') then now() else null end
    where id = c.id;
  end if;
  insert into public.memberships(gym_id, branch_id, member_id, conversation_id, membership_package_id,
    start_date, expiry_date, source, created_by, request_id, registration_input)
  values(b.gym_id, b.id, person.id, c.id, package.id, p_start_date, end_date, p_source, auth.uid(), p_request_id, fingerprint)
  returning * into period;
  return jsonb_build_object('member', to_jsonb(person), 'membership', to_jsonb(period), 'replayed', false);
end; $$;

-- Old conversion callers retain their signature and response shape. A stable
-- deterministic ID makes identical old-app retries idempotent as well.
create or replace function public.convert_conversation_to_member(p_conversation_id uuid,
  p_membership_package_id uuid, p_customer_name text, p_customer_phone text, p_start_date date)
returns public.memberships language plpgsql security invoker set search_path = public as $$
declare c public.conversations; result jsonb; period public.memberships;
begin
  select * into c from public.conversations where id = p_conversation_id;
  result := public.register_member_membership(md5('conversion:' || p_conversation_id || ':' || p_membership_package_id || ':' || p_start_date)::uuid,
    c.branch_id, p_customer_name, public.member_comparison_phone(p_customer_phone, c.source), null,
    p_membership_package_id, p_start_date, null, 'lead_conversion', null, c.id);
  select * into period from jsonb_populate_record(null::public.memberships, result->'membership');
  return period;
end; $$;
create or replace function public.import_member_to_branch(p_branch_id uuid, p_customer_name text,
  p_customer_phone text, p_membership_package_id uuid, p_start_date date, p_expiry_date date default null)
returns public.memberships language plpgsql security invoker set search_path = public as $$
declare result jsonb; period public.memberships;
begin
  result := public.register_member_membership(md5('import:' || p_branch_id || ':' || p_customer_phone || ':' || p_membership_package_id || ':' || p_start_date || ':' || coalesce(p_expiry_date::text,''))::uuid,
    p_branch_id, p_customer_name, public.member_comparison_phone(p_customer_phone, 'import'), null,
    p_membership_package_id, p_start_date, p_expiry_date, 'import');
  select * into period from jsonb_populate_record(null::public.memberships, result->'membership');
  return period;
end; $$;

-- Safe gym-only matching. This also protects existing fast-ingestion workers:
-- linking happens under the authoritative conversation transaction, not by
-- replacing transport identifiers or changing ownership/stage/history.
create function public.link_whatsapp_member() returns trigger
language plpgsql security definer set search_path = public as $$
declare phone text; person uuid;
begin
  if new.source <> 'whatsapp' or new.member_id is not null then return new; end if;
  phone := public.member_comparison_phone(new.customer_phone, new.source);
  if phone is null then return new; end if;
  if public.member_legacy_phone_conflict(new.gym_id, phone) then return new; end if;
  select id into person from public.members where gym_id = new.gym_id and phone_e164 = phone;
  new.member_id := person;
  return new;
end; $$;
create trigger conversations_link_member before insert or update on public.conversations
  for each row execute function public.link_whatsapp_member();

alter table public.automation_executions alter column conversation_id drop not null;
alter table public.automation_executions drop constraint automation_executions_conversation_id_fkey;
alter table public.automation_executions add constraint automation_executions_conversation_id_fkey
  foreign key (conversation_id) references public.conversations(id) on delete set null;
alter table public.automation_executions add column delivery_bound_at timestamptz;
create or replace function public.enforce_automation_execution_branch_consistency()
returns trigger language plpgsql set search_path = public as $$
begin
  if not exists(select 1 from public.automation_configs a where a.id = new.automation_config_id and a.gym_id = new.gym_id and a.branch_id = new.branch_id) then
    raise exception 'automation execution must match config branch'; end if;
  if new.conversation_id is not null and not exists(select 1 from public.conversations c
    where c.id = new.conversation_id and c.gym_id = new.gym_id
      and (c.branch_id = new.branch_id or (tg_op = 'UPDATE'
        and new.conversation_id is not distinct from old.conversation_id
        and new.branch_id is not distinct from old.branch_id))) then
    raise exception 'automation execution must match conversation branch'; end if;
  if new.membership_id is not null and not exists(select 1 from public.memberships m where m.id = new.membership_id and m.gym_id = new.gym_id and m.branch_id = new.branch_id) then
    raise exception 'automation execution must match membership branch'; end if;
  if new.conversation_id is null and new.membership_id is null then raise exception 'Automation requires a membership or conversation.'; end if;
  return new;
end; $$;

update public.automation_executions set delivery_bound_at = created_at where conversation_id is not null;
-- Keep the old conversation unique constraint for old ON CONFLICT callers.
-- Historical duplicate membership events are retained; only their extra legacy
-- trigger keys gain an audit suffix so future event uniqueness can be enforced.
with ranked as (select id, row_number() over(partition by automation_config_id, membership_id, trigger_key order by created_at, id) n
  from public.automation_executions where membership_id is not null)
update public.automation_executions a set trigger_key = a.trigger_key || ':legacy:' || a.id
from ranked r where a.id = r.id and r.n > 1;
create unique index automation_membership_event_idx on public.automation_executions(automation_config_id, membership_id, trigger_key)
  where membership_id is not null;

-- Lifecycle registration survives absence of a channel. No generation occurs
-- until this row is claimed against a live, eligible conversation epoch.
create function public.claim_membership_automation(p_config_id uuid, p_membership_id uuid, p_trigger_key text,
  p_expected_conversation_id uuid default null)
returns setof public.automation_executions language plpgsql security definer set search_path = public as $$
declare config public.automation_configs; period public.memberships; c public.conversations;
  execution public.automation_executions; reason text; token uuid := gen_random_uuid();
begin
  select * into config from public.automation_configs where id = p_config_id;
  select * into period from public.memberships where id = p_membership_id;
  if config.id is null or period.id is null or not config.enabled or config.automation_type = 'lead_follow_up'
    or period.gym_id <> config.gym_id or period.branch_id <> config.branch_id then return; end if;
  -- Stable event lock before selecting a transport. No row is locked yet, so
  -- conversation -> execution ordering remains compatible with final send.
  perform pg_advisory_xact_lock(hashtextextended('member-event:' || p_config_id || ':' || p_membership_id || ':' || p_trigger_key, 0));
  select * into execution from public.automation_executions where automation_config_id = p_config_id and membership_id = p_membership_id and trigger_key = p_trigger_key;
  if execution.id is not null and (execution.status = 'sent' or (execution.lease_expires_at > now())) then return; end if;
  if execution.delivery_bound_at is not null and execution.conversation_id is null then return; end if;
  if execution.conversation_id is not null then
    if p_expected_conversation_id is not null and execution.conversation_id <> p_expected_conversation_id then return; end if;
    select * into c from public.conversations where id = execution.conversation_id for update;
    if c.id is null or c.control_version <> execution.control_version or c.status <> 'active'
      or c.gym_id <> config.gym_id or c.branch_id is distinct from config.branch_id
      or c.member_id is distinct from period.member_id
      or not exists(select 1 from public.members person where person.id = period.member_id
        and person.phone_e164 = public.member_comparison_phone(c.customer_phone, 'whatsapp')) then return; end if;
  else
    select candidate.* into c from public.conversations candidate
    join public.members person on person.id = candidate.member_id
    join public.whatsapp_endpoints endpoint on endpoint.id = candidate.whatsapp_endpoint_id
    where candidate.member_id = period.member_id and candidate.gym_id = config.gym_id
      and (p_expected_conversation_id is null or candidate.id = p_expected_conversation_id)
      and candidate.branch_id = config.branch_id and candidate.source = 'whatsapp' and candidate.status = 'active'
      and endpoint.gym_id = candidate.gym_id and endpoint.is_active
      and public.member_comparison_phone(candidate.customer_phone, 'whatsapp') = person.phone_e164
      and public.whatsapp_customer_window_open(candidate.id)
    order by candidate.last_message_at desc, candidate.id limit 1 for update of candidate;
  end if;
  if not config.auto_send then reason := 'Automatic sending is disabled.';
  elsif c.id is null then reason := 'Reminder is due; no eligible WhatsApp conversation/open service window. Approved-template delivery is not configured.';
  elsif not public.whatsapp_customer_window_open(c.id) then reason := 'Reminder is due; free-form window closed. Approved-template delivery is not configured.';
  end if;
  if execution.id is null then
    insert into public.automation_executions(gym_id, branch_id, automation_config_id, membership_id, conversation_id,
      trigger_key, status, error_message, control_version, claim_token, lease_expires_at, delivery_bound_at)
    values(config.gym_id, config.branch_id, config.id, period.id, case when reason is null then c.id else null end,
      p_trigger_key, case when reason is null then 'pending' else 'skipped' end, reason,
      coalesce(c.control_version, 0), case when reason is null then token else null end,
      case when reason is null then now() + interval '5 minutes' else null end,
      case when reason is null then now() else null end) returning * into execution;
  else
    update public.automation_executions set conversation_id = coalesce(conversation_id, case when reason is null then c.id else null end),
      control_version = case when conversation_id is null and reason is null then c.control_version else control_version end,
      delivery_bound_at = coalesce(delivery_bound_at, case when reason is null then now() else null end),
      status = case when reason is null then 'pending' else 'skipped' end, error_message = reason,
      claim_token = case when reason is null then token else null end,
      lease_expires_at = case when reason is null then now() + interval '5 minutes' else null end,
      completed_at = null where id = execution.id returning * into execution;
  end if;
  -- Suppressed rows persist for diagnosis/re-evaluation, but are not runnable.
  if reason is null then return next execution; end if;
end; $$;

-- Old workers retain their RPC signature and share membership-event authority.
create or replace function public.claim_automation_execution(
  p_gym_id uuid, p_branch_id uuid, p_automation_config_id uuid,
  p_conversation_id uuid, p_membership_id uuid, p_trigger_key text,
  p_lease_seconds integer default 300
) returns setof public.automation_executions
language plpgsql security definer set search_path = public as $$
declare c public.conversations; token uuid := gen_random_uuid();
begin
  if p_membership_id is not null then
    if p_conversation_id is null then return; end if;
    if not exists(select 1 from public.automation_configs cfg join public.memberships m on m.id = p_membership_id
      where cfg.id = p_automation_config_id and cfg.gym_id = p_gym_id and cfg.branch_id = p_branch_id
        and m.gym_id = p_gym_id and m.branch_id = p_branch_id) then return; end if;
    return query select * from public.claim_membership_automation(p_automation_config_id, p_membership_id, p_trigger_key, p_conversation_id);
    return;
  end if;
  select * into c from public.conversations where id = p_conversation_id for update;
  -- Existing explicitly enabled automations bypass ai_enabled, but never human/closed.
  if c.id is null or c.status <> 'active' or c.member_id is not null or c.gym_id is distinct from p_gym_id
    or c.branch_id is distinct from p_branch_id then return; end if;
  return query insert into public.automation_executions(
    gym_id, branch_id, automation_config_id, conversation_id, membership_id,
    trigger_key, status, claim_token, lease_expires_at, control_version
  ) values(p_gym_id, p_branch_id, p_automation_config_id, p_conversation_id, p_membership_id,
    p_trigger_key, 'pending', token,
    now() + make_interval(secs => greatest(30, least(p_lease_seconds, 1800))), c.control_version)
  on conflict (automation_config_id, conversation_id, trigger_key) do update
    set status = 'pending', claim_token = token, error_message = null, completed_at = null,
      lease_expires_at = now() + make_interval(secs => greatest(30, least(p_lease_seconds, 1800)))
  where automation_executions.control_version = c.control_version
    and automation_executions.status in ('pending', 'failed')
    and (automation_executions.lease_expires_at is null or automation_executions.lease_expires_at <= now())
  returning *;
end; $$;


-- Membership reminders persist exactly one free-form message per event. Bind
-- message + execution in the same insert transaction as the durable queue.
create unique index messages_membership_automation_event_idx on public.messages((metadata->>'automation_execution_id'))
  where metadata ? 'automation_execution_id';
create function public.bind_membership_automation_message() returns trigger
language plpgsql security definer set search_path = public as $$
declare a public.automation_executions;
begin
  if not (new.metadata ? 'automation_execution_id') then
    -- Pre-deploy workers cannot identify a membership claim in their payload.
    -- Reject new generation rather than let a lease retry create a second send.
    -- Previously persisted outbox messages remain eligible for guarded recovery.
    if new.sender_type = 'ai' and coalesce(new.metadata->>'automation', 'false') = 'true'
      and exists(select 1 from public.conversations c where c.id = new.conversation_id and c.member_id is not null) then
      raise exception 'Membership reminder requires event authority. Retry with the updated application.';
    end if;
    return new;
  end if;
  select * into a from public.automation_executions where id = (new.metadata->>'automation_execution_id')::uuid for update;
  if a.id is null or a.membership_id is null or a.conversation_id <> new.conversation_id
    or new.sender_type <> 'ai' or new.message_type <> 'text'
    or a.claim_token is distinct from (new.metadata->>'automation_claim_token')::uuid
    or a.claim_token is null or a.lease_expires_at is null or a.lease_expires_at <= now()
    or a.control_version is distinct from (new.metadata->>'control_version')::integer
    or a.sent_message_id is not null
    or not exists(select 1 from public.conversations c join public.memberships period on period.id = a.membership_id
      join public.members person on person.id = period.member_id
      where c.id = new.conversation_id and c.gym_id = a.gym_id and c.branch_id = a.branch_id
        and c.member_id = period.member_id
        and person.phone_e164 = public.member_comparison_phone(c.customer_phone, 'whatsapp'))
    then raise exception 'Reminder claim expired or already has a message.'; end if;
  update public.automation_executions set sent_message_id = new.id where id = a.id;
  return new;
end; $$;
create trigger aaa_bind_membership_automation_message after insert on public.messages
  for each row execute function public.bind_membership_automation_message();

-- Final free-form boundary, including old/recovery workers. No payload conversion.
create or replace function public.begin_whatsapp_outbound_send(p_delivery_id uuid, p_claim_token uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare d public.whatsapp_outbound_deliveries; c public.conversations; m public.messages; reason text; automation boolean;
begin
  select * into d from public.whatsapp_outbound_deliveries where id = p_delivery_id;
  if d.id is null then return false; end if;
  -- Lock ordering is conversation -> delivery, matching takeover/return.
  select * into c from public.conversations where id = d.conversation_id for update;
  select * into d from public.whatsapp_outbound_deliveries where id = p_delivery_id for update;
  if c.id is null or d.id is null or d.status <> 'processing' or p_claim_token is null or d.claim_token is distinct from p_claim_token
    or d.lease_expires_at is null or d.lease_expires_at <= now() then return false; end if;
  select * into m from public.messages where id = d.message_id;
  -- Existing retry rows can predate migration 34 and lack automation metadata.
  -- Only the durable execution's exact message ID supplies that legacy authority.
  automation := coalesce(m.metadata->>'automation', 'false') = 'true' or
    (not (m.metadata ? 'control_version') and c.control_version = 0 and exists(
      select 1 from public.automation_executions a where a.sent_message_id = m.id
        and a.conversation_id = c.id and a.control_version = 0));
  if m.id is null or m.sender_type not in ('ai', 'human') or m.conversation_id <> c.id then
    reason := 'Outbound message is unavailable.';
  elsif c.control_version <> coalesce((m.metadata->>'control_version')::integer, 0)
    or (m.sender_type = 'ai' and (c.status <> 'active'
        or (not c.ai_enabled and not automation)))
    or (m.sender_type = 'human' and c.status <> 'human') then
    reason := 'Cancelled before sending: conversation control changed.';
  elsif (m.sender_type = 'human' or automation) and not public.whatsapp_customer_window_open(c.id) then
    reason := 'WhatsApp free-form window closed; approved-template delivery is not configured.';
  elsif m.metadata ? 'automation_execution_id' and not exists(
    select 1 from public.automation_executions a
    join public.memberships period on period.id = a.membership_id
    join public.members person on person.id = period.member_id
    where a.id::text = m.metadata->>'automation_execution_id' and a.sent_message_id = m.id
      and a.conversation_id = c.id and a.gym_id = c.gym_id and a.branch_id = c.branch_id
      and period.member_id = c.member_id
      and person.phone_e164 = public.member_comparison_phone(c.customer_phone, 'whatsapp')
  ) then reason := 'Cancelled before sending: membership reminder conversation changed.';
  elsif m.sender_type = 'human' and (c.source <> 'whatsapp' or c.whatsapp_endpoint_id is null
    or c.whatsapp_endpoint_id is distinct from d.whatsapp_endpoint_id) then
    reason := 'The original WhatsApp number is unavailable.';
  elsif d.whatsapp_endpoint_id is not null and not exists(
    select 1 from public.whatsapp_endpoints e where e.id = d.whatsapp_endpoint_id
      and e.gym_id = c.gym_id and e.is_active and e.phone_number_id = d.phone_number_id
  ) then reason := 'The original WhatsApp number is unavailable.';
  end if;
  if reason is not null then
    update public.whatsapp_outbound_deliveries set status = 'failed', retryable = false,
      claim_token = null, lease_expires_at = null, last_error = reason, updated_at = now() where id = d.id;
    return false;
  end if;
  -- Do not overtake an earlier item or another external send in this conversation.
  if exists(select 1 from public.whatsapp_outbound_deliveries prior where prior.conversation_id = c.id
    and prior.id <> d.id and (prior.status = 'sending' or
      (prior.retryable and prior.status in ('pending', 'processing', 'failed')
       and (prior.created_at, prior.id) < (d.created_at, d.id)))) then
    update public.whatsapp_outbound_deliveries set status = 'pending', claim_token = null,
      lease_expires_at = null, next_attempt_at = now() + interval '5 seconds' where id = d.id;
    return false;
  end if;
  update public.whatsapp_outbound_deliveries set status = 'sending',
    lease_expires_at = now() + interval '5 minutes', updated_at = now() where id = d.id;
  return true;
end; $$;

-- Function ACLs: authenticated owners only register; scheduling only service role.
revoke all on function public.ensure_legacy_member(uuid), public.link_whatsapp_member(),
  public.member_comparison_phone(text,text), public.member_legacy_phone_conflict(uuid,text),
  public.bind_membership_automation_message() from public, anon, authenticated;
revoke all on function public.register_member_membership(uuid,uuid,text,text,text,uuid,date,date,text,uuid,uuid) from public, anon;
grant execute on function public.register_member_membership(uuid,uuid,text,text,text,uuid,date,date,text,uuid,uuid) to authenticated;
grant execute on function public.member_comparison_phone(text,text) to authenticated, service_role;
revoke all on function public.claim_membership_automation(uuid,uuid,text,uuid) from public, anon, authenticated;
grant execute on function public.claim_membership_automation(uuid,uuid,text,uuid) to service_role;
commit;
