-- ============================================================================
-- Migration: Fix Bookings Branch Foreign Key Ambiguity
-- File: 20250101000020_fix_bookings_branch_fk.sql
-- Description:
--   - Drops the redundant single-column FK `bookings_branch_id_fkey` (branch_id -> branches.id).
--   - Retains the compound tenant-integrity FK `bookings_branch_gym_fk` ((branch_id, gym_id) -> branches(id, gym_id)).
--   - Resolves PostgREST embedding ambiguity when joining `branch:branches(*)`.
--   - Notifies PostgREST to reload schema cache.
-- ============================================================================

-- 1. Drop the redundant single-column FK that causes PostgREST embedding ambiguity
alter table public.bookings
  drop constraint if exists bookings_branch_id_fkey;

-- 2. Ensure the compound tenant-integrity FK is explicitly retained
alter table public.bookings
  drop constraint if exists bookings_branch_gym_fk;

alter table public.bookings
  add constraint bookings_branch_gym_fk
  foreign key (branch_id, gym_id)
  references public.branches(id, gym_id)
  on delete restrict;

-- 3. Notify PostgREST to reload its schema cache
notify pgrst, 'reload schema';
