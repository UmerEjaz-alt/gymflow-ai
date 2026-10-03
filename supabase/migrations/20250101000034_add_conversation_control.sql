-- Per-conversation control; existing transport/outbox and delivery states are retained.
-- Deploy this migration before the application. Legacy AI work is epoch zero.
alter table public.conversations add column control_version integer not null default 0
  check (control_version >= 0);
alter table public.messages add column client_request_id uuid;
alter table public.automation_executions add column control_version integer not null default 0
  check (control_version >= 0);
create unique index messages_owner_request_unique
  on public.messages(conversation_id, client_request_id)
  where client_request_id is not null;
create index messages_latest_customer_idx on public.messages(conversation_id, created_at desc)
  where sender_type = 'customer';

create function public.advance_conversation_control() returns trigger
language plpgsql set search_path = public as $$
begin
  new.control_version := old.control_version;
  if new.status is distinct from old.status or new.ai_enabled is distinct from old.ai_enabled then
    new.control_version := old.control_version + 1;
  end if;
  return new;
end; $$;
create trigger conversations_advance_control before update on public.conversations
  for each row execute function public.advance_conversation_control();

create function public.cancel_obsolete_conversation_deliveries() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.control_version <> old.control_version then
    update public.whatsapp_outbound_deliveries d
    set status = 'failed', retryable = false, claim_token = null, lease_expires_at = null,
        last_error = 'Cancelled before sending: conversation control changed.', updated_at = now()
    from public.messages m
    where d.message_id = m.id and d.conversation_id = new.id
      and m.sender_type = 'ai' and d.status in ('pending', 'processing', 'failed')
      and coalesce((m.metadata->>'control_version')::integer, 0) < new.control_version;
  end if;
  -- Never cancel sending/uncertain rows: Meta may already have accepted them.
  return new;
end; $$;
create trigger conversations_cancel_obsolete after update on public.conversations
  for each row execute function public.cancel_obsolete_conversation_deliveries();

-- Serializes the actual message insert with ownership changes, including media/fallback replies.
create function public.guard_ai_message_control() returns trigger
language plpgsql security definer set search_path = public as $$
declare c public.conversations;
begin
  if new.sender_type <> 'ai' then return new; end if;
  select * into c from public.conversations where id = new.conversation_id for update;
  if not (new.metadata ? 'control_version') and c.control_version = 0 and exists(
    select 1 from public.automation_executions a where a.conversation_id = c.id
      and a.control_version = 0 and a.status = 'pending'
      and a.claim_token is not null and a.lease_expires_at > now()
  ) then new.metadata := new.metadata || '{"automation":true}'::jsonb; end if;
  if c.status <> 'active' or c.control_version <> coalesce((new.metadata->>'control_version')::integer, 0)
     or (not c.ai_enabled and coalesce(new.metadata->>'automation', 'false') <> 'true') then
    raise exception 'Conversation control changed; AI work was stopped.' using errcode = 'P0001';
  end if;
  return new;
end; $$;
create trigger messages_guard_ai_control before insert on public.messages
  for each row execute function public.guard_ai_message_control();

-- Use provider event time when available; arrival time cannot extend a delayed webhook's window.
create function public.whatsapp_customer_window_open(p_conversation_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(max(case
    when m.metadata->>'timestamp' ~ '^[0-9]{1,12}$'
      then least(to_timestamp((m.metadata->>'timestamp')::double precision), m.created_at)
    else m.created_at end) > now() - interval '24 hours', false)
  from public.messages m where m.conversation_id = p_conversation_id
    and m.sender_type = 'customer' and m.whatsapp_message_id is not null;
$$;

create function public.set_owner_conversation_control(
  p_conversation_id uuid, p_gym_id uuid, p_branch_id uuid, p_take_over boolean
) returns jsonb language plpgsql security definer set search_path = public as $$
declare c public.conversations; warning text;
begin
  select * into c from public.conversations where id = p_conversation_id for update;
  if c.id is null or c.gym_id is distinct from p_gym_id or c.branch_id is distinct from p_branch_id
    or not exists(select 1 from public.gyms g where g.id = c.gym_id and g.owner_user_id = auth.uid()) then
    raise exception 'Conversation is outside the active gym or branch.';
  end if;
  if p_take_over is null or c.source <> 'whatsapp' or c.status = 'closed' then
    raise exception 'This conversation cannot change control.';
  end if;
  if p_take_over and c.status = 'human' then return jsonb_build_object('conversation', to_jsonb(c)); end if;
  if not p_take_over and c.status <> 'human' then
    raise exception 'This conversation is no longer in your control. Refresh and try again.';
  end if;
  if not p_take_over and exists(
    select 1 from public.whatsapp_outbound_deliveries d join public.messages m on m.id = d.message_id
    where d.conversation_id = c.id and m.sender_type = 'human'
      and (d.status in ('processing', 'sending') or (d.retryable and d.status in ('pending', 'failed')))
  ) then raise exception 'Your message is still being sent. Wait before returning to AI.'; end if;
  if exists(select 1 from public.whatsapp_outbound_deliveries d where d.conversation_id = c.id
      and d.status in ('sending', 'uncertain')) then
    warning := 'An earlier message may still arrive. Its delivery could not yet be confirmed.';
  end if;
  update public.conversations set status = case when p_take_over then 'human' else 'active' end
    where id = c.id returning * into c;
  return jsonb_build_object('conversation', to_jsonb(c), 'notice', warning);
end; $$;

create function public.persist_owner_whatsapp_message(
  p_conversation_id uuid, p_gym_id uuid, p_branch_id uuid,
  p_expected_control_version integer, p_text text, p_client_request_id uuid
) returns jsonb language plpgsql security definer set search_path = public as $$
declare c public.conversations; m public.messages; e public.whatsapp_endpoints;
begin
  select * into c from public.conversations where id = p_conversation_id for update;
  if c.id is null or c.gym_id is distinct from p_gym_id or c.branch_id is distinct from p_branch_id
    or not exists(select 1 from public.gyms g where g.id = c.gym_id and g.owner_user_id = auth.uid()) then
    raise exception 'Conversation is outside the active gym or branch.';
  end if;
  if c.source <> 'whatsapp' then raise exception 'Owner replies are available only for WhatsApp.'; end if;
  if p_client_request_id is null or p_text is null or p_text !~ '[^[:space:]]'
    or char_length(btrim(p_text)) not between 1 and 4096 then raise exception 'Enter a valid message of up to 4096 characters.'; end if;
  select * into m from public.messages where conversation_id = c.id and client_request_id = p_client_request_id;
  if m.id is not null then
    if m.sender_type <> 'human' or m.content <> btrim(p_text)
      or m.metadata->>'actor_user_id' is distinct from auth.uid()::text then
      raise exception 'This message request was already used for different content.';
    end if;
    return to_jsonb(m); -- A retry returns its original message, never inserts another.
  end if;
  if c.status <> 'human' or c.control_version is distinct from p_expected_control_version then
    raise exception 'Conversation control changed. Take over this conversation to reply.';
  end if;
  if not public.whatsapp_customer_window_open(c.id) then
    raise exception 'WhatsApp replies are available for 24 hours after the latest customer message. Wait for a new customer message to reply.';
  end if;
  -- Human replies require the original endpoint. Never guess another sender from a branch.
  select * into e from public.whatsapp_endpoints where id = c.whatsapp_endpoint_id
    and gym_id = c.gym_id and is_active and phone_number_id is not null;
  if e.id is null then raise exception 'The original WhatsApp number is unavailable. Check your WhatsApp connection.'; end if;
  insert into public.messages(conversation_id, sender_type, message_type, content, client_request_id, metadata)
  values(c.id, 'human', 'text', btrim(p_text), p_client_request_id,
    jsonb_build_object('actor_user_id', auth.uid(), 'control_version', c.control_version,
                      'outbound_delivery', 'whatsapp_outbox')) returning * into m;
  update public.conversations set last_message_at = now() where id = c.id;
  return to_jsonb(m);
end; $$;

create or replace function public.queue_whatsapp_outbound_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_conversation public.conversations;
  v_endpoint public.whatsapp_endpoints;
begin
  -- Only the remediated application opts messages into the outbox. This keeps
  -- migration-first rolling deployment safe: older application instances keep
  -- their direct-send behavior without also queuing a duplicate.
  if new.sender_type not in ('ai', 'human')
     or new.metadata->>'outbound_delivery' is distinct from 'whatsapp_outbox' then
    return new;
  end if;

  select * into v_conversation
  from public.conversations
  where id = new.conversation_id;

  if not found then
    return new;
  end if;

  if new.sender_type = 'human' and (v_conversation.source <> 'whatsapp'
      or v_conversation.status <> 'human'
      or v_conversation.control_version <> coalesce((new.metadata->>'control_version')::integer, -1)
      or new.client_request_id is null
      or not exists(select 1 from public.gyms g where g.id = v_conversation.gym_id
        and g.owner_user_id::text = new.metadata->>'actor_user_id')
      or not public.whatsapp_customer_window_open(v_conversation.id)) then
    raise exception 'Human reply is not authorized for the current conversation.';
  end if;

  if v_conversation.whatsapp_endpoint_id is not null then
    select * into v_endpoint
    from public.whatsapp_endpoints
    where id = v_conversation.whatsapp_endpoint_id
      and gym_id = v_conversation.gym_id
      and is_active = true;
  elsif new.sender_type = 'ai' and v_conversation.branch_id is not null then
    select * into v_endpoint
    from public.whatsapp_endpoints
    where gym_id = v_conversation.gym_id
      and branch_id = v_conversation.branch_id
      and is_active = true
    order by created_at
    limit 1;
  end if;

  insert into public.whatsapp_outbound_deliveries (
    message_id, gym_id, conversation_id, whatsapp_endpoint_id,
    phone_number_id, recipient_phone, status, retryable, last_error
  ) values (
    new.id, v_conversation.gym_id, v_conversation.id,
    coalesce(v_conversation.whatsapp_endpoint_id, v_endpoint.id),
    v_endpoint.phone_number_id, v_conversation.customer_phone,
    case when v_endpoint.id is null or v_endpoint.phone_number_id is null
      then 'failed' else 'pending' end,
    v_endpoint.id is not null and v_endpoint.phone_number_id is not null,
    case when v_endpoint.id is null then 'No active WhatsApp endpoint is attached to this conversation.'
      when v_endpoint.phone_number_id is null then 'The WhatsApp endpoint has no Meta phone number ID.'
      else null end
  )
  on conflict (message_id) do nothing;

  return new;
end;
$$;


-- All final send attempts (immediate/recovery/automation) share this fence.
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
  elsif m.sender_type = 'human' and not public.whatsapp_customer_window_open(c.id) then
    reason := 'WhatsApp reply window expired before sending.';
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

-- The non-atomic/media path also fences the memory/stage update under the conversation lock.
create function public.update_ai_conversation_controlled(p_conversation_id uuid,
  p_expected_control_version integer, p_automation boolean, p_patch jsonb)
returns jsonb language plpgsql security invoker set search_path = public as $$
declare c public.conversations;
  previous_epoch text := coalesce(current_setting('kroway.ai_control_version', true), '');
  previous_automation text := coalesce(current_setting('kroway.ai_control_automation', true), '');
begin
  select * into c from public.conversations where id = p_conversation_id for update;
  if c.id is null or c.status <> 'active' or c.control_version is distinct from p_expected_control_version
     or (not c.ai_enabled and not coalesce(p_automation, false)) then raise exception 'Conversation control changed; AI work was stopped.'; end if;
  if p_patch ? 'branch_id' and not exists(select 1 from public.branches b
     where b.id = (p_patch->>'branch_id')::uuid and b.gym_id = c.gym_id) then raise exception 'Invalid reply branch.'; end if;
  perform set_config('kroway.ai_control_version', c.control_version::text, true);
  perform set_config('kroway.ai_control_automation', coalesce(p_automation, false)::text, true);
  update public.conversations set
    latest_understanding = p_patch->'latest_understanding',
    customer_memory = case when p_patch ? 'customer_memory' then p_patch->'customer_memory' else customer_memory end,
    lead_stage = coalesce(p_patch->>'lead_stage', lead_stage),
    ai_lead_at = coalesce(ai_lead_at, (p_patch->>'ai_lead_at')::timestamptz),
    branch_id = case when p_patch ? 'branch_id' then (p_patch->>'branch_id')::uuid else branch_id end,
    last_message_at = (p_patch->>'last_message_at')::timestamptz
  where id = c.id returning * into c;
  perform set_config('kroway.ai_control_version', previous_epoch, true);
  perform set_config('kroway.ai_control_automation', previous_automation, true);
  return to_jsonb(c);
end; $$;

-- Preserve the epoch of an automation's FIRST claim, including failed-generation retries.
-- A retry never acquires fresh authority just because control was returned to AI.
create or replace function public.claim_automation_execution(
  p_gym_id uuid, p_branch_id uuid, p_automation_config_id uuid,
  p_conversation_id uuid, p_membership_id uuid, p_trigger_key text,
  p_lease_seconds integer default 300
) returns setof public.automation_executions
language plpgsql security definer set search_path = public as $$
declare c public.conversations; token uuid := gen_random_uuid();
begin
  select * into c from public.conversations where id = p_conversation_id for update;
  -- Existing explicitly enabled automations bypass ai_enabled, but never human/closed.
  if c.id is null or c.status <> 'active' or c.gym_id is distinct from p_gym_id
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

-- Only the AI executor calls this; manual booking APIs retain their current path.
create function public.execute_controlled_booking_mutation(p_conversation_id uuid,
  p_expected_control_version integer, p_action text, p_booking_id uuid, p_payload jsonb)
returns jsonb language plpgsql security invoker set search_path = public as $$
declare c public.conversations; b public.bookings;
  previous_epoch text := coalesce(current_setting('kroway.ai_control_version', true), '');
begin
  -- Legacy raw updates already lock the booking row before their guard takes
  -- the conversation lock. Match that order during a rolling deployment.
  if p_action <> 'create' then
    select * into b from public.bookings where id = p_booking_id
      and conversation_id = p_conversation_id and status = 'upcoming' for update;
  end if;
  select * into c from public.conversations where id = p_conversation_id for update;
  if c.id is null or c.status <> 'active' or not c.ai_enabled or c.control_version is distinct from p_expected_control_version then
    raise exception 'Conversation control changed; AI booking was stopped.';
  end if;
  perform set_config('kroway.ai_control_version', c.control_version::text, true);
  if p_action = 'create' then
    if (p_payload->>'gym_id')::uuid is distinct from c.gym_id or (p_payload->>'conversation_id')::uuid is distinct from c.id then
      raise exception 'Invalid booking conversation.';
    end if;
    if nullif(btrim(p_payload->>'customer_name'), '') is null then raise exception 'Customer name is required.'; end if;
    insert into public.bookings(gym_id, branch_id, conversation_id, trainer_id, customer_name,
      customer_phone, booking_type, scheduled_at, duration_minutes, source, notes)
    values(c.gym_id, (p_payload->>'branch_id')::uuid, c.id, (p_payload->>'trainer_id')::uuid,
      btrim(p_payload->>'customer_name'), nullif(btrim(p_payload->>'customer_phone'), ''), p_payload->>'booking_type',
      (p_payload->>'scheduled_at')::timestamptz, (p_payload->>'duration_minutes')::integer,
      coalesce(p_payload->>'source', 'whatsapp'), nullif(btrim(p_payload->>'notes'), '')) returning * into b;
  else
    if b.id is null or b.gym_id is distinct from c.gym_id then raise exception 'Upcoming booking not found for this conversation.'; end if;
    if p_action = 'reschedule' then
      update public.bookings set scheduled_at = (p_payload->>'scheduled_at')::timestamptz,
        duration_minutes = coalesce((p_payload->>'duration_minutes')::integer, duration_minutes)
        where id = b.id returning * into b;
    elsif p_action = 'cancel' then
      update public.bookings set status = 'cancelled', cancelled_at = now() where id = b.id returning * into b;
    else raise exception 'Unsupported booking action.'; end if;
  end if;
  perform set_config('kroway.ai_control_version', previous_epoch, true);
  return to_jsonb(b);
end; $$;

revoke all on function public.advance_conversation_control(), public.cancel_obsolete_conversation_deliveries(),
  public.guard_ai_message_control(), public.whatsapp_customer_window_open(uuid) from public, anon, authenticated;
revoke all on function public.set_owner_conversation_control(uuid, uuid, uuid, boolean),
  public.persist_owner_whatsapp_message(uuid, uuid, uuid, integer, text, uuid),
  public.update_ai_conversation_controlled(uuid, integer, boolean, jsonb),
  public.execute_controlled_booking_mutation(uuid, integer, text, uuid, jsonb) from public, anon;
grant execute on function public.set_owner_conversation_control(uuid, uuid, uuid, boolean),
  public.persist_owner_whatsapp_message(uuid, uuid, uuid, integer, text, uuid) to authenticated;
grant execute on function public.update_ai_conversation_controlled(uuid, integer, boolean, jsonb),
  public.execute_controlled_booking_mutation(uuid, integer, text, uuid, jsonb) to authenticated, service_role;
grant execute on function public.whatsapp_customer_window_open(uuid) to service_role;


-- Old deployed WhatsApp workers have no epoch marker. They retain epoch-zero
-- authority only; after any ownership change their raw business writes fail closed.
-- Authenticated manual calendar edits are not AI work and keep their existing path.
create function public.guard_whatsapp_booking_control() returns trigger
language plpgsql security definer set search_path = public as $$
declare c public.conversations; epoch text := nullif(current_setting('kroway.ai_control_version', true), '');
begin
  if new.conversation_id is null or (epoch is null and auth.uid() is not null) then return new; end if;
  if tg_op = 'UPDATE' and new.scheduled_at is not distinct from old.scheduled_at
    and new.duration_minutes is not distinct from old.duration_minutes
    and (new.status is not distinct from old.status or new.status <> 'cancelled') then return new; end if;
  select * into c from public.conversations where id = new.conversation_id for update;
  if c.source = 'whatsapp' and (c.status <> 'active' or not c.ai_enabled
      or c.control_version <> coalesce(epoch::integer, 0)) then
    raise exception 'Conversation control changed; AI booking was stopped.';
  end if;
  return new;
end; $$;
create trigger bookings_guard_whatsapp_control before insert or update on public.bookings
  for each row execute function public.guard_whatsapp_booking_control();

-- Fence legacy non-atomic AI memory/stage writes too. Inbound activity/branch
-- updates and authenticated owner changes are deliberately outside this guard.
create function public.guard_whatsapp_ai_update_control() returns trigger
language plpgsql security definer set search_path = public as $$
declare epoch text := nullif(current_setting('kroway.ai_control_version', true), '');
begin
  if old.source <> 'whatsapp' or (epoch is null and auth.uid() is not null) then return new; end if;
  if new.latest_understanding is not distinct from old.latest_understanding
    and new.customer_memory is not distinct from old.customer_memory
    and new.lead_stage is not distinct from old.lead_stage
    and new.ai_lead_at is not distinct from old.ai_lead_at then return new; end if;
  if old.status <> 'active' or old.control_version <> coalesce(epoch::integer, 0)
    or (not old.ai_enabled and coalesce(current_setting('kroway.ai_control_automation', true), '') <> 'true'
      and not (epoch is null and old.control_version = 0 and exists(
        select 1 from public.automation_executions a where a.conversation_id = old.id
          and a.control_version = 0 and a.status = 'pending'
          and a.claim_token is not null and a.lease_expires_at > now()))) then
    raise exception 'Conversation control changed; AI work was stopped.';
  end if;
  return new;
end; $$;
create trigger conversations_guard_ai_update before update on public.conversations
  for each row execute function public.guard_whatsapp_ai_update_control();

-- Additive wrapper: the original twelve-argument RPC and its CAS/return shape
-- remain unchanged for deployed workers. New workers provide captured authority.
create function public.persist_controlled_whatsapp_ai_text_reply(
  p_conversation_id uuid, p_expected_updated_at timestamptz,
  p_latest_understanding jsonb, p_update_customer_memory boolean, p_customer_memory jsonb,
  p_lead_stage text, p_ai_lead_at timestamptz, p_update_branch boolean, p_branch_id uuid,
  p_last_message_at timestamptz, p_content text, p_metadata jsonb
) returns table(outcome text, conversation_row jsonb, message_row jsonb,
  conversation_update_ms numeric, message_insert_ms numeric)
language plpgsql security definer set search_path = public as $$
declare c public.conversations;
  previous_epoch text := coalesce(current_setting('kroway.ai_control_version', true), '');
  previous_automation text := coalesce(current_setting('kroway.ai_control_automation', true), '');
begin
  select * into c from public.conversations where id = p_conversation_id for update;
  if c.id is null or c.status <> 'active'
    or c.control_version is distinct from (p_metadata->>'control_version')::integer
    or (not c.ai_enabled and coalesce(p_metadata->>'automation', 'false') <> 'true') then
    raise exception 'Conversation control changed; AI work was stopped.';
  end if;
  perform set_config('kroway.ai_control_version', c.control_version::text, true);
  perform set_config('kroway.ai_control_automation', coalesce(p_metadata->>'automation', 'false'), true);
  return query select * from public.persist_whatsapp_ai_text_reply(
    p_conversation_id, p_expected_updated_at, p_latest_understanding, p_update_customer_memory,
    p_customer_memory, p_lead_stage, p_ai_lead_at, p_update_branch, p_branch_id,
    p_last_message_at, p_content, p_metadata);
  perform set_config('kroway.ai_control_version', previous_epoch, true);
  perform set_config('kroway.ai_control_automation', previous_automation, true);
end; $$;
revoke all on function public.guard_whatsapp_booking_control(), public.guard_whatsapp_ai_update_control(),
  public.persist_controlled_whatsapp_ai_text_reply(uuid, timestamptz, jsonb, boolean, jsonb,
    text, timestamptz, boolean, uuid, timestamptz, text, jsonb) from public, anon, authenticated;
grant execute on function public.persist_controlled_whatsapp_ai_text_reply(uuid, timestamptz, jsonb,
  boolean, jsonb, text, timestamptz, boolean, uuid, timestamptz, text, jsonb) to service_role;
