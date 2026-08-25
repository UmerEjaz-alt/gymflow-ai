-- Migration: add latest understanding to conversations
-- Description: Stores the latest AI understanding JSON output per conversation.

alter table public.conversations
  add column latest_understanding jsonb;

alter table public.conversations
  add constraint conversations_latest_understanding_is_object
  check (
    latest_understanding is null
    or jsonb_typeof(latest_understanding) = 'object'
  );
