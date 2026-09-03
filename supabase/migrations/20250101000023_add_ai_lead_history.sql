-- Historical marker for the existing AI lead progression. Unlike lead_stage,
-- this is never cleared when a lead becomes a member, expires, or renews.
alter table public.conversations
  add column if not exists ai_lead_at timestamptz;

create index if not exists conversations_gym_branch_ai_lead_idx
  on public.conversations(gym_id, branch_id, ai_lead_at)
  where ai_lead_at is not null;

-- Backfill only still-identifiable AI leads. Existing member conversions cannot
-- be attributed safely from mutable lead_stage alone, so they are not guessed.
update public.conversations c
set ai_lead_at = (
  select min(m.created_at)
  from public.messages m
  where m.conversation_id = c.id and m.sender_type = 'ai'
)
where c.ai_lead_at is null
  and c.lead_stage in ('new_lead', 'qualified', 'trial_booked')
  and exists (
    select 1 from public.messages m
    where m.conversation_id = c.id and m.sender_type = 'ai'
  );
