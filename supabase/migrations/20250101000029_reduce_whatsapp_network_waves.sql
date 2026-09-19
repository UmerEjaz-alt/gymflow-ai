-- Reduce remote network waves on the established WhatsApp text path while
-- retaining the existing individual RPCs as rolling-deploy-safe fallbacks.

-- The phone_number_id is the authoritative Meta identifier and has a unique
-- index. Return immediately when it is present so the legacy normalized-phone
-- scans are not planned/executed for normal Cloud API traffic. An inactive
-- endpoint remains authoritative and deliberately blocks legacy fallback.
create or replace function public.resolve_whatsapp_endpoint(
  p_phone_number_id text,
  p_display_phone_number text
)
returns table(gym_id uuid, endpoint_id uuid, branch_id uuid)
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_endpoint public.whatsapp_endpoints%rowtype;
  v_branch public.branches%rowtype;
  v_gym_id uuid;
begin
  if p_phone_number_id is not null then
    select e.* into v_endpoint
    from public.whatsapp_endpoints e
    where e.phone_number_id = p_phone_number_id
    limit 1;

    if found then
      if v_endpoint.is_active then
        return query select v_endpoint.gym_id, v_endpoint.id, v_endpoint.branch_id;
      end if;
      return;
    end if;
  end if;

  if p_display_phone_number is not null then
    select e.* into v_endpoint
    from public.whatsapp_endpoints e
    where regexp_replace(e.phone_number, '\D', '', 'g') =
          regexp_replace(p_display_phone_number, '\D', '', 'g')
    order by (e.phone_number_id = p_phone_number_id) desc
    limit 1;

    if found then
      if v_endpoint.is_active then
        return query select v_endpoint.gym_id, v_endpoint.id, v_endpoint.branch_id;
      end if;
      return;
    end if;
  end if;

  select b.* into v_branch
  from public.branches b
  where (p_phone_number_id is not null and
         b.whatsapp_phone_number_id = p_phone_number_id)
     or (p_display_phone_number is not null and
         regexp_replace(b.whatsapp_number, '\D', '', 'g') =
         regexp_replace(p_display_phone_number, '\D', '', 'g'))
  limit 1;

  if found then
    return query select v_branch.gym_id, null::uuid, v_branch.id;
    return;
  end if;

  if p_display_phone_number is not null then
    select g.id into v_gym_id
    from public.gyms g
    where regexp_replace(g.whatsapp_number, '\D', '', 'g') =
          regexp_replace(p_display_phone_number, '\D', '', 'g')
    limit 1;

    if found then
      return query select v_gym_id, null::uuid, null::uuid;
    end if;
  end if;
end;
$$;

revoke all on function public.resolve_whatsapp_endpoint(text, text)
  from public, anon, authenticated;
grant execute on function public.resolve_whatsapp_endpoint(text, text)
  to service_role;

-- One pre-turn call: resolve the authoritative destination and perform the
-- first duplicate lookup. Rate-limit keys intentionally remain derived in the
-- application with RATE_LIMIT_SECRET after the gym is known.
create or replace function public.prepare_whatsapp_inbound(
  p_phone_number_id text,
  p_display_phone_number text,
  p_whatsapp_message_id text
)
returns table(
  gym_id uuid,
  endpoint_id uuid,
  branch_id uuid,
  existing_message jsonb,
  endpoint_resolution_ms numeric,
  idempotency_ms numeric
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_started_at timestamptz;
  v_destination record;
  v_existing jsonb;
  v_endpoint_ms numeric;
  v_idempotency_ms numeric;
begin
  if p_whatsapp_message_id is null or btrim(p_whatsapp_message_id) = '' then
    raise exception 'WhatsApp message ID is required.';
  end if;

  v_started_at := clock_timestamp();
  select r.* into v_destination
  from public.resolve_whatsapp_endpoint(
    p_phone_number_id,
    p_display_phone_number
  ) r
  limit 1;
  v_endpoint_ms := extract(epoch from (clock_timestamp() - v_started_at)) * 1000;

  if v_destination.gym_id is null then
    return query select null::uuid, null::uuid, null::uuid, null::jsonb,
      v_endpoint_ms, 0::numeric;
    return;
  end if;

  v_started_at := clock_timestamp();
  select to_jsonb(m) into v_existing
  from public.messages m
  where m.whatsapp_message_id = p_whatsapp_message_id
  limit 1;
  v_idempotency_ms := extract(epoch from (clock_timestamp() - v_started_at)) * 1000;

  if v_existing is not null then
    return query select v_destination.gym_id, v_destination.endpoint_id,
      v_destination.branch_id, v_existing, v_endpoint_ms, v_idempotency_ms;
    return;
  end if;

  return query select v_destination.gym_id, v_destination.endpoint_id,
    v_destination.branch_id, null::jsonb, v_endpoint_ms, v_idempotency_ms;
end;
$$;

revoke all on function public.prepare_whatsapp_inbound(
  text, text, text
) from public, anon, authenticated;
grant execute on function public.prepare_whatsapp_inbound(
  text, text, text
) to service_role;

-- Established endpoint fast path. This is the second authoritative duplicate
-- boundary: the unique message constraint and insert occur in this transaction.
-- New/legacy/unresolved conversations return not_established and continue
-- through the existing application fallback.
create or replace function public.ingest_established_whatsapp_message(
  p_gym_id uuid,
  p_endpoint_id uuid,
  p_customer_bucket text,
  p_customer_limit integer,
  p_gym_bucket text,
  p_gym_limit integer,
  p_window_seconds integer,
  p_customer_phone text,
  p_message_type text,
  p_content text,
  p_whatsapp_message_id text,
  p_metadata jsonb,
  p_last_message_at timestamptz,
  p_history_limit integer default 20
)
returns table(
  outcome text,
  conversation_row jsonb,
  message_row jsonb,
  recent_messages jsonb,
  conversation_lookup_ms numeric,
  inbound_persistence_ms numeric,
  conversation_update_ms numeric,
  history_load_ms numeric,
  customer_allowed boolean,
  gym_allowed boolean,
  rate_limit_ms numeric
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_started_at timestamptz;
  v_endpoint public.whatsapp_endpoints%rowtype;
  v_conversation public.conversations%rowtype;
  v_message public.messages%rowtype;
  v_recent jsonb := '[]'::jsonb;
  v_lookup_ms numeric := 0;
  v_insert_ms numeric := 0;
  v_update_ms numeric := 0;
  v_history_ms numeric := 0;
  v_rate_limit_ms numeric := 0;
  v_customer_allowed boolean;
  v_gym_allowed boolean;
  v_limit integer := greatest(1, least(coalesce(p_history_limit, 20), 100));
begin
  if p_whatsapp_message_id is null or btrim(p_whatsapp_message_id) = '' then
    raise exception 'WhatsApp message ID is required.';
  end if;
  if p_metadata is null or jsonb_typeof(p_metadata) <> 'object' then
    raise exception 'Message metadata must be a JSON object.';
  end if;

  v_started_at := clock_timestamp();
  select e.* into v_endpoint
  from public.whatsapp_endpoints e
  where e.id = p_endpoint_id
    and e.gym_id = p_gym_id
    and e.is_active = true
  limit 1;

  if not found then
    raise exception 'Authoritative WhatsApp endpoint is unavailable.';
  end if;

  -- This indexed lookup plus the unique insert below form the second
  -- authoritative idempotency boundary for races after preflight.
  select m.* into v_message
  from public.messages m
  where m.whatsapp_message_id = p_whatsapp_message_id
  limit 1;
  if found then
    select c.* into v_conversation
    from public.conversations c
    where c.id = v_message.conversation_id
    limit 1;
    return query select 'duplicate'::text, to_jsonb(v_conversation),
      to_jsonb(v_message), '[]'::jsonb, 0::numeric, 0::numeric,
      0::numeric, 0::numeric, null::boolean, null::boolean, 0::numeric;
    return;
  end if;

  v_started_at := clock_timestamp();
  select r.allowed into v_customer_allowed
  from public.consume_rate_limit(
    p_customer_bucket,
    p_customer_limit,
    p_window_seconds
  ) r;
  select r.allowed into v_gym_allowed
  from public.consume_rate_limit(
    p_gym_bucket,
    p_gym_limit,
    p_window_seconds
  ) r;
  v_rate_limit_ms := extract(epoch from (clock_timestamp() - v_started_at)) * 1000;

  v_started_at := clock_timestamp();
  select c.* into v_conversation
  from public.conversations c
  where c.gym_id = p_gym_id
    and c.whatsapp_endpoint_id = p_endpoint_id
    and c.customer_phone = p_customer_phone
  limit 1;
  v_lookup_ms := extract(epoch from (clock_timestamp() - v_started_at)) * 1000;

  if v_conversation.id is null then
    return query select 'not_established'::text, null::jsonb, null::jsonb,
      '[]'::jsonb, v_lookup_ms, 0::numeric, 0::numeric, 0::numeric,
      v_customer_allowed, v_gym_allowed, v_rate_limit_ms;
    return;
  end if;

  v_started_at := clock_timestamp();
  insert into public.messages (
    conversation_id,
    sender_type,
    message_type,
    whatsapp_message_id,
    content,
    metadata
  ) values (
    v_conversation.id,
    'customer',
    p_message_type,
    p_whatsapp_message_id,
    p_content,
    p_metadata
  )
  on conflict (whatsapp_message_id)
    where whatsapp_message_id is not null
  do nothing
  returning * into v_message;
  v_insert_ms := extract(epoch from (clock_timestamp() - v_started_at)) * 1000;

  if v_message.id is null then
    select m.* into v_message
    from public.messages m
    where m.whatsapp_message_id = p_whatsapp_message_id
    limit 1;
    return query select 'duplicate'::text, to_jsonb(v_conversation),
      to_jsonb(v_message), '[]'::jsonb, v_lookup_ms, v_insert_ms,
      0::numeric, 0::numeric, v_customer_allowed, v_gym_allowed,
      v_rate_limit_ms;
    return;
  end if;

  v_started_at := clock_timestamp();
  update public.conversations c
  set branch_id = case
        when c.branch_id is null and v_endpoint.branch_id is not null
          then v_endpoint.branch_id
        else c.branch_id
      end,
      last_message_at = p_last_message_at
  where c.id = v_conversation.id
    and c.gym_id = p_gym_id
    and c.whatsapp_endpoint_id = p_endpoint_id
  returning c.* into v_conversation;
  v_update_ms := extract(epoch from (clock_timestamp() - v_started_at)) * 1000;

  if v_conversation.id is null then
    raise exception 'Conversation changed during inbound persistence.';
  end if;

  v_started_at := clock_timestamp();
  select coalesce(jsonb_agg(to_jsonb(recent) order by recent.created_at, recent.id),
                  '[]'::jsonb)
  into v_recent
  from (
    select m.*
    from public.messages m
    where m.conversation_id = v_conversation.id
    order by m.created_at desc, m.id desc
    limit v_limit
  ) recent;
  v_history_ms := extract(epoch from (clock_timestamp() - v_started_at)) * 1000;

  return query select 'inserted'::text, to_jsonb(v_conversation),
    to_jsonb(v_message), v_recent, v_lookup_ms, v_insert_ms,
    v_update_ms, v_history_ms, v_customer_allowed, v_gym_allowed,
    v_rate_limit_ms;
end;
$$;

revoke all on function public.ingest_established_whatsapp_message(
  uuid, uuid, text, integer, text, integer, integer,
  text, text, text, text, jsonb, timestamptz, integer
) from public, anon, authenticated;
grant execute on function public.ingest_established_whatsapp_message(
  uuid, uuid, text, integer, text, integer, integer,
  text, text, text, text, jsonb, timestamptz, integer
) to service_role;

-- Preserve the application's exact TypeScript memory/stage merge while making
-- the final conversation update and one-text message insert transactional.
-- updated_at is an optimistic concurrency token from the mandatory fresh read.
create or replace function public.persist_whatsapp_ai_text_reply(
  p_conversation_id uuid,
  p_expected_updated_at timestamptz,
  p_latest_understanding jsonb,
  p_update_customer_memory boolean,
  p_customer_memory jsonb,
  p_lead_stage text,
  p_ai_lead_at timestamptz,
  p_update_branch boolean,
  p_branch_id uuid,
  p_last_message_at timestamptz,
  p_content text,
  p_metadata jsonb
)
returns table(
  outcome text,
  conversation_row jsonb,
  message_row jsonb,
  conversation_update_ms numeric,
  message_insert_ms numeric
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_conversation public.conversations%rowtype;
  v_message public.messages%rowtype;
  v_started_at timestamptz;
  v_update_ms numeric := 0;
  v_insert_ms numeric := 0;
begin
  if p_latest_understanding is not null and
     jsonb_typeof(p_latest_understanding) <> 'object' then
    raise exception 'Latest understanding must be a JSON object.';
  end if;
  if p_update_customer_memory and p_customer_memory is not null and
     jsonb_typeof(p_customer_memory) <> 'object' then
    raise exception 'Customer memory must be a JSON object.';
  end if;
  if p_lead_stage is not null and p_lead_stage not in
     ('new_lead', 'qualified', 'trial_booked', 'member', 'lost') then
    raise exception 'Invalid lead stage.';
  end if;
  if p_metadata is null or jsonb_typeof(p_metadata) <> 'object' then
    raise exception 'Message metadata must be a JSON object.';
  end if;

  select c.* into v_conversation
  from public.conversations c
  where c.id = p_conversation_id
  for update;

  if v_conversation.id is null then
    return query select 'not_found'::text, null::jsonb, null::jsonb,
      0::numeric, 0::numeric;
    return;
  end if;

  if v_conversation.updated_at is distinct from p_expected_updated_at then
    return query select 'conflict'::text, to_jsonb(v_conversation), null::jsonb,
      0::numeric, 0::numeric;
    return;
  end if;

  if p_update_branch then
    if p_branch_id is null or not exists (
      select 1 from public.branches b
      where b.id = p_branch_id and b.gym_id = v_conversation.gym_id
    ) then
      raise exception 'Reply branch must belong to the conversation gym.';
    end if;
  end if;

  v_started_at := clock_timestamp();
  update public.conversations c
  set latest_understanding = p_latest_understanding,
      customer_memory = case
        when p_update_customer_memory then p_customer_memory
        else c.customer_memory
      end,
      lead_stage = coalesce(p_lead_stage, c.lead_stage),
      ai_lead_at = case
        when c.ai_lead_at is null and p_ai_lead_at is not null then p_ai_lead_at
        else c.ai_lead_at
      end,
      branch_id = case when p_update_branch then p_branch_id else c.branch_id end,
      last_message_at = p_last_message_at
  where c.id = v_conversation.id
  returning c.* into v_conversation;
  v_update_ms := extract(epoch from (clock_timestamp() - v_started_at)) * 1000;

  v_started_at := clock_timestamp();
  insert into public.messages (
    conversation_id,
    sender_type,
    message_type,
    content,
    metadata
  ) values (
    v_conversation.id,
    'ai',
    'text',
    p_content,
    p_metadata
  )
  returning * into v_message;
  v_insert_ms := extract(epoch from (clock_timestamp() - v_started_at)) * 1000;

  return query select 'saved'::text, to_jsonb(v_conversation),
    to_jsonb(v_message), v_update_ms, v_insert_ms;
end;
$$;

revoke all on function public.persist_whatsapp_ai_text_reply(
  uuid, timestamptz, jsonb, boolean, jsonb, text, timestamptz,
  boolean, uuid, timestamptz, text, jsonb
) from public, anon, authenticated;
grant execute on function public.persist_whatsapp_ai_text_reply(
  uuid, timestamptz, jsonb, boolean, jsonb, text, timestamptz,
  boolean, uuid, timestamptz, text, jsonb
) to service_role;
