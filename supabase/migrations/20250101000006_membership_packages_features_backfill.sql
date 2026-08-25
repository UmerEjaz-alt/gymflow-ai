-- Migration: backfill membership_packages currency + features columns
-- Description:
--   Idempotent catch-up for databases that pre-date migration 000005.
--   Ensures currency and features columns exist, backfills NULL features to
--   '{}', and enforces NOT NULL + defaults for backward compatibility.

-- currency (from 000005, added here if missing)
do $$
begin
  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'membership_packages'
      and column_name = 'currency'
  ) then
    alter table public.membership_packages
      add column currency text not null default 'PKR'
        constraint membership_packages_currency_check
          check (currency in ('PKR', 'USD', 'EUR', 'GBP', 'AED'));
  end if;
end $$;

-- features
do $$
begin
  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'membership_packages'
      and column_name = 'features'
  ) then
    alter table public.membership_packages
      add column features text[] not null default '{}';
  end if;
end $$;

update public.membership_packages
set features = '{}'
where features is null;

alter table public.membership_packages
  alter column features set default '{}';

alter table public.membership_packages
  alter column features set not null;
