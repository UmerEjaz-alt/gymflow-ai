-- Isolated PostgreSQL test schema. No real credentials/providers are used.
create role anon;
create role authenticated;
create role service_role bypassrls;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;
grant usage on schema public, auth to authenticated, service_role, anon;
grant execute on function auth.uid() to authenticated, service_role;
create table public.gyms(id uuid primary key, owner_user_id uuid not null);
create table public.branches(id uuid primary key, gym_id uuid not null);
create table public.whatsapp_endpoints(id uuid primary key, gym_id uuid not null,
  branch_id uuid, is_active boolean default true, phone_number_id text, created_at timestamptz default now());
create table public.conversations(id uuid primary key default gen_random_uuid(), gym_id uuid not null,
  branch_id uuid, whatsapp_endpoint_id uuid, customer_phone text, customer_name text,
  source text default 'whatsapp', status text default 'active', ai_enabled boolean default true,
  lead_stage text default 'new_lead', ai_lead_at timestamptz, latest_understanding jsonb,
  customer_memory jsonb, last_message_at timestamptz default now(), created_at timestamptz default now(),
  updated_at timestamptz default now());
create table public.messages(id uuid primary key default gen_random_uuid(), conversation_id uuid not null references conversations(id),
  sender_type text not null, message_type text default 'text', content text not null,
  metadata jsonb not null default '{}', whatsapp_message_id text, delivered_at timestamptz, read_at timestamptz,
  created_at timestamptz default now());
create unique index messages_whatsapp_message_id_unique on public.messages(whatsapp_message_id)
  where whatsapp_message_id is not null;
create table public.bookings(id uuid primary key default gen_random_uuid(), gym_id uuid not null, branch_id uuid,
  conversation_id uuid, trainer_id uuid, customer_name text, customer_phone text, booking_type text,
  scheduled_at timestamptz, duration_minutes integer, status text default 'upcoming', source text, notes text,
  cancelled_at timestamptz, completed_at timestamptz, no_show_at timestamptz,
  created_at timestamptz default now(), updated_at timestamptz default now());
create table public.automation_executions(id uuid primary key default gen_random_uuid(), gym_id uuid,
  branch_id uuid, automation_config_id uuid, conversation_id uuid, membership_id uuid,
  trigger_key text, status text default 'pending', sent_message_id uuid, error_message text,
  completed_at timestamptz, created_at timestamptz default now(),
  unique(automation_config_id, conversation_id, trigger_key));
create function public.set_updated_at() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end; $$;
create trigger conversations_set_updated_at before update on conversations
  for each row execute function set_updated_at();
alter table conversations enable row level security;
alter table messages enable row level security;
create policy conversation_owner on conversations to authenticated
  using (gym_id in (select id from gyms where owner_user_id = auth.uid()))
  with check (gym_id in (select id from gyms where owner_user_id = auth.uid()));
create policy message_owner on messages to authenticated
  using (conversation_id in (select id from conversations))
  with check (conversation_id in (select id from conversations));
grant select on gyms, branches, whatsapp_endpoints to authenticated;
grant select, insert, update on conversations, messages, bookings to authenticated;
