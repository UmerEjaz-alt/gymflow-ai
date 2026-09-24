-- Durable Twilio SMS delivery for newly persisted, anchored SMS AI replies.
-- Existing SMS replies are intentionally not backfilled: sending historical
-- replies after deployment would create surprising delayed customer messages.

create table public.sms_outbound_deliveries (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null unique references public.messages(id) on delete cascade,
  gym_id uuid not null references public.gyms(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  sms_endpoint_id uuid not null references public.sms_endpoints(id) on delete restrict,
  provider text not null,
  destination_phone text not null,
  origin_phone text not null,
  status text not null default 'pending'
    check (status in (
      'pending', 'processing', 'sending', 'sent', 'delivered',
      'failed', 'undelivered', 'uncertain'
    )),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  max_attempts integer not null default 5 check (max_attempts between 1 and 20),
  retryable boolean not null default true,
  next_attempt_at timestamptz not null default now(),
  claim_token uuid,
  claimed_at timestamptz,
  lease_expires_at timestamptz,
  provider_message_id text,
  provider_status text,
  provider_error_code text,
  sms_encoding text check (sms_encoding is null or sms_encoding in ('gsm7', 'ucs2')),
  expected_segment_count integer check (
    expected_segment_count is null or expected_segment_count > 0
  ),
  provider_segment_count integer check (
    provider_segment_count is null or provider_segment_count > 0
  ),
  unsupported_media_count integer not null default 0
    check (unsupported_media_count >= 0),
  last_error text,
  accepted_at timestamptz,
  sent_at timestamptz,
  delivered_at timestamptz,
  failed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sms_outbound_deliveries_provider_format check (
    provider = lower(btrim(provider))
    and provider ~ '^[a-z][a-z0-9_-]{0,63}$'
  ),
  constraint sms_outbound_deliveries_phone_presence check (
    char_length(regexp_replace(origin_phone, '\D', '', 'g')) between 7 and 15
    and char_length(regexp_replace(destination_phone, '\D', '', 'g')) between 7 and 15
  ),
  constraint sms_outbound_deliveries_claim_state check (
    (
      status in ('processing', 'sending')
      and claim_token is not null
      and claimed_at is not null
      and lease_expires_at is not null
    )
    or (
      status not in ('processing', 'sending')
      and claim_token is null
      and lease_expires_at is null
    )
  )
);

create unique index sms_outbound_deliveries_provider_message_unique
  on public.sms_outbound_deliveries(provider, provider_message_id)
  where provider_message_id is not null;

create index sms_outbound_deliveries_due_idx
  on public.sms_outbound_deliveries(next_attempt_at, created_at)
  where status in ('pending', 'failed') and retryable = true;

create index sms_outbound_deliveries_lease_idx
  on public.sms_outbound_deliveries(lease_expires_at)
  where status in ('processing', 'sending');

create index sms_outbound_deliveries_conversation_idx
  on public.sms_outbound_deliveries(conversation_id, created_at);

create index sms_outbound_deliveries_endpoint_idx
  on public.sms_outbound_deliveries(sms_endpoint_id, created_at);

create trigger sms_outbound_deliveries_set_updated_at
  before update on public.sms_outbound_deliveries
  for each row execute procedure public.set_updated_at();

create or replace function public.enforce_sms_outbound_delivery_integrity()
returns trigger
language plpgsql
as $$
begin
  if not exists (
    select 1
    from public.messages m
    join public.conversations c on c.id = m.conversation_id
    join public.sms_endpoints e on e.id = c.sms_endpoint_id
    where m.id = new.message_id
      and m.conversation_id = new.conversation_id
      and m.sender_type = 'ai'
      and m.message_type = 'text'
      and m.sms_inbound_reply_to_message_id is not null
      and c.id = new.conversation_id
      and c.gym_id = new.gym_id
      and c.source = 'sms'
      and c.whatsapp_endpoint_id is null
      and c.sms_endpoint_id = new.sms_endpoint_id
      and e.id = new.sms_endpoint_id
      and e.gym_id = new.gym_id
      and e.provider = new.provider
      and regexp_replace(e.phone_number, '\D', '', 'g') =
          regexp_replace(new.origin_phone, '\D', '', 'g')
      and regexp_replace(c.customer_phone, '\D', '', 'g') =
          regexp_replace(new.destination_phone, '\D', '', 'g')
  ) then
    raise exception 'SMS delivery must match its anchored AI message, conversation, endpoint, and gym.';
  end if;

  return new;
end;
$$;

create trigger sms_outbound_deliveries_integrity
  before insert or update of message_id, gym_id, conversation_id,
    sms_endpoint_id, provider, destination_phone, origin_phone
  on public.sms_outbound_deliveries
  for each row execute function public.enforce_sms_outbound_delivery_integrity();

alter table public.sms_outbound_deliveries enable row level security;
revoke all on table public.sms_outbound_deliveries
  from public, anon, authenticated;

-- Queue eligibility uses authoritative message/conversation fields. Metadata
-- only carries the count of media omitted by the SMS text-only persistence rule.
create or replace function public.queue_sms_outbound_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_conversation public.conversations%rowtype;
  v_endpoint public.sms_endpoints%rowtype;
  v_media_count integer := 0;
  v_ready boolean := false;
begin
  if new.sender_type <> 'ai'
     or new.message_type <> 'text'
     or new.sms_inbound_reply_to_message_id is null then
    return new;
  end if;

  select c.* into v_conversation
  from public.conversations c
  where c.id = new.conversation_id
    and c.source = 'sms'
    and c.sms_endpoint_id is not null
    and c.whatsapp_endpoint_id is null;

  if not found then return new; end if;

  select e.* into v_endpoint
  from public.sms_endpoints e
  where e.id = v_conversation.sms_endpoint_id
    and e.gym_id = v_conversation.gym_id;

  if not found then
    raise exception 'SMS conversation endpoint is unavailable.';
  end if;

  v_ready := v_endpoint.is_active and v_endpoint.provider = 'twilio';
  if jsonb_typeof(new.metadata->'sms_unsupported_media_count') = 'number' then
    v_media_count := greatest(
      0,
      least(100, (new.metadata->>'sms_unsupported_media_count')::integer)
    );
  end if;

  insert into public.sms_outbound_deliveries (
    message_id, gym_id, conversation_id, sms_endpoint_id, provider,
    destination_phone, origin_phone, status, retryable,
    unsupported_media_count, last_error
  ) values (
    new.id, v_conversation.gym_id, v_conversation.id, v_endpoint.id,
    v_endpoint.provider, v_conversation.customer_phone, v_endpoint.phone_number,
    case when v_ready then 'pending' else 'failed' end,
    v_ready,
    v_media_count,
    case
      when not v_endpoint.is_active then 'The SMS endpoint is inactive.'
      when v_endpoint.provider <> 'twilio' then 'The SMS endpoint provider is not supported for outbound delivery.'
      else null
    end
  )
  on conflict (message_id) do nothing;

  return new;
end;
$$;

create trigger messages_queue_sms_outbound
  after insert on public.messages
  for each row execute function public.queue_sms_outbound_message();

revoke all on function public.queue_sms_outbound_message()
  from public, anon, authenticated;

create or replace function public.claim_sms_outbound_delivery(
  p_message_id uuid default null,
  p_lease_seconds integer default 300
)
returns table(
  delivery_row jsonb,
  message_row jsonb,
  endpoint_row jsonb
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_token uuid := gen_random_uuid();
  v_delivery public.sms_outbound_deliveries%rowtype;
  v_message public.messages%rowtype;
  v_endpoint public.sms_endpoints%rowtype;
begin
  -- Crossing the sending boundary means Twilio may have accepted the SMS.
  -- An expired worker is quarantined rather than automatically resent.
  update public.sms_outbound_deliveries d
  set status = 'uncertain',
      retryable = false,
      claim_token = null,
      claimed_at = null,
      lease_expires_at = null,
      last_error = coalesce(
        d.last_error,
        'SMS worker ended after the Twilio send boundary; manual reconciliation is required.'
      )
  where d.status = 'sending'
    and d.lease_expires_at is not null
    and d.lease_expires_at <= now()
    and (p_message_id is null or d.message_id = p_message_id);

  update public.sms_outbound_deliveries d
  set status = 'failed',
      retryable = false,
      claim_token = null,
      claimed_at = null,
      lease_expires_at = null,
      failed_at = now(),
      last_error = coalesce(
        d.last_error,
        'SMS delivery lease expired after the maximum attempt count.'
      )
  where d.status = 'processing'
    and d.lease_expires_at is not null
    and d.lease_expires_at <= now()
    and d.attempt_count >= d.max_attempts
    and (p_message_id is null or d.message_id = p_message_id);

  select d.id into v_id
  from public.sms_outbound_deliveries d
  where (
      d.status in ('pending', 'failed')
      or (
        d.status = 'processing'
        and d.lease_expires_at is not null
        and d.lease_expires_at <= now()
      )
    )
    and d.retryable = true
    and d.next_attempt_at <= now()
    and d.attempt_count < d.max_attempts
    and (p_message_id is null or d.message_id = p_message_id)
  order by d.next_attempt_at, d.created_at
  for update skip locked
  limit 1;

  if v_id is null then return; end if;

  update public.sms_outbound_deliveries d
  set status = 'processing',
      claim_token = v_token,
      claimed_at = now(),
      lease_expires_at = now() + make_interval(
        secs => greatest(60, least(coalesce(p_lease_seconds, 300), 1800))
      ),
      attempt_count = d.attempt_count + 1,
      last_error = null,
      failed_at = null
  where d.id = v_id
  returning d.* into v_delivery;

  select m.* into v_message
  from public.messages m
  where m.id = v_delivery.message_id;

  select e.* into v_endpoint
  from public.sms_endpoints e
  where e.id = v_delivery.sms_endpoint_id;

  return query select to_jsonb(v_delivery), to_jsonb(v_message), to_jsonb(v_endpoint);
end;
$$;

revoke all on function public.claim_sms_outbound_delivery(uuid, integer)
  from public, anon, authenticated;
grant execute on function public.claim_sms_outbound_delivery(uuid, integer)
  to service_role;

create or replace function public.begin_sms_outbound_send(
  p_delivery_id uuid,
  p_claim_token uuid,
  p_sms_encoding text,
  p_expected_segment_count integer
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_updated integer;
begin
  if p_sms_encoding not in ('gsm7', 'ucs2')
     or p_expected_segment_count is null
     or p_expected_segment_count < 1 then
    raise exception 'Valid SMS segment information is required.';
  end if;

  update public.sms_outbound_deliveries
  set status = 'sending',
      sms_encoding = p_sms_encoding,
      expected_segment_count = p_expected_segment_count,
      lease_expires_at = now() + interval '5 minutes'
  where id = p_delivery_id
    and status = 'processing'
    and claim_token = p_claim_token
    and lease_expires_at > now();
  get diagnostics v_updated = row_count;
  return v_updated = 1;
end;
$$;

revoke all on function public.begin_sms_outbound_send(uuid, uuid, text, integer)
  from public, anon, authenticated;
grant execute on function public.begin_sms_outbound_send(uuid, uuid, text, integer)
  to service_role;

create or replace function public.fail_sms_outbound_delivery(
  p_delivery_id uuid,
  p_claim_token uuid,
  p_disposition text,
  p_error text
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_delivery public.sms_outbound_deliveries%rowtype;
  v_retry boolean;
  v_status text;
begin
  if p_disposition not in ('retryable', 'permanent', 'uncertain') then
    raise exception 'Invalid SMS failure disposition.';
  end if;

  select d.* into v_delivery
  from public.sms_outbound_deliveries d
  where d.id = p_delivery_id
    and d.status in ('processing', 'sending')
    and d.claim_token = p_claim_token
    and d.lease_expires_at > now()
  for update;

  if not found then return 'claim_lost'; end if;

  v_retry := p_disposition = 'retryable'
    and v_delivery.attempt_count < v_delivery.max_attempts;
  v_status := case when p_disposition = 'uncertain' then 'uncertain' else 'failed' end;

  update public.sms_outbound_deliveries
  set status = v_status,
      retryable = v_retry,
      next_attempt_at = case
        when v_retry then now() + make_interval(
          secs => least(3600, 30 * power(2, greatest(v_delivery.attempt_count - 1, 0)))::integer
        )
        else next_attempt_at
      end,
      claim_token = null,
      claimed_at = null,
      lease_expires_at = null,
      last_error = left(coalesce(nullif(btrim(p_error), ''), 'SMS delivery failed.'), 1000),
      failed_at = case when v_retry then null else now() end
  where id = v_delivery.id;

  return case
    when p_disposition = 'uncertain' then 'uncertain'
    when v_retry then 'retryable_failure'
    else 'failed'
  end;
end;
$$;

revoke all on function public.fail_sms_outbound_delivery(uuid, uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.fail_sms_outbound_delivery(uuid, uuid, text, text)
  to service_role;

create or replace function public.finalize_sms_outbound_acceptance(
  p_delivery_id uuid,
  p_claim_token uuid,
  p_provider_message_id text,
  p_provider_status text,
  p_accepted_at timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_delivery public.sms_outbound_deliveries%rowtype;
begin
  if p_provider_message_id is null or btrim(p_provider_message_id) = '' then
    raise exception 'SMS provider message ID is required.';
  end if;

  select d.* into v_delivery
  from public.sms_outbound_deliveries d
  where d.id = p_delivery_id
  for update;

  if not found then return false; end if;

  -- The callback may win the race and clear the claim. In that case, the
  -- provider SID it durably recorded is the correlation authority.
  if not (
    (v_delivery.status = 'sending' and v_delivery.claim_token = p_claim_token)
    or (
      v_delivery.status in ('sent', 'delivered', 'failed', 'undelivered')
      and v_delivery.provider_message_id = p_provider_message_id
    )
  ) then
    return false;
  end if;

  if v_delivery.provider_message_id is not null
     and v_delivery.provider_message_id <> p_provider_message_id then
    return false;
  end if;

  update public.sms_outbound_deliveries
  set status = case
        when v_delivery.status in ('delivered', 'failed', 'undelivered')
          then v_delivery.status
        else 'sent'
      end,
      retryable = false,
      provider_message_id = p_provider_message_id,
      provider_status = case
        when v_delivery.status = 'sending' then lower(btrim(p_provider_status))
        else provider_status
      end,
      accepted_at = coalesce(accepted_at, p_accepted_at),
      sent_at = case
        when lower(btrim(p_provider_status)) in ('sending', 'sent')
          then coalesce(sent_at, p_accepted_at)
        else sent_at
      end,
      claim_token = null,
      claimed_at = null,
      lease_expires_at = null,
      last_error = case
        when v_delivery.status in ('failed', 'undelivered') then last_error
        else null
      end
  where id = v_delivery.id;

  return true;
end;
$$;

revoke all on function public.finalize_sms_outbound_acceptance(
  uuid, uuid, text, text, timestamptz
) from public, anon, authenticated;
grant execute on function public.finalize_sms_outbound_acceptance(
  uuid, uuid, text, text, timestamptz
) to service_role;

create or replace function public.apply_sms_delivery_status(
  p_delivery_id uuid,
  p_provider text,
  p_provider_message_id text,
  p_provider_status text,
  p_error_code text default null,
  p_provider_segment_count integer default null
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_delivery public.sms_outbound_deliveries%rowtype;
  v_status text := lower(btrim(coalesce(p_provider_status, '')));
  v_target text;
begin
  v_target := case
    when v_status in ('accepted', 'queued', 'scheduled', 'sending', 'sent') then 'sent'
    when v_status in ('delivered', 'read') then 'delivered'
    when v_status = 'undelivered' then 'undelivered'
    when v_status in ('failed', 'canceled') then 'failed'
    else null
  end;

  if v_target is null then return 'ignored_status'; end if;
  if p_provider_message_id is null or btrim(p_provider_message_id) = '' then
    return 'invalid_provider_message';
  end if;

  select d.* into v_delivery
  from public.sms_outbound_deliveries d
  where d.id = p_delivery_id
  for update;

  if not found then return 'not_found'; end if;
  if v_delivery.provider <> p_provider then return 'provider_mismatch'; end if;
  if v_delivery.status not in (
    'sending', 'sent', 'delivered', 'failed', 'undelivered', 'uncertain'
  ) then
    return 'invalid_state';
  end if;
  if v_delivery.provider_message_id is not null
     and v_delivery.provider_message_id <> p_provider_message_id then
    return 'provider_message_mismatch';
  end if;

  -- Terminal provider outcomes never regress. Intermediate callbacks can
  -- resolve sending/uncertain work but cannot downgrade a terminal receipt.
  if v_delivery.status in ('delivered', 'failed', 'undelivered') then
    update public.sms_outbound_deliveries
    set provider_status = case
          when v_target = v_delivery.status then v_status
          else provider_status
        end,
        provider_error_code = coalesce(nullif(btrim(p_error_code), ''), provider_error_code),
        provider_segment_count = coalesce(p_provider_segment_count, provider_segment_count)
    where id = v_delivery.id;
    return 'duplicate_terminal';
  end if;

  update public.sms_outbound_deliveries
  set status = v_target,
      retryable = false,
      provider_message_id = p_provider_message_id,
      provider_status = v_status,
      provider_error_code = nullif(btrim(p_error_code), ''),
      provider_segment_count = coalesce(p_provider_segment_count, provider_segment_count),
      accepted_at = coalesce(accepted_at, now()),
      sent_at = case when v_target in ('sent', 'delivered') then coalesce(sent_at, now()) else sent_at end,
      delivered_at = case when v_target = 'delivered' then coalesce(delivered_at, now()) else delivered_at end,
      failed_at = case when v_target in ('failed', 'undelivered') then coalesce(failed_at, now()) else failed_at end,
      last_error = case
        when v_target in ('failed', 'undelivered') then
          left('Twilio delivery status: ' || v_status ||
            case when nullif(btrim(p_error_code), '') is not null
              then ' (error ' || btrim(p_error_code) || ')' else '' end, 1000)
        else null
      end,
      claim_token = null,
      claimed_at = null,
      lease_expires_at = null
  where id = v_delivery.id;

  if v_target = 'delivered' then
    update public.messages
    set delivered_at = coalesce(delivered_at, now())
    where id = v_delivery.message_id
      and conversation_id = v_delivery.conversation_id;
  end if;

  return 'updated';
end;
$$;

revoke all on function public.apply_sms_delivery_status(
  uuid, text, text, text, text, integer
) from public, anon, authenticated;
grant execute on function public.apply_sms_delivery_status(
  uuid, text, text, text, text, integer
) to service_role;
