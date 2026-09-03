-- ============================================================================
-- Public demo requests
-- Submitted only through the trusted server-side marketing endpoint.
-- ============================================================================

create table if not exists public.demo_requests (
  id uuid primary key default gen_random_uuid(),
  full_name text not null check (char_length(full_name) between 2 and 120),
  gym_name text not null check (char_length(gym_name) between 2 and 160),
  email text not null check (char_length(email) between 3 and 254),
  phone text not null check (char_length(phone) between 7 and 40),
  city text not null check (char_length(city) between 2 and 120),
  country text not null check (char_length(country) between 2 and 120),
  message text check (message is null or char_length(message) <= 1000),
  source text not null default 'public_homepage' check (char_length(source) between 1 and 64),
  created_at timestamptz not null default now()
);

create index if not exists demo_requests_created_at_idx
  on public.demo_requests (created_at desc);

alter table public.demo_requests enable row level security;

-- No browser role receives access. The public form writes through the
-- server-only service-role client after validation and abuse checks.
revoke all on table public.demo_requests from anon, authenticated;

