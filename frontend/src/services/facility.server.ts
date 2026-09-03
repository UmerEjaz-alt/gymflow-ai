import type {
  Facility,
  CreateFacilityPayload,
  UpdateFacilityPayload,
} from "@/types/facility";
import { createServerSupabaseClient } from "@/lib/supabase/server";

type ServiceResult<T> = { data: T; error: null } | { data: null; error: string };

type ServerSupabaseClient = Awaited<ReturnType<typeof createServerSupabaseClient>>;

function normalizeFacilityName(value: string): string {
  return value.trim().toLocaleLowerCase().replace(/\s+/g, " ");
}

async function validateUniqueFacilityName(
  supabase: ServerSupabaseClient,
  input: { gymId: string; branchId: string; name: string; excludingId?: string },
): Promise<string | null> {
  const normalizedName = normalizeFacilityName(input.name);
  if (!normalizedName) return "Facility name is required.";

  const { data, error } = await supabase
    .from("facilities")
    .select("id, name")
    .eq("gym_id", input.gymId)
    .eq("branch_id", input.branchId);
  if (error) return error.message;

  const duplicate = (data ?? []).some(
    (facility) =>
      facility.id !== input.excludingId &&
      normalizeFacilityName(facility.name) === normalizedName,
  );
  return duplicate ? "A facility with this name already exists for this branch." : null;
}

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
  const validationError = await validateUniqueFacilityName(supabase, {
    gymId: payload.gym_id,
    branchId: payload.branch_id,
    name: payload.name,
  });
  if (validationError) return { data: null, error: validationError };

  const { data, error } = await supabase
    .from("facilities")
    .insert({
      ...payload,
      name: payload.name.trim(),
      package_restrictions: payload.package_restrictions ?? [],
    })
    .select()
    .single();

  if (error) {
    return {
      data: null,
      error:
        error.code === "23505"
          ? "A facility with this name already exists for this branch."
          : error.message,
    };
  }
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
  const { data: existing, error: existingError } = await supabase
    .from("facilities")
    .select("gym_id, branch_id, name")
    .eq("id", id)
    .maybeSingle();
  if (existingError) return { data: null, error: existingError.message };
  if (!existing) return { data: null, error: "Facility not found." };

  const validationError = await validateUniqueFacilityName(supabase, {
    gymId: existing.gym_id,
    branchId: payload.branch_id ?? existing.branch_id,
    name: payload.name ?? existing.name,
    excludingId: id,
  });
  if (validationError) return { data: null, error: validationError };

  const { data, error } = await supabase
    .from("facilities")
    .update({
      ...payload,
      ...(payload.name !== undefined ? { name: payload.name.trim() } : {}),
      ...(payload.package_restrictions !== undefined
        ? { package_restrictions: payload.package_restrictions ?? [] }
        : {}),
    })
    .eq("id", id)
    .select()
    .single();

  if (error) {
    return {
      data: null,
      error:
        error.code === "23505"
          ? "A facility with this name already exists for this branch."
          : error.message,
    };
  }
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
