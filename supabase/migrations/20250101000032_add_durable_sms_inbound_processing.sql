-- Durable, recoverable AI processing for persisted inbound SMS messages.
-- This migration does not introduce outbound SMS delivery.

alter table public.messages
  add column sms_inbound_reply_to_message_id uuid
  references public.messages(id) on delete set null;

alter table public.messages
  add constraint messages_sms_inbound_reply_sender_check
  check (sms_inbound_reply_to_message_id is null or sender_type = 'ai');

-- One persisted inbound SMS may anchor at most one logical AI response. A
-- response sequence can contain additional rows; this anchor is placed on the
-- first persisted row and closes the reply-save/job-completion crash window.
create unique index messages_sms_inbound_reply_unique
  on public.messages(sms_inbound_reply_to_message_id)
  where sms_inbound_reply_to_message_id is not null;

create or replace function public.enforce_sms_inbound_reply_integrity()
returns trigger
language plpgsql
as $$
begin
  if new.sms_inbound_reply_to_message_id is not null and not exists (
    select 1
    from public.messages inbound
    where inbound.id = new.sms_inbound_reply_to_message_id
      and inbound.conversation_id = new.conversation_id
      and inbound.sender_type = 'customer'
      and inbound.sms_provider is not null
      and inbound.sms_message_id is not null
  ) then
    raise exception 'SMS AI reply must reference an inbound SMS in the same conversation.';
  end if;
  return new;
end;
$$;

create trigger messages_sms_inbound_reply_integrity
  before insert or update of sms_inbound_reply_to_message_id on public.messages
  for each row execute function public.enforce_sms_inbound_reply_integrity();

create table public.sms_inbound_processing (
  id uuid primary key default gen_random_uuid(),
  gym_id uuid not null references public.gyms(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  message_id uuid not null unique references public.messages(id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'completed', 'failed', 'dead', 'skipped')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  max_attempts integer not null default 5 check (max_attempts between 1 and 20),
  next_attempt_at timestamptz not null default now(),
  claim_token uuid,
  claimed_at timestamptz,
  lease_expires_at timestamptz,
  last_error text,
  skip_reason text,
  customer_rate_limit_allowed boolean,
  gym_rate_limit_allowed boolean,
  response_message_id uuid references public.messages(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint sms_inbound_processing_claim_state_check check (
    (status = 'processing' and claim_token is not null and lease_expires_at is not null)
    or (status <> 'processing' and claim_token is null and lease_expires_at is null)
  ),
  constraint sms_inbound_processing_terminal_state_check check (
    (status in ('completed', 'dead', 'skipped') and completed_at is not null)
    or (status not in ('completed', 'dead', 'skipped') and completed_at is null)
  )
);

create index sms_inbound_processing_due_idx
  on public.sms_inbound_processing(next_attempt_at, created_at)
  where status in ('pending', 'failed', 'processing');

create index sms_inbound_processing_lease_idx
  on public.sms_inbound_processing(lease_expires_at)
  where status = 'processing';

create index sms_inbound_processing_conversation_idx
  on public.sms_inbound_processing(conversation_id, created_at);

create trigger sms_inbound_processing_set_updated_at
  before update on public.sms_inbound_processing
  for each row execute procedure public.set_updated_at();

create or replace function public.enforce_sms_inbound_processing_integrity()
returns trigger
language plpgsql
as $$
begin
  if not exists (
    select 1
    from public.messages m
    join public.conversations c on c.id = m.conversation_id
    where m.id = new.message_id
      and m.conversation_id = new.conversation_id
      and m.sender_type = 'customer'
      and m.sms_provider is not null
      and m.sms_message_id is not null
      and c.id = new.conversation_id
      and c.gym_id = new.gym_id
      and c.source = 'sms'
  ) then
    raise exception 'SMS processing message must be an inbound SMS in the same conversation and gym.';
  end if;

  if new.response_message_id is not null and not exists (
    select 1
    from public.messages r
    where r.id = new.response_message_id
      and r.conversation_id = new.conversation_id
      and r.sender_type = 'ai'
      and r.sms_inbound_reply_to_message_id = new.message_id
  ) then
    raise exception 'SMS processing response must be the anchored AI reply.';
  end if;

  return new;
end;
$$;

create trigger sms_inbound_processing_integrity
  before insert or update on public.sms_inbound_processing
  for each row execute function public.enforce_sms_inbound_processing_integrity();

alter table public.sms_inbound_processing enable row level security;
revoke all on table public.sms_inbound_processing
  from public, anon, authenticated;

-- Rows that predate this reliability migration cannot be safely inferred as
-- answered or unanswered. Preserve them for manual audit without risking a
-- duplicate historical AI/business action.
insert into public.sms_inbound_processing (
  gym_id,
  conversation_id,
  message_id,
  status,
  last_error,
  skip_reason,
  completed_at
)
select c.gym_id,
       c.id,
       m.id,
       'dead',
       'Inbound SMS predates durable processing; manual review is required.',
       'pre_durable_processing',
       now()
from public.messages m
join public.conversations c on c.id = m.conversation_id
where m.sender_type = 'customer'
  and m.sms_provider is not null
  and m.sms_message_id is not null
on conflict (message_id) do nothing;

-- Replace the Phase 2 function additively. Message persistence, rate-limit
-- consumption, and work creation now share this one database transaction.
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
  v_should_process boolean;
  v_skip_reason text;
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
      gym_id, branch_id, sms_endpoint_id, customer_phone,
      customer_name, source, last_message_at
    ) values (
      p_gym_id, v_endpoint.branch_id, p_sms_endpoint_id, p_customer_phone,
      nullif(btrim(p_customer_name), ''), 'sms', p_last_message_at
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
    conversation_id, sender_type, message_type, sms_provider,
    sms_message_id, content, metadata
  ) values (
    v_conversation.id, 'customer', 'text', p_provider,
    p_provider_message_id, p_content, p_metadata
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

  -- Rate limits are consumed once, only by the transaction that inserted the
  -- canonical inbound message. Their decision is persisted on the work row.
  select r.allowed into v_customer_allowed
  from public.consume_rate_limit(
    p_customer_bucket, p_customer_limit, p_window_seconds
  ) r;
  select r.allowed into v_gym_allowed
  from public.consume_rate_limit(
    p_gym_bucket, p_gym_limit, p_window_seconds
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

  v_should_process :=
    v_customer_allowed = true
    and v_gym_allowed = true
    and v_conversation.ai_enabled = true
    and v_conversation.status = 'active';

  v_skip_reason := case
    when v_customer_allowed is distinct from true
      or v_gym_allowed is distinct from true then 'rate_limited'
    when v_conversation.status = 'human' then 'human_takeover'
    when v_conversation.status = 'closed' then 'conversation_closed'
    when v_conversation.ai_enabled is not true then 'ai_disabled'
    else null
  end;

  insert into public.sms_inbound_processing (
    gym_id, conversation_id, message_id, status, next_attempt_at,
    skip_reason, customer_rate_limit_allowed, gym_rate_limit_allowed,
    completed_at
  ) values (
    p_gym_id,
    v_conversation.id,
    v_message.id,
    case when v_should_process then 'pending' else 'skipped' end,
    now(),
    v_skip_reason,
    v_customer_allowed,
    v_gym_allowed,
    case when v_should_process then null else now() end
  );

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

-- Reconcile a reply saved before a worker could mark its job complete, then
-- atomically claim one due row. A ten-minute lease is comfortably longer than
-- the existing 25-second AI provider timeout while remaining recoverable.
create or replace function public.claim_sms_inbound_processing(
  p_message_id uuid default null,
  p_lease_seconds integer default 600
)
returns table(
  processing_row jsonb,
  conversation_row jsonb,
  message_row jsonb,
  recent_messages jsonb
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_token uuid := gen_random_uuid();
  v_processing public.sms_inbound_processing%rowtype;
  v_conversation public.conversations%rowtype;
  v_message public.messages%rowtype;
  v_recent jsonb := '[]'::jsonb;
begin
  update public.sms_inbound_processing p
  set status = 'completed',
      response_message_id = r.id,
      claim_token = null,
      claimed_at = null,
      lease_expires_at = null,
      last_error = null,
      completed_at = now()
  from public.messages r
  where r.sms_inbound_reply_to_message_id = p.message_id
    and p.status in ('pending', 'processing', 'failed')
    and (p_message_id is null or p.message_id = p_message_id);

  -- A worker may disappear on its final allowed attempt. Once that lease
  -- expires, make the exhaustion terminal instead of leaving it processing
  -- forever merely because no worker remained to call the failure function.
  update public.sms_inbound_processing p
  set status = 'dead',
      claim_token = null,
      claimed_at = null,
      lease_expires_at = null,
      last_error = coalesce(
        p.last_error,
        'SMS AI processing lease expired after the maximum attempt count.'
      ),
      completed_at = now()
  where p.status = 'processing'
    and p.lease_expires_at is not null
    and p.lease_expires_at <= now()
    and p.attempt_count >= p.max_attempts
    and (p_message_id is null or p.message_id = p_message_id);

  select p.id into v_id
  from public.sms_inbound_processing p
  where (
      p.status in ('pending', 'failed')
      or (
        p.status = 'processing'
        and p.lease_expires_at is not null
        and p.lease_expires_at <= now()
      )
    )
    and p.next_attempt_at <= now()
    and p.attempt_count < p.max_attempts
    and (p_message_id is null or p.message_id = p_message_id)
  order by p.next_attempt_at, p.created_at
  for update skip locked
  limit 1;

  if v_id is null then return; end if;

  update public.sms_inbound_processing p
  set status = 'processing',
      claim_token = v_token,
      claimed_at = now(),
      lease_expires_at = now() + make_interval(
        secs => greatest(60, least(p_lease_seconds, 1800))
      ),
      attempt_count = p.attempt_count + 1,
      last_error = null
  where p.id = v_id
  returning p.* into v_processing;

  select c.* into v_conversation
  from public.conversations c
  where c.id = v_processing.conversation_id;

  select m.* into v_message
  from public.messages m
  where m.id = v_processing.message_id;

  select coalesce(
    jsonb_agg(to_jsonb(recent) order by recent.created_at, recent.id),
    '[]'::jsonb
  ) into v_recent
  from (
    select m.*
    from public.messages m
    where m.conversation_id = v_processing.conversation_id
    order by m.created_at desc, m.id desc
    limit 20
  ) recent;

  return query select to_jsonb(v_processing), to_jsonb(v_conversation),
    to_jsonb(v_message), v_recent;
end;
$$;

revoke all on function public.claim_sms_inbound_processing(uuid, integer)
  from public, anon, authenticated;
grant execute on function public.claim_sms_inbound_processing(uuid, integer)
  to service_role;

create or replace function public.complete_sms_inbound_processing(
  p_processing_id uuid,
  p_claim_token uuid,
  p_response_message_id uuid default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_updated integer;
begin
  if p_response_message_id is not null and not exists (
    select 1
    from public.sms_inbound_processing p
    join public.messages r
      on r.id = p_response_message_id
     and r.conversation_id = p.conversation_id
     and r.sms_inbound_reply_to_message_id = p.message_id
    where p.id = p_processing_id
  ) then
    raise exception 'Response message does not belong to this SMS processing job.';
  end if;

  update public.sms_inbound_processing
  set status = 'completed',
      response_message_id = p_response_message_id,
      claim_token = null,
      claimed_at = null,
      lease_expires_at = null,
      last_error = null,
      completed_at = now()
  where id = p_processing_id
    and status = 'processing'
    and claim_token = p_claim_token
    and lease_expires_at > now();
  get diagnostics v_updated = row_count;
  return v_updated = 1;
end;
$$;

revoke all on function public.complete_sms_inbound_processing(uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.complete_sms_inbound_processing(uuid, uuid, uuid)
  to service_role;

create or replace function public.skip_sms_inbound_processing(
  p_processing_id uuid,
  p_claim_token uuid,
  p_reason text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_updated integer;
begin
  update public.sms_inbound_processing
  set status = 'skipped',
      skip_reason = left(coalesce(nullif(btrim(p_reason), ''), 'no_ai_required'), 120),
      claim_token = null,
      claimed_at = null,
      lease_expires_at = null,
      last_error = null,
      completed_at = now()
  where id = p_processing_id
    and status = 'processing'
    and claim_token = p_claim_token
    and lease_expires_at > now();
  get diagnostics v_updated = row_count;
  return v_updated = 1;
end;
$$;

revoke all on function public.skip_sms_inbound_processing(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.skip_sms_inbound_processing(uuid, uuid, text)
  to service_role;

create or replace function public.fail_sms_inbound_processing(
  p_processing_id uuid,
  p_claim_token uuid,
  p_error text
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_processing public.sms_inbound_processing%rowtype;
  v_status text;
begin
  select p.* into v_processing
  from public.sms_inbound_processing p
  where p.id = p_processing_id
    and p.status = 'processing'
    and p.claim_token = p_claim_token
    and p.lease_expires_at > now()
  for update;

  if not found then return 'claim_lost'; end if;

  v_status := case
    when v_processing.attempt_count >= v_processing.max_attempts then 'dead'
    else 'failed'
  end;

  update public.sms_inbound_processing
  set status = v_status,
      claim_token = null,
      claimed_at = null,
      lease_expires_at = null,
      next_attempt_at = case
        when v_status = 'dead' then next_attempt_at
        else now() + make_interval(
          secs => least(3600, 30 * power(2, greatest(attempt_count - 1, 0))::integer)
        )
      end,
      last_error = left(coalesce(nullif(btrim(p_error), ''), 'SMS AI processing failed.'), 1000),
      completed_at = case when v_status = 'dead' then now() else null end
  where id = p_processing_id;

  return v_status;
end;
$$;

revoke all on function public.fail_sms_inbound_processing(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.fail_sms_inbound_processing(uuid, uuid, text)
  to service_role;
