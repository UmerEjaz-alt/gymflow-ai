import type {
  Trainer,
  CreateTrainerPayload,
  UpdateTrainerPayload,
} from "@/types/trainer";
import { createServerSupabaseClient } from "@/lib/supabase/server";

type ServiceResult<T> = { data: T; error: null } | { data: null; error: string };

/**
 * Returns trainers for the given gym, optionally filtered to a branch.
 * Pass branchId to scope to one branch (AI context, branch settings).
 * Omit branchId to get all trainers across the gym.
 */
export async function getTrainers(
  gymId: string,
  branchId?: string,
): Promise<ServiceResult<Trainer[]>> {
  const supabase = await createServerSupabaseClient();

  let query = supabase
    .from("trainers")
    .select("*")
    .eq("gym_id", gymId)
    .order("full_name", { ascending: true });

  if (branchId) {
    query = query.eq("branch_id", branchId);
  }

  const { data, error } = await query;
  if (error) return { data: null, error: error.message };
  return { data: data as Trainer[], error: null };
}

/**
 * Creates a new trainer for the specified gym and branch.
 */
export async function createTrainer(
  payload: CreateTrainerPayload,
): Promise<ServiceResult<Trainer>> {
  const supabase = await createServerSupabaseClient();

  const { data, error } = await supabase
    .from("trainers")
    .insert(payload)
    .select()
    .single();

  if (error) return { data: null, error: error.message };
  return { data: data as Trainer, error: null };
}

/**
 * Updates an existing trainer by id.
 */
export async function updateTrainer(
  id: string,
  payload: UpdateTrainerPayload,
): Promise<ServiceResult<Trainer>> {
  const supabase = await createServerSupabaseClient();

  const { data, error } = await supabase
    .from("trainers")
    .update(payload)
    .eq("id", id)
    .select()
    .single();

  if (error) return { data: null, error: error.message };
  return { data: data as Trainer, error: null };
}

/**
 * Deletes a trainer by id.
 */
export async function deleteTrainer(id: string): Promise<{ error: string | null }> {
  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.from("trainers").delete().eq("id", id);
  return { error: error?.message ?? null };
}
