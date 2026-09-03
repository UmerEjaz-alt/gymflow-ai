-- Durable delivery, automation claims, and bounded abuse controls.
-- Additive only: existing messages/executions remain unchanged.

create table if not exists public.whatsapp_outbound_deliveries (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null unique references public.messages(id) on delete cascade,
  gym_id uuid not null references public.gyms(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  whatsapp_endpoint_id uuid references public.whatsapp_endpoints(id) on delete set null,
  phone_number_id text,
  recipient_phone text not null,
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'sending', 'sent', 'failed', 'uncertain')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  retryable boolean not null default true,
  next_attempt_at timestamptz not null default now(),
  claim_token uuid,
  claimed_at timestamptz,
  lease_expires_at timestamptz,
  meta_message_id text,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  sent_at timestamptz
);

create index if not exists whatsapp_outbound_deliveries_due_idx
  on public.whatsapp_outbound_deliveries(next_attempt_at, created_at)
  where status in ('pending', 'failed') and retryable = true;
create index if not exists whatsapp_outbound_deliveries_conversation_idx
  on public.whatsapp_outbound_deliveries(conversation_id, created_at);
create index if not exists whatsapp_outbound_deliveries_lease_idx
  on public.whatsapp_outbound_deliveries(lease_expires_at)
  where status in ('processing', 'sending');

alter table public.whatsapp_outbound_deliveries enable row level security;
revoke all on table public.whatsapp_outbound_deliveries
  from public, anon, authenticated;

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
  if new.sender_type <> 'ai'
     or new.metadata->>'outbound_delivery' is distinct from 'whatsapp_outbox' then
    return new;
  end if;

  select * into v_conversation
  from public.conversations
  where id = new.conversation_id;

  if not found then
    return new;
  end if;

  if v_conversation.whatsapp_endpoint_id is not null then
    select * into v_endpoint
    from public.whatsapp_endpoints
    where id = v_conversation.whatsapp_endpoint_id
      and gym_id = v_conversation.gym_id
      and is_active = true;
  elsif v_conversation.branch_id is not null then
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

drop trigger if exists messages_queue_whatsapp_outbound on public.messages;
create trigger messages_queue_whatsapp_outbound
  after insert on public.messages
  for each row execute function public.queue_whatsapp_outbound_message();

revoke all on function public.queue_whatsapp_outbound_message()
  from public, anon, authenticated;

create or replace function public.claim_whatsapp_outbound_delivery(
  p_message_id uuid default null,
  p_conversation_id uuid default null
)
returns setof public.whatsapp_outbound_deliveries
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_token uuid := gen_random_uuid();
begin
  -- A worker that crossed the durable send boundary may have reached Meta.
  -- Expiry is therefore ambiguous and must never be reclaimed automatically.
  update public.whatsapp_outbound_deliveries
  set status = 'uncertain', retryable = false, claim_token = null,
      last_error = coalesce(last_error,
        'Delivery worker ended after the Meta send boundary; manual reconciliation is required.'),
      updated_at = now()
  where status = 'sending'
    and lease_expires_at is not null
    and lease_expires_at <= now();

  select d.id into v_id
  from public.whatsapp_outbound_deliveries d
  where (
      d.status in ('pending', 'failed')
      or (d.status = 'processing' and d.lease_expires_at <= now())
    )
    and d.retryable = true
    and d.next_attempt_at <= now()
    and (p_message_id is null or d.message_id = p_message_id)
    and (p_conversation_id is null or d.conversation_id = p_conversation_id)
  order by d.created_at
  for update skip locked
  limit 1;

  if v_id is null then return; end if;

  return query
  update public.whatsapp_outbound_deliveries d
  set status = 'processing', claim_token = v_token, claimed_at = now(),
      lease_expires_at = now() + interval '5 minutes',
      attempt_count = attempt_count + 1, updated_at = now()
  where d.id = v_id
  returning d.*;
end;
$$;

revoke all on function public.claim_whatsapp_outbound_delivery(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.claim_whatsapp_outbound_delivery(uuid, uuid)
  to service_role;

create or replace function public.begin_whatsapp_outbound_send(
  p_delivery_id uuid,
  p_claim_token uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_updated integer;
begin
  update public.whatsapp_outbound_deliveries
  set status = 'sending',
      lease_expires_at = now() + interval '5 minutes',
      updated_at = now()
  where id = p_delivery_id
    and status = 'processing'
    and claim_token = p_claim_token
    and lease_expires_at > now();
  get diagnostics v_updated = row_count;
  return v_updated = 1;
end;
$$;

revoke all on function public.begin_whatsapp_outbound_send(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.begin_whatsapp_outbound_send(uuid, uuid)
  to service_role;

alter table public.automation_executions
  add column if not exists claim_token uuid,
  add column if not exists lease_expires_at timestamptz;

create index if not exists automation_executions_claimable_idx
  on public.automation_executions(lease_expires_at)
  where status in ('pending', 'failed');

create or replace function public.claim_automation_execution(
  p_gym_id uuid,
  p_branch_id uuid,
  p_automation_config_id uuid,
  p_conversation_id uuid,
  p_membership_id uuid,
  p_trigger_key text,
  p_lease_seconds integer default 300
)
returns setof public.automation_executions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_token uuid := gen_random_uuid();
begin
  insert into public.automation_executions (
    gym_id, branch_id, automation_config_id, conversation_id,
    membership_id, trigger_key, status, claim_token, lease_expires_at
  ) values (
    p_gym_id, p_branch_id, p_automation_config_id, p_conversation_id,
    p_membership_id, p_trigger_key, 'pending', v_token,
    now() + make_interval(secs => greatest(30, least(p_lease_seconds, 1800)))
  )
  on conflict (automation_config_id, conversation_id, trigger_key) do update
  set status = 'pending', claim_token = v_token,
      lease_expires_at = now() + make_interval(secs => greatest(30, least(p_lease_seconds, 1800))),
      error_message = null, completed_at = null
  where automation_executions.status in ('pending', 'failed')
    and (
      automation_executions.lease_expires_at is null
      or automation_executions.lease_expires_at <= now()
    )
  returning *;
end;
$$;

revoke all on function public.claim_automation_execution(uuid, uuid, uuid, uuid, uuid, text, integer)
  from public, anon, authenticated;
grant execute on function public.claim_automation_execution(uuid, uuid, uuid, uuid, uuid, text, integer)
  to service_role;

create table if not exists public.rate_limit_buckets (
  bucket_key text not null,
  window_started_at timestamptz not null,
  request_count integer not null check (request_count >= 0),
  updated_at timestamptz not null default now(),
  primary key (bucket_key, window_started_at)
);
create index if not exists rate_limit_buckets_updated_at_idx
  on public.rate_limit_buckets(updated_at);
alter table public.rate_limit_buckets enable row level security;
revoke all on table public.rate_limit_buckets
  from public, anon, authenticated;

create or replace function public.consume_rate_limit(
  p_bucket_key text,
  p_limit integer,
  p_window_seconds integer
)
returns table(allowed boolean, remaining integer, reset_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_window timestamptz;
  v_count integer;
begin
  if p_bucket_key is null or length(p_bucket_key) < 8
     or p_limit < 1 or p_window_seconds < 1 then
    raise exception 'Invalid rate-limit arguments.';
  end if;

  v_window := to_timestamp(
    floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds
  );

  insert into public.rate_limit_buckets(bucket_key, window_started_at, request_count)
  values (p_bucket_key, v_window, 1)
  on conflict (bucket_key, window_started_at) do update
  set request_count = rate_limit_buckets.request_count + 1,
      updated_at = now()
  returning request_count into v_count;

  -- Bounded opportunistic cleanup; every call removes at most 100 stale rows.
  delete from public.rate_limit_buckets
  where ctid in (
    select ctid from public.rate_limit_buckets
    where updated_at < now() - interval '2 days'
    limit 100
  );

  return query select v_count <= p_limit,
    greatest(0, p_limit - v_count),
    v_window + make_interval(secs => p_window_seconds);
end;
$$;

revoke all on function public.consume_rate_limit(text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.consume_rate_limit(text, integer, integer)
  to service_role;

-- Active endpoint records are authoritative. Legacy branch/gym columns are
-- consulted only when no endpoint row (active or inactive) owns the number.
create or replace function public.resolve_whatsapp_endpoint(
  p_phone_number_id text,
  p_display_phone_number text
)
returns table(gym_id uuid, endpoint_id uuid, branch_id uuid)
language sql
security definer
set search_path = public
stable
as $$
  with phone_id_matches as (
    select e.*
    from public.whatsapp_endpoints e
    where p_phone_number_id is not null
      and e.phone_number_id = p_phone_number_id
  ),
  display_phone_matches as (
    select e.*
    from public.whatsapp_endpoints e
    where not exists (select 1 from phone_id_matches)
      and p_display_phone_number is not null
      and regexp_replace(e.phone_number, '\D', '', 'g') =
          regexp_replace(p_display_phone_number, '\D', '', 'g')
  ),
  endpoint_matches as (
    select * from phone_id_matches
    union all
    select * from display_phone_matches
  ),
  active_endpoint as (
    select e.gym_id, e.id as endpoint_id, e.branch_id
    from endpoint_matches e
    where e.is_active = true
    order by (e.phone_number_id = p_phone_number_id) desc
    limit 1
  ),
  legacy_branch as (
    select b.gym_id, null::uuid as endpoint_id, b.id as branch_id
    from public.branches b
    where not exists (select 1 from endpoint_matches)
      and ((p_phone_number_id is not null and b.whatsapp_phone_number_id = p_phone_number_id)
        or (p_display_phone_number is not null and
            regexp_replace(b.whatsapp_number, '\D', '', 'g') =
            regexp_replace(p_display_phone_number, '\D', '', 'g')))
    limit 1
  ),
  legacy_gym as (
    select g.id as gym_id, null::uuid as endpoint_id, null::uuid as branch_id
    from public.gyms g
    where not exists (select 1 from endpoint_matches)
      and not exists (select 1 from legacy_branch)
      and p_display_phone_number is not null
      and regexp_replace(g.whatsapp_number, '\D', '', 'g') =
          regexp_replace(p_display_phone_number, '\D', '', 'g')
    limit 1
  )
  select * from active_endpoint
  union all select * from legacy_branch
  union all select * from legacy_gym;
$$;

revoke all on function public.resolve_whatsapp_endpoint(text, text)
  from public, anon, authenticated;
grant execute on function public.resolve_whatsapp_endpoint(text, text)
  to service_role;
