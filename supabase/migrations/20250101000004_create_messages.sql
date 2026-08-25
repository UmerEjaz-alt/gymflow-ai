-- Migration: create messages table
-- Description: Stores individual messages within a conversation thread.

create table public.messages (
  id                   uuid primary key default gen_random_uuid(),
  conversation_id      uuid not null references public.conversations (id) on delete cascade,
  sender_type          text not null
                         check (sender_type in ('customer', 'ai', 'human', 'system')),
  message_type         text not null default 'text'
                         check (message_type in ('text', 'image', 'audio', 'video', 'document', 'location', 'interactive', 'system')),
  whatsapp_message_id  text,
  content              text not null,
  metadata             jsonb not null default '{}',
  delivered_at         timestamptz,
  read_at              timestamptz,
  created_at           timestamptz not null default now()
);

-- Fast chronological retrieval of messages within a conversation.
create index messages_conversation_id_created_at_idx
  on public.messages (conversation_id, created_at asc);

-- Prevent duplicate ingestion of the same WhatsApp message.
-- The partial index excludes null values so only real IDs must be unique.
create unique index messages_whatsapp_message_id_unique
  on public.messages (whatsapp_message_id)
  where whatsapp_message_id is not null;

-- Row Level Security
alter table public.messages enable row level security;

-- RLS policies join through conversations → gyms so access is always scoped
-- to the gym owner, matching the pattern used on all other tables.

-- Policy: gym owner can read messages in their conversations.
create policy "messages: gym owner can select"
  on public.messages
  for select
  to authenticated
  using (
    conversation_id in (
      select c.id
      from public.conversations c
      join public.gyms g on g.id = c.gym_id
      where g.owner_user_id = auth.uid()
    )
  );

-- Policy: gym owner can insert messages into their conversations.
create policy "messages: gym owner can insert"
  on public.messages
  for insert
  to authenticated
  with check (
    conversation_id in (
      select c.id
      from public.conversations c
      join public.gyms g on g.id = c.gym_id
      where g.owner_user_id = auth.uid()
    )
  );

-- Policy: gym owner can update messages in their conversations.
create policy "messages: gym owner can update"
  on public.messages
  for update
  to authenticated
  using (
    conversation_id in (
      select c.id
      from public.conversations c
      join public.gyms g on g.id = c.gym_id
      where g.owner_user_id = auth.uid()
    )
  )
  with check (
    conversation_id in (
      select c.id
      from public.conversations c
      join public.gyms g on g.id = c.gym_id
      where g.owner_user_id = auth.uid()
    )
  );

-- Policy: gym owner can delete messages in their conversations.
create policy "messages: gym owner can delete"
  on public.messages
  for delete
  to authenticated
  using (
    conversation_id in (
      select c.id
      from public.conversations c
      join public.gyms g on g.id = c.gym_id
      where g.owner_user_id = auth.uid()
    )
  );
