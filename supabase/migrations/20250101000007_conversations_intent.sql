-- Migration: add intent to conversations
-- Description: Stores the latest classified intent and its confidence score for analytics.

alter table public.conversations
  add column intent text,
  add column intent_confidence numeric(3,2);

-- Since this is a new column and we don't have historical intents stored,
-- existing rows will remain NULL until a new message arrives.
