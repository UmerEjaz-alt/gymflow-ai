-- Migration: add currency and features columns to membership_packages
-- Description:
--   currency – ISO currency code for the package price (default PKR).
--   features – ordered list of plain-text feature strings (e.g. "Gym Access").

alter table public.membership_packages
  add column if not exists currency text,
  add column if not exists features text[];

-- Explicitly backfill any existing rows that might be NULL
update public.membership_packages
set currency = 'PKR'
where currency is null;

update public.membership_packages
set features = '{}'
where features is null;

-- Now enforce NOT NULL and add constraints
alter table public.membership_packages
  alter column currency set not null,
  alter column currency set default 'PKR',
  drop constraint if exists membership_packages_currency_check,
  add constraint membership_packages_currency_check
      check (currency in ('PKR', 'USD', 'EUR', 'GBP', 'AED')),
  alter column features set not null,
  alter column features set default '{}';
