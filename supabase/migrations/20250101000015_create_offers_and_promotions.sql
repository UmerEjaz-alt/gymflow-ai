-- Structured, branch-safe commercial offers. Times are stored as absolute
-- instants; time_zone records the owner's local interpretation of form values.
create function public.is_valid_iana_timezone(p_time_zone text)
returns boolean language sql stable as $$
  select exists (select 1 from pg_timezone_names where name = p_time_zone)
$$;

create table public.offers (
  id uuid primary key default gen_random_uuid(),
  gym_id uuid not null references public.gyms(id) on delete cascade,
  branch_id uuid references public.branches(id) on delete restrict,
  name text not null check (btrim(name) <> ''),
  description text,
  offer_type text not null check (offer_type in ('percentage_discount', 'fixed_discount', 'admission_fee_waived', 'special_package_price', 'free_addon')),
  value numeric,
  start_at timestamptz not null,
  end_at timestamptz not null,
  time_zone text not null,
  promotion_mode text not null check (promotion_mode in ('proactive', 'relevant_only', 'asked_only')),
  terms text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint offers_window_valid check (end_at > start_at),
  constraint offers_time_zone_valid check (public.is_valid_iana_timezone(time_zone)),
  constraint offers_value_valid check (
    (offer_type = 'admission_fee_waived' and value is null)
    or (offer_type = 'free_addon' and value is null)
    or (offer_type = 'percentage_discount' and value is not null and value >= 0 and value <= 100)
    or (offer_type = 'fixed_discount' and value is not null and value >= 0)
    or (offer_type = 'special_package_price' and value is not null and value >= 0)
  ),
  unique (id, gym_id)
);

create index offers_active_lookup_idx on public.offers (gym_id, branch_id, start_at, end_at)
  where is_active = true;

create trigger offers_set_updated_at before update on public.offers
for each row execute procedure public.set_updated_at();

alter table public.offers enable row level security;
create policy "offers: gym owner can select" on public.offers for select to authenticated
  using (gym_id in (select id from public.gyms where owner_user_id = auth.uid()));
create policy "offers: gym owner can insert" on public.offers for insert to authenticated
  with check (gym_id in (select id from public.gyms where owner_user_id = auth.uid()));
create policy "offers: gym owner can update" on public.offers for update to authenticated
  using (gym_id in (select id from public.gyms where owner_user_id = auth.uid()))
  with check (gym_id in (select id from public.gyms where owner_user_id = auth.uid()));
create policy "offers: gym owner can delete" on public.offers for delete to authenticated
  using (gym_id in (select id from public.gyms where owner_user_id = auth.uid()));

create function public.enforce_offer_branch_gym_match()
returns trigger language plpgsql as $$
begin
  if new.branch_id is not null and not exists (
    select 1 from public.branches b where b.id = new.branch_id and b.gym_id = new.gym_id
  ) then
    raise exception 'offer branch_id must belong to the offer gym';
  end if;
  return new;
end;
$$;

create trigger offers_branch_gym_match before insert or update on public.offers
for each row execute function public.enforce_offer_branch_gym_match();

create table public.offer_package_targets (
  offer_id uuid not null references public.offers(id) on delete cascade,
  gym_id uuid not null references public.gyms(id) on delete cascade,
  membership_package_id uuid not null references public.membership_packages(id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (offer_id, membership_package_id),
  foreign key (offer_id, gym_id) references public.offers(id, gym_id) on delete cascade
);

create index offer_package_targets_gym_package_idx
  on public.offer_package_targets(gym_id, membership_package_id);

alter table public.offer_package_targets enable row level security;
create policy "offer targets: gym owner can select" on public.offer_package_targets for select to authenticated
  using (gym_id in (select id from public.gyms where owner_user_id = auth.uid()));
create policy "offer targets: gym owner can insert" on public.offer_package_targets for insert to authenticated
  with check (gym_id in (select id from public.gyms where owner_user_id = auth.uid()));
create policy "offer targets: gym owner can delete" on public.offer_package_targets for delete to authenticated
  using (gym_id in (select id from public.gyms where owner_user_id = auth.uid()));

create function public.enforce_offer_package_target_match()
returns trigger language plpgsql as $$
begin
  if not exists (
    select 1
    from public.offers o
    join public.membership_packages p on p.id = new.membership_package_id
    where o.id = new.offer_id
      and o.gym_id = new.gym_id
      and p.gym_id = new.gym_id
      and (o.branch_id is null or p.branch_id = o.branch_id)
  ) then
    raise exception 'offer target package must belong to the offer gym and branch';
  end if;
  return new;
end;
$$;

create trigger offer_package_targets_match before insert or update on public.offer_package_targets
for each row execute function public.enforce_offer_package_target_match();
