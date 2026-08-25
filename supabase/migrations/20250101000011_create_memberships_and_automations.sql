-- Memberships remain attached to the original conversation/customer identity.
create table public.memberships (
  id                    uuid primary key default gen_random_uuid(),
  gym_id                uuid not null references public.gyms (id) on delete cascade,
  conversation_id       uuid not null references public.conversations (id) on delete cascade,
  membership_package_id uuid not null references public.membership_packages (id) on delete restrict,
  start_date            date not null,
  expiry_date           date not null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  check (expiry_date > start_date)
);

create index memberships_gym_id_expiry_date_idx on public.memberships (gym_id, expiry_date);
create index memberships_conversation_id_start_date_idx on public.memberships (conversation_id, start_date desc);

create trigger memberships_set_updated_at before update on public.memberships
for each row execute procedure public.set_updated_at();

alter table public.memberships enable row level security;
create policy "memberships: gym owner can select" on public.memberships for select to authenticated using (gym_id in (select id from public.gyms where owner_user_id = auth.uid()));
create policy "memberships: gym owner can insert" on public.memberships for insert to authenticated with check (gym_id in (select id from public.gyms where owner_user_id = auth.uid()));
create policy "memberships: gym owner can update" on public.memberships for update to authenticated using (gym_id in (select id from public.gyms where owner_user_id = auth.uid())) with check (gym_id in (select id from public.gyms where owner_user_id = auth.uid()));

-- Atomically updates the existing customer conversation and records its membership.
create or replace function public.convert_conversation_to_member(
  p_conversation_id uuid,
  p_membership_package_id uuid,
  p_customer_name text,
  p_customer_phone text,
  p_start_date date
) returns public.memberships
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_conversation public.conversations;
  v_package public.membership_packages;
  v_membership public.memberships;
begin
  select * into v_conversation from public.conversations where id = p_conversation_id for update;
  if not found or not exists (select 1 from public.gyms where id = v_conversation.gym_id and owner_user_id = auth.uid()) then
    raise exception 'Conversation not found.';
  end if;
  select * into v_package from public.membership_packages where id = p_membership_package_id and gym_id = v_conversation.gym_id and active = true;
  if not found then raise exception 'Membership package not found or inactive.'; end if;
  if p_customer_name is null or btrim(p_customer_name) = '' or p_customer_phone is null or btrim(p_customer_phone) = '' then
    raise exception 'Name and phone are required.';
  end if;

  update public.conversations
  set customer_name = btrim(p_customer_name), customer_phone = btrim(p_customer_phone), lead_stage = 'member'
  where id = v_conversation.id;

  insert into public.memberships (gym_id, conversation_id, membership_package_id, start_date, expiry_date)
  values (v_conversation.gym_id, v_conversation.id, v_package.id, p_start_date, (p_start_date + make_interval(months => v_package.duration_months))::date)
  returning * into v_membership;
  return v_membership;
end;
$$;

create table public.automation_configs (
  id               uuid primary key default gen_random_uuid(),
  gym_id           uuid not null references public.gyms (id) on delete cascade,
  automation_type  text not null check (automation_type in ('membership_expiry_reminder', 'expired_membership_follow_up', 'member_check_in', 'lead_follow_up')),
  enabled          boolean not null default false,
  delay_days       integer not null check (delay_days >= 0 and delay_days <= 365),
  max_follow_ups   integer not null default 1 check (max_follow_ups >= 1 and max_follow_ups <= 10),
  quiet_hours_start time,
  quiet_hours_end   time,
  auto_send         boolean not null default false,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (gym_id, automation_type)
);

create trigger automation_configs_set_updated_at before update on public.automation_configs
for each row execute procedure public.set_updated_at();
alter table public.automation_configs enable row level security;
create policy "automation_configs: gym owner can select" on public.automation_configs for select to authenticated using (gym_id in (select id from public.gyms where owner_user_id = auth.uid()));
create policy "automation_configs: gym owner can insert" on public.automation_configs for insert to authenticated with check (gym_id in (select id from public.gyms where owner_user_id = auth.uid()));
create policy "automation_configs: gym owner can update" on public.automation_configs for update to authenticated using (gym_id in (select id from public.gyms where owner_user_id = auth.uid())) with check (gym_id in (select id from public.gyms where owner_user_id = auth.uid()));

create table public.automation_executions (
  id                   uuid primary key default gen_random_uuid(),
  gym_id               uuid not null references public.gyms (id) on delete cascade,
  automation_config_id uuid not null references public.automation_configs (id) on delete cascade,
  conversation_id      uuid not null references public.conversations (id) on delete cascade,
  membership_id        uuid references public.memberships (id) on delete set null,
  trigger_key          text not null,
  status               text not null check (status in ('pending', 'sent', 'skipped', 'failed')),
  error_message        text,
  sent_message_id      uuid references public.messages (id) on delete set null,
  created_at           timestamptz not null default now(),
  completed_at         timestamptz,
  unique (automation_config_id, conversation_id, trigger_key)
);

create index automation_executions_gym_id_created_at_idx on public.automation_executions (gym_id, created_at desc);
alter table public.automation_executions enable row level security;
create policy "automation_executions: gym owner can select" on public.automation_executions for select to authenticated using (gym_id in (select id from public.gyms where owner_user_id = auth.uid()));
create policy "automation_executions: gym owner can insert" on public.automation_executions for insert to authenticated with check (gym_id in (select id from public.gyms where owner_user_id = auth.uid()));
create policy "automation_executions: gym owner can update" on public.automation_executions for update to authenticated using (gym_id in (select id from public.gyms where owner_user_id = auth.uid())) with check (gym_id in (select id from public.gyms where owner_user_id = auth.uid()));
