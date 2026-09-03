-- One logical facility name per gym branch. Keep this expression aligned with
-- the server-side facility-name normalization: trim, case-fold, and collapse
-- internal whitespace.

-- Do not silently discard contradictory duplicate records. The known legacy
-- duplicates have identical availability, active state, and restrictions; if
-- another environment contains conflicting records, resolve them explicitly.
do $$
begin
  if exists (
    select 1
    from public.facilities
    group by
      gym_id,
      branch_id,
      lower(btrim(regexp_replace(name, '\s+', ' ', 'g')))
    having count(*) > 1
      and (
        count(distinct available) > 1
        or count(distinct active) > 1
        or count(distinct package_restrictions) > 1
        or count(distinct description) filter (where description is not null) > 1
      )
  ) then
    raise exception
      'Cannot deduplicate facilities with conflicting facility data; resolve the duplicate rows before applying this migration.';
  end if;
end
$$;

-- Preserve a descriptive row when one exists, otherwise keep the earliest
-- record. Repair persisted turn-context metadata before removing duplicates.
with ranked as (
  select
    id,
    first_value(id) over (
      partition by
        gym_id,
        branch_id,
        lower(btrim(regexp_replace(name, '\s+', ' ', 'g')))
      order by (description is null), created_at, id
    ) as canonical_id
  from public.facilities
)
update public.messages as message
set metadata = jsonb_set(
  message.metadata,
  '{turn_context,entity,id}',
  to_jsonb(ranked.canonical_id::text),
  true
)
from ranked
where ranked.id <> ranked.canonical_id
  and message.metadata #>> '{turn_context,entity,id}' = ranked.id::text;

with ranked as (
  select
    id,
    first_value(id) over (
      partition by
        gym_id,
        branch_id,
        lower(btrim(regexp_replace(name, '\s+', ' ', 'g')))
      order by (description is null), created_at, id
    ) as canonical_id
  from public.facilities
)
delete from public.facilities as facility
using ranked
where facility.id = ranked.id
  and ranked.id <> ranked.canonical_id;

create unique index if not exists facilities_gym_branch_normalized_name_key
  on public.facilities (
    gym_id,
    branch_id,
    (lower(btrim(regexp_replace(name, '\s+', ' ', 'g'))))
  );
