-- Migration: create conversations table
-- Description: Stores WhatsApp (and future-channel) conversations per gym.

create table public.conversations (
  id               uuid primary key default gen_random_uuid(),
  gym_id           uuid not null references public.gyms (id) on delete cascade,
  customer_phone   text not null,
  customer_name    text,
  source           text not null default 'whatsapp',
  status           text not null default 'active'
                     check (status in ('active', 'human', 'closed')),
  lead_stage       text not null default 'new_lead'
                     check (lead_stage in ('new_lead', 'qualified', 'trial_booked', 'member', 'lost')),
  last_message_at  timestamptz not null default now(),
  ai_enabled       boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- One phone number per gym (no duplicate conversations for the same contact).
create unique index conversations_gym_id_customer_phone_key
  on public.conversations (gym_id, customer_phone);

-- Fast lookups by gym + recency (drives inbox list ordering).
create index conversations_gym_id_last_message_at_idx
  on public.conversations (gym_id, last_message_at desc);

-- Keep updated_at current on every row change.
-- Reuses the set_updated_at() function created in the gyms migration.
create trigger conversations_set_updated_at
before update on public.conversations
for each row execute procedure public.set_updated_at();

-- Row Level Security
alter table public.conversations enable row level security;

-- Policy: gym owner can read their conversations.
create policy "conversations: gym owner can select"
  on public.conversations
  for select
  to authenticated
  using (
    gym_id in (
      select id from public.gyms where owner_user_id = auth.uid()
    )
  );

-- Policy: gym owner can insert conversations into their gym.
create policy "conversations: gym owner can insert"
  on public.conversations
  for insert
  to authenticated
  with check (
    gym_id in (
      select id from public.gyms where owner_user_id = auth.uid()
    )
  );

-- Policy: gym owner can update their conversations.
create policy "conversations: gym owner can update"
  on public.conversations
  for update
  to authenticated
  using (
    gym_id in (
      select id from public.gyms where owner_user_id = auth.uid()
    )
  )
  with check (
    gym_id in (
      select id from public.gyms where owner_user_id = auth.uid()
    )
  );

-- Policy: gym owner can delete their conversations.
create policy "conversations: gym owner can delete"
  on public.conversations
  for delete
  to authenticated
  using (
    gym_id in (
      select id from public.gyms where owner_user_id = auth.uid()
    )
  );
