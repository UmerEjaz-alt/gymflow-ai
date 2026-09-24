-- Additive inbound SMS persistence, routing, and atomic ingestion.
-- Outbound SMS delivery is intentionally not introduced in this migration.

alter table public.messages
  add column sms_provider text,
  add column sms_message_id text;

alter table public.messages
  add constraint messages_sms_identity_pair_check
  check (
    (sms_provider is null and sms_message_id is null)
    or (
      sms_provider is not null
      and sms_message_id is not null
      and sms_provider = lower(btrim(sms_provider))
      and sms_provider ~ '^[a-z][a-z0-9_-]{0,63}$'
      and btrim(sms_message_id) <> ''
    )
  );

alter table public.messages
  add constraint messages_sms_channel_identity_check
  check (
    not (whatsapp_message_id is not null and sms_message_id is not null)
    and (sms_message_id is null or sender_type = 'customer')
  );

-- Provider message identifiers are only authoritative inside their provider
-- namespace. This unique index is the final concurrency boundary for inbound
-- webhook retries and simultaneous duplicate deliveries.
create unique index messages_sms_provider_message_id_unique
  on public.messages(sms_provider, sms_message_id)
  where sms_provider is not null and sms_message_id is not null;

create index messages_sms_message_id_idx
  on public.messages(sms_message_id)
  where sms_message_id is not null;

-- Resolve only the SMS endpoint registry. The caller deliberately receives an
-- inactive row (rather than silently falling back) so the webhook can fail
-- closed and report the precise routing outcome.
create or replace function public.resolve_sms_endpoint(
  p_destination_phone text
)
returns table(
  endpoint_id uuid,
  gym_id uuid,
  branch_id uuid,
  provider text,
  is_active boolean
)
language sql
security definer
set search_path = public
stable
as $$
  select e.id, e.gym_id, e.branch_id, e.provider, e.is_active
  from public.sms_endpoints e
  where regexp_replace(e.phone_number, '\D', '', 'g') =
        regexp_replace(p_destination_phone, '\D', '', 'g')
  limit 1;
$$;

revoke all on function public.resolve_sms_endpoint(text)
  from public, anon, authenticated;
grant execute on function public.resolve_sms_endpoint(text)
  to service_role;

-- One transaction owns SMS conversation creation, provider-message
-- idempotency, durable rate-limit consumption, inbound persistence, route
-- stamping, and bounded history retrieval. A conflicting unique insert waits
-- for the winning transaction and returns duplicate without invoking AI.
create or replace function public.ingest_sms_message(
  p_gym_id uuid,
  p_sms_endpoint_id uuid,
  p_provider text,
  p_provider_message_id text,
  p_customer_phone text,
  p_customer_name text,
  p_message_type text,
  p_content text,
  p_metadata jsonb,
  p_last_message_at timestamptz,
  p_customer_bucket text,
  p_customer_limit integer,
  p_gym_bucket text,
  p_gym_limit integer,
  p_window_seconds integer,
  p_history_limit integer default 20
)
returns table(
  outcome text,
  conversation_row jsonb,
  message_row jsonb,
  recent_messages jsonb,
  customer_allowed boolean,
  gym_allowed boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_endpoint public.sms_endpoints%rowtype;
  v_conversation public.conversations%rowtype;
  v_message public.messages%rowtype;
  v_recent jsonb := '[]'::jsonb;
  v_customer_allowed boolean;
  v_gym_allowed boolean;
  v_limit integer := greatest(1, least(coalesce(p_history_limit, 20), 100));
begin
  if p_provider is null or p_provider <> lower(btrim(p_provider)) or
     p_provider !~ '^[a-z][a-z0-9_-]{0,63}$' then
    raise exception 'Valid SMS provider is required.';
  end if;
  if p_provider_message_id is null or btrim(p_provider_message_id) = '' then
    raise exception 'SMS provider message ID is required.';
  end if;
  if p_message_type <> 'text' then
    raise exception 'Only text SMS ingestion is supported.';
  end if;
  if p_content is null or btrim(p_content) = '' then
    raise exception 'SMS message content is required.';
  end if;
  if p_metadata is null or jsonb_typeof(p_metadata) <> 'object' then
    raise exception 'Message metadata must be a JSON object.';
  end if;

  select e.* into v_endpoint
  from public.sms_endpoints e
  where e.id = p_sms_endpoint_id
    and e.gym_id = p_gym_id
    and e.provider = p_provider
    and e.is_active = true
  limit 1;

  if not found then
    raise exception 'Authoritative SMS endpoint is unavailable.';
  end if;

  -- Fast sequential duplicate path. The unique insert below remains the
  -- authority for concurrent requests.
  select m.* into v_message
  from public.messages m
  where m.sms_provider = p_provider
    and m.sms_message_id = p_provider_message_id
  limit 1;

  if found then
    select c.* into v_conversation
    from public.conversations c
    where c.id = v_message.conversation_id
    limit 1;
    return query select 'duplicate'::text, to_jsonb(v_conversation),
      to_jsonb(v_message), '[]'::jsonb, null::boolean, null::boolean;
    return;
  end if;

  select c.* into v_conversation
  from public.conversations c
  where c.gym_id = p_gym_id
    and c.sms_endpoint_id = p_sms_endpoint_id
    and c.customer_phone = p_customer_phone
  limit 1;

  if v_conversation.id is null then
    insert into public.conversations (
      gym_id,
      branch_id,
      sms_endpoint_id,
      customer_phone,
      customer_name,
      source,
      last_message_at
    ) values (
      p_gym_id,
      v_endpoint.branch_id,
      p_sms_endpoint_id,
      p_customer_phone,
      nullif(btrim(p_customer_name), ''),
      'sms',
      p_last_message_at
    )
    on conflict (gym_id, sms_endpoint_id, customer_phone)
      where sms_endpoint_id is not null
    do nothing
    returning * into v_conversation;

    if v_conversation.id is null then
      select c.* into v_conversation
      from public.conversations c
      where c.gym_id = p_gym_id
        and c.sms_endpoint_id = p_sms_endpoint_id
        and c.customer_phone = p_customer_phone
      limit 1;
    end if;
  end if;

  if v_conversation.id is null or v_conversation.source <> 'sms' then
    raise exception 'SMS conversation could not be resolved.';
  end if;

  insert into public.messages (
    conversation_id,
    sender_type,
    message_type,
    sms_provider,
    sms_message_id,
    content,
    metadata
  ) values (
    v_conversation.id,
    'customer',
    'text',
    p_provider,
    p_provider_message_id,
    p_content,
    p_metadata
  )
  on conflict (sms_provider, sms_message_id)
    where sms_provider is not null and sms_message_id is not null
  do nothing
  returning * into v_message;

  if v_message.id is null then
    select m.* into v_message
    from public.messages m
    where m.sms_provider = p_provider
      and m.sms_message_id = p_provider_message_id
    limit 1;
    select c.* into v_conversation
    from public.conversations c
    where c.id = v_message.conversation_id
    limit 1;
    return query select 'duplicate'::text, to_jsonb(v_conversation),
      to_jsonb(v_message), '[]'::jsonb, null::boolean, null::boolean;
    return;
  end if;

  -- Only the transaction that inserted the inbound message consumes budget.
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

  update public.conversations c
  set branch_id = case
        when c.branch_id is null and v_endpoint.branch_id is not null
          then v_endpoint.branch_id
        else c.branch_id
      end,
      customer_name = case
        when c.customer_name is null then nullif(btrim(p_customer_name), '')
        else c.customer_name
      end,
      last_message_at = p_last_message_at
  where c.id = v_conversation.id
    and c.gym_id = p_gym_id
    and c.sms_endpoint_id = p_sms_endpoint_id
  returning c.* into v_conversation;

  if v_conversation.id is null then
    raise exception 'Conversation changed during SMS inbound persistence.';
  end if;

  select coalesce(
    jsonb_agg(to_jsonb(recent) order by recent.created_at, recent.id),
    '[]'::jsonb
  ) into v_recent
  from (
    select m.*
    from public.messages m
    where m.conversation_id = v_conversation.id
    order by m.created_at desc, m.id desc
    limit v_limit
  ) recent;

  return query select 'inserted'::text, to_jsonb(v_conversation),
    to_jsonb(v_message), v_recent, v_customer_allowed, v_gym_allowed;
end;
$$;

revoke all on function public.ingest_sms_message(
  uuid, uuid, text, text, text, text, text, text, jsonb, timestamptz,
  text, integer, text, integer, integer, integer
) from public, anon, authenticated;
grant execute on function public.ingest_sms_message(
  uuid, uuid, text, text, text, text, text, text, jsonb, timestamptz,
  text, integer, text, integer, integer, integer
) to service_role;

-- AI booking actions are shared by conversation source. Preserve the existing
-- values and add only the SMS attribution required to avoid false WhatsApp
-- records when an inbound SMS turn creates a booking.
alter table public.bookings
  drop constraint bookings_source_check;

alter table public.bookings
  add constraint bookings_source_check
  check (source in ('manual', 'whatsapp', 'sms'));
