-- ============================================================================
-- Booking action idempotency
-- One persisted inbound customer message may claim at most one booking mutation.
-- ============================================================================

create table if not exists public.booking_action_executions (
  id uuid primary key default gen_random_uuid(),
  gym_id uuid not null references public.gyms(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  source_message_id uuid not null references public.messages(id) on delete restrict,
  action_type text not null check (action_type in ('create', 'reschedule', 'cancel')),
  booking_id uuid references public.bookings(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (source_message_id)
);

create index if not exists booking_action_executions_gym_conversation_idx
  on public.booking_action_executions (gym_id, conversation_id);

create or replace function public.enforce_booking_action_execution_integrity()
returns trigger
language plpgsql
as $$
begin
  if not exists (
    select 1 from public.conversations c
    where c.id = new.conversation_id and c.gym_id = new.gym_id
  ) then
    raise exception 'conversation_id must belong to the booking action gym';
  end if;

  if not exists (
    select 1
    from public.messages m
    join public.conversations c on c.id = m.conversation_id
    where m.id = new.source_message_id
      and c.id = new.conversation_id
      and c.gym_id = new.gym_id
      and m.sender_type = 'customer'
  ) then
    raise exception 'source_message_id must be a customer message in the same conversation and gym';
  end if;

  return new;
end;
$$;

drop trigger if exists booking_action_executions_resource_integrity
  on public.booking_action_executions;

create trigger booking_action_executions_resource_integrity
  before insert or update on public.booking_action_executions
  for each row
  execute function public.enforce_booking_action_execution_integrity();

alter table public.booking_action_executions enable row level security;

drop policy if exists "booking action executions: gym owner can select"
  on public.booking_action_executions;

create policy "booking action executions: gym owner can select"
  on public.booking_action_executions
  for select
  to authenticated
  using (
    gym_id in (select id from public.gyms where owner_user_id = auth.uid())
  );

drop policy if exists "booking action executions: gym owner can insert"
  on public.booking_action_executions;

create policy "booking action executions: gym owner can insert"
  on public.booking_action_executions
  for insert
  to authenticated
  with check (
    gym_id in (select id from public.gyms where owner_user_id = auth.uid())
  );

drop policy if exists "booking action executions: gym owner can update"
  on public.booking_action_executions;

create policy "booking action executions: gym owner can update"
  on public.booking_action_executions
  for update
  to authenticated
  using (
    gym_id in (select id from public.gyms where owner_user_id = auth.uid())
  )
  with check (
    gym_id in (select id from public.gyms where owner_user_id = auth.uid())
  );
