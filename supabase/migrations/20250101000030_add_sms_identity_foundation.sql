-- Additive SMS identity foundation. No provider transport, credentials,
-- webhook processing, or outbound delivery is introduced here.

create table public.sms_endpoints (
  id uuid primary key default gen_random_uuid(),
  gym_id uuid not null references public.gyms(id) on delete cascade,
  branch_id uuid references public.branches(id) on delete set null,
  phone_number text not null,
  provider text not null,
  provider_number_id text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sms_endpoints_phone_number_present
    check (char_length(regexp_replace(phone_number, '\D', '', 'g')) between 7 and 15),
  constraint sms_endpoints_phone_number_format
    check (phone_number ~ '^\+?[0-9() .-]+$'),
  constraint sms_endpoints_provider_format
    check (
      provider = lower(btrim(provider))
      and provider ~ '^[a-z][a-z0-9_-]{0,63}$'
    ),
  constraint sms_endpoints_provider_number_id_present
    check (
      provider_number_id is null
      or (
        provider_number_id = btrim(provider_number_id)
        and provider_number_id <> ''
      )
    )
);

-- An inbound destination number must resolve to exactly one tenant.
create unique index sms_endpoints_normalized_phone_unique
  on public.sms_endpoints(regexp_replace(phone_number, '\D', '', 'g'));

-- Provider identifiers are namespaced by provider because different providers
-- may use overlapping identifier formats.
create unique index sms_endpoints_provider_number_id_unique
  on public.sms_endpoints(provider, provider_number_id)
  where provider_number_id is not null;

create index sms_endpoints_gym_id_idx
  on public.sms_endpoints(gym_id);

create index sms_endpoints_branch_id_idx
  on public.sms_endpoints(branch_id);

create index sms_endpoints_active_gym_branch_idx
  on public.sms_endpoints(gym_id, branch_id)
  where is_active = true;

create trigger sms_endpoints_set_updated_at
  before update on public.sms_endpoints
  for each row execute procedure public.set_updated_at();

create or replace function public.enforce_sms_endpoint_branch_gym_match()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE' and new.gym_id <> old.gym_id then
    raise exception 'SMS endpoint gym_id cannot be changed';
  end if;

  if new.branch_id is not null and not exists (
    select 1
    from public.branches b
    where b.id = new.branch_id
      and b.gym_id = new.gym_id
  ) then
    raise exception 'branch_id must belong to the SMS endpoint gym';
  end if;

  return new;
end;
$$;

create trigger sms_endpoints_branch_gym_match
  before insert or update on public.sms_endpoints
  for each row execute function public.enforce_sms_endpoint_branch_gym_match();

alter table public.sms_endpoints enable row level security;

create policy "sms_endpoints: gym owner can select"
  on public.sms_endpoints
  for select
  to authenticated
  using (
    gym_id in (select id from public.gyms where owner_user_id = auth.uid())
  );

create policy "sms_endpoints: gym owner can insert"
  on public.sms_endpoints
  for insert
  to authenticated
  with check (
    gym_id in (select id from public.gyms where owner_user_id = auth.uid())
  );

create policy "sms_endpoints: gym owner can update"
  on public.sms_endpoints
  for update
  to authenticated
  using (
    gym_id in (select id from public.gyms where owner_user_id = auth.uid())
  )
  with check (
    gym_id in (select id from public.gyms where owner_user_id = auth.uid())
  );

create policy "sms_endpoints: gym owner can delete"
  on public.sms_endpoints
  for delete
  to authenticated
  using (
    gym_id in (select id from public.gyms where owner_user_id = auth.uid())
  );

alter table public.conversations
  add column sms_endpoint_id uuid
  references public.sms_endpoints(id)
  on delete restrict;

alter table public.conversations
  add constraint conversations_sms_endpoint_channel_check
  check (
    (
      sms_endpoint_id is null
      or (source = 'sms' and whatsapp_endpoint_id is null)
    )
    and (source <> 'sms' or whatsapp_endpoint_id is null)
  );

create index conversations_sms_endpoint_id_idx
  on public.conversations(sms_endpoint_id);

-- Endpoint-backed SMS identity is independent per destination number.
create unique index conversations_gym_sms_endpoint_customer_phone_key
  on public.conversations(gym_id, sms_endpoint_id, customer_phone)
  where sms_endpoint_id is not null;

-- The existing null-WhatsApp-endpoint index predates sms_endpoint_id. Narrow
-- it so endpoint-backed SMS rows are governed only by the SMS endpoint index.
-- For all existing rows (sms_endpoint_id is null), behavior is unchanged.
drop index if exists public.conversations_gym_null_endpoint_customer_phone_key;

create unique index conversations_gym_null_endpoint_customer_phone_key
  on public.conversations(gym_id, customer_phone, source)
  where whatsapp_endpoint_id is null and sms_endpoint_id is null;

create or replace function public.enforce_conversation_sms_endpoint_match()
returns trigger
language plpgsql
as $$
begin
  if new.source = 'sms' and new.whatsapp_endpoint_id is not null then
    raise exception 'An SMS conversation cannot use a WhatsApp endpoint';
  end if;

  if new.sms_endpoint_id is null then
    return new;
  end if;

  if new.source <> 'sms' then
    raise exception 'sms_endpoint_id requires source sms';
  end if;

  if new.whatsapp_endpoint_id is not null then
    raise exception 'A conversation cannot use both SMS and WhatsApp endpoints';
  end if;

  if not exists (
    select 1
    from public.sms_endpoints e
    where e.id = new.sms_endpoint_id
      and e.gym_id = new.gym_id
  ) then
    raise exception 'sms_endpoint_id must belong to the conversation gym';
  end if;

  return new;
end;
$$;

create trigger conversations_sms_endpoint_match
  before insert or update on public.conversations
  for each row execute function public.enforce_conversation_sms_endpoint_match();
