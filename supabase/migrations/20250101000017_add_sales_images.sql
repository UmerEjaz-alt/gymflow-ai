-- Branch-safe promotional images. Files live in the public gymflow-media bucket;
-- metadata remains tenant and branch scoped in media_assets.
alter table public.media_assets
  add column if not exists featured boolean not null default false,
  add column if not exists trainer_id uuid references public.trainers(id) on delete restrict;

alter table public.media_assets drop constraint if exists media_assets_category_check;
alter table public.media_assets add constraint media_assets_category_check check (
  category in ('gym', 'equipment', 'trainer', 'facility', 'other', 'general_gym', 'cardio', 'strength_area', 'sauna', 'locker_room')
);
alter table public.media_assets add constraint media_assets_featured_valid check (
  not featured or (media_type = 'photo' and trainer_id is null)
);

create unique index if not exists media_assets_one_active_trainer_card
  on public.media_assets(trainer_id) where trainer_id is not null and active;

create or replace function public.enforce_media_asset_trainer_match()
returns trigger language plpgsql as $$
begin
  if new.trainer_id is not null and not exists (
    select 1 from public.trainers t
    where t.id = new.trainer_id and t.gym_id = new.gym_id and t.branch_id = new.branch_id
  ) then raise exception 'media trainer_id must belong to the media gym and branch'; end if;
  return new;
end $$;
create trigger media_assets_trainer_match before insert or update on public.media_assets
for each row execute function public.enforce_media_asset_trainer_match();

create or replace function public.enforce_media_asset_featured_limit()
returns trigger language plpgsql as $$
begin
  if new.featured and new.trainer_id is null then
    perform pg_advisory_xact_lock(hashtextextended(new.branch_id::text, 17));
    if (select count(*) from public.media_assets m where m.branch_id = new.branch_id and m.featured and m.trainer_id is null and m.id <> new.id) >= 3
    then raise exception 'a branch may have at most three featured images'; end if;
  end if;
  return new;
end $$;
create trigger media_assets_featured_limit before insert or update on public.media_assets
for each row execute function public.enforce_media_asset_featured_limit();

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('gymflow-media', 'gymflow-media', true, 5242880, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public = true, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create policy "gymflow media: owner upload" on storage.objects for insert to authenticated with check (
  bucket_id = 'gymflow-media' and exists (select 1 from public.branches b join public.gyms g on g.id = b.gym_id where g.owner_user_id = auth.uid() and b.id::text = (storage.foldername(name))[2] and g.id::text = (storage.foldername(name))[1])
);
create policy "gymflow media: owner update" on storage.objects for update to authenticated using (
  bucket_id = 'gymflow-media' and exists (select 1 from public.branches b join public.gyms g on g.id = b.gym_id where g.owner_user_id = auth.uid() and b.id::text = (storage.foldername(name))[2] and g.id::text = (storage.foldername(name))[1])
);
create policy "gymflow media: owner delete" on storage.objects for delete to authenticated using (
  bucket_id = 'gymflow-media' and exists (select 1 from public.branches b join public.gyms g on g.id = b.gym_id where g.owner_user_id = auth.uid() and b.id::text = (storage.foldername(name))[2] and g.id::text = (storage.foldername(name))[1])
);

-- Atomically makes the new image the trainer's one active card. The old card
-- remains as inactive metadata so historical messages keep their media URL.
create or replace function public.replace_trainer_card(
  p_gym_id uuid, p_branch_id uuid, p_trainer_id uuid, p_title text, p_media_url text
) returns public.media_assets language plpgsql as $$
declare v_asset public.media_assets;
begin
  update public.media_assets set active = false, featured = false
  where gym_id = p_gym_id and branch_id = p_branch_id and trainer_id = p_trainer_id and active;
  insert into public.media_assets (gym_id, branch_id, trainer_id, title, media_type, category, media_url, active, featured)
  values (p_gym_id, p_branch_id, p_trainer_id, p_title, 'photo', 'trainer', p_media_url, true, false)
  returning * into v_asset;
  return v_asset;
end $$;
