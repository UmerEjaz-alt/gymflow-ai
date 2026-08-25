import type {
  Facility,
  CreateFacilityPayload,
  UpdateFacilityPayload,
} from "@/types/facility";
import { createServerSupabaseClient } from "@/lib/supabase/server";

type ServiceResult<T> =
  | { data: T; error: null }
  | { data: null; error: string };

/**
 * Returns facilities for the given gym, optionally filtered to a branch.
 * Pass branchId to scope to one branch (AI context, branch settings).
 * Omit branchId to get all facilities across the gym.
 */
export async function getFacilities(
  gymId: string,
  branchId?: string,
): Promise<ServiceResult<Facility[]>> {
  const supabase = await createServerSupabaseClient();

  let query = supabase
    .from("facilities")
    .select("*")
    .eq("gym_id", gymId)
    .order("name", { ascending: true });

  if (branchId) {
    query = query.eq("branch_id", branchId);
  }

  const { data, error } = await query;
  if (error) return { data: null, error: error.message };
  return { data: data as Facility[], error: null };
}

/**
 * Creates a new facility for the specified gym and branch.
 */
export async function createFacility(
  payload: CreateFacilityPayload,
): Promise<ServiceResult<Facility>> {
  const supabase = await createServerSupabaseClient();

  const { data, error } = await supabase
    .from("facilities")
    .insert({ ...payload, package_restrictions: payload.package_restrictions ?? [] })
    .select()
    .single();

  if (error) return { data: null, error: error.message };
  return { data: data as Facility, error: null };
}

/**
 * Updates an existing facility by id.
 */
export async function updateFacility(
  id: string,
  payload: UpdateFacilityPayload,
): Promise<ServiceResult<Facility>> {
  const supabase = await createServerSupabaseClient();

  const { data, error } = await supabase
    .from("facilities")
    .update({
      ...payload,
      ...(payload.package_restrictions !== undefined
        ? { package_restrictions: payload.package_restrictions ?? [] }
        : {}),
    })
    .eq("id", id)
    .select()
    .single();

  if (error) return { data: null, error: error.message };
  return { data: data as Facility, error: null };
}

/**
 * Deletes a facility by id.
 */
export async function deleteFacility(id: string): Promise<{ error: string | null }> {
  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.from("facilities").delete().eq("id", id);
  return { error: error?.message ?? null };
}
