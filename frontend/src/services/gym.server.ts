import type { Gym, CreateGymPayload, UpdateGymPayload } from "@/types/gym";
import { createServerSupabaseClient } from "@/lib/supabase/server";

type ServiceResult<T> =
  | { data: T; error: null }
  | { data: null; error: string };

/**
 * Returns the gym profile owned by the currently authenticated user,
 * or null when no profile has been created yet.
 */
export async function getGym(): Promise<ServiceResult<Gym | null>> {
  const supabase = await createServerSupabaseClient();

  const { data, error } = await supabase
    .from("gyms")
    .select("*")
    .maybeSingle();

  if (error) {
    return { data: null, error: error.message };
  }

  return { data: data as Gym | null, error: null };
}

/**
 * Returns a gym profile by its id.
 * RLS ensures only the gym owner can retrieve the row.
 */
export async function getGymById(
  gymId: string,
): Promise<ServiceResult<Gym | null>> {
  const supabase = await createServerSupabaseClient();

  const { data, error } = await supabase
    .from("gyms")
    .select("*")
    .eq("id", gymId)
    .maybeSingle();

  if (error) {
    return { data: null, error: error.message };
  }

  return { data: data as Gym | null, error: null };
}

/**
 * Creates a gym profile for the currently authenticated user.
 * Fails if a profile already exists (unique constraint on owner_user_id).
 */
export async function createGym(
  payload: CreateGymPayload,
): Promise<ServiceResult<Gym>> {
  const supabase = await createServerSupabaseClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { data: null, error: "Not authenticated." };
  }

  const { data, error } = await supabase
    .from("gyms")
    .insert({ ...payload, owner_user_id: user.id })
    .select()
    .single();

  if (error) {
    return { data: null, error: error.message };
  }

  return { data: data as Gym, error: null };
}

/**
 * Updates the gym profile owned by the currently authenticated user.
 * Returns the updated row on success.
 */
export async function updateGym(
  payload: UpdateGymPayload,
  gymId?: string,
): Promise<ServiceResult<Gym>> {
  const supabase = await createServerSupabaseClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { data: null, error: "Not authenticated." };
  }

  let query = supabase
    .from("gyms")
    .update(payload)
    .eq("owner_user_id", user.id);

  if (gymId) {
    query = query.eq("id", gymId);
  }

  const { data, error } = await query
    .select()
    .single();

  if (error) {
    return { data: null, error: error.message };
  }

  return { data: data as Gym, error: null };
}

/**
 * Deletes the gym profile owned by the currently authenticated user.
 */
export async function deleteGym(gymId?: string): Promise<{ error: string | null }> {
  const supabase = await createServerSupabaseClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: "Not authenticated." };
  }

  let query = supabase
    .from("gyms")
    .delete()
    .eq("owner_user_id", user.id);

  if (gymId) {
    query = query.eq("id", gymId);
  }

  const { error } = await query;

  return { error: error?.message ?? null };
}
