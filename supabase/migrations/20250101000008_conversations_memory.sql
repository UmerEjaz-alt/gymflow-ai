-- Migration: add customer memory to conversations
-- Description: Stores structured conversation memory for known customer info.

alter table public.conversations
  add column customer_memory jsonb;

alter table public.conversations
  add constraint conversations_customer_memory_is_object
  check (
    customer_memory is null
    or jsonb_typeof(customer_memory) = 'object'
  );
