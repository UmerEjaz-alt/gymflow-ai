import type { Branch, CreateBranchPayload, UpdateBranchPayload } from "@/types/branch";
import { createServerSupabaseClient } from "@/lib/supabase/server";

type Result<T> = { data: T; error: null } | { data: null; error: string };

/**
 * Returns all branches for the given gym, ordered with default branch first.
 * RLS ensures only the gym owner can retrieve these rows.
 */
export async function getBranches(gymId: string): Promise<Result<Branch[]>> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("branches")
    .select("*")
    .eq("gym_id", gymId)
    .order("is_default", { ascending: false })
    .order("branch_name", { ascending: true });
  if (error) return { data: null, error: error.message };
  return { data: (data ?? []) as Branch[], error: null };
}

/**
 * Returns a single branch by id.
 * RLS ensures only the gym owner can retrieve it.
 */
export async function getBranch(id: string): Promise<Result<Branch | null>> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("branches")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) return { data: null, error: error.message };
  return { data: data as Branch | null, error: null };
}

/**
 * Returns the default branch for a gym, or null if none exists.
 */
export async function getDefaultBranch(gymId: string): Promise<Result<Branch | null>> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("branches")
    .select("*")
    .eq("gym_id", gymId)
    .eq("is_default", true)
    .maybeSingle();
  if (error) return { data: null, error: error.message };
  return { data: data as Branch | null, error: null };
}

/**
 * Creates a new branch for the given gym.
 * RLS ensures the caller must own the target gym.
 */
export async function createBranch(
  payload: CreateBranchPayload,
): Promise<Result<Branch>> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("branches")
    .insert({ ...payload, faqs: payload.faqs ?? [] })
    .select()
    .single();
  if (error) return { data: null, error: error.message };
  return { data: data as Branch, error: null };
}

/**
 * Updates an existing branch.
 * RLS ensures the caller must own the gym this branch belongs to.
 */
export async function updateBranch(
  id: string,
  payload: UpdateBranchPayload,
): Promise<Result<Branch>> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("branches")
    .update(payload)
    .eq("id", id)
    .select()
    .single();
  if (error) return { data: null, error: error.message };
  return { data: data as Branch, error: null };
}

/**
 * Deletes a branch.
 * Blocks deleting default branch or branches with active historical records.
 */
export async function deleteBranch(id: string): Promise<{ error: string | null }> {
  const supabase = await createServerSupabaseClient();
  const { data: branch } = await supabase
    .from("branches")
    .select("is_default")
    .eq("id", id)
    .maybeSingle();

  if (branch?.is_default) {
    return { error: "Cannot delete the default branch of a gym." };
  }

  const { error } = await supabase.from("branches").delete().eq("id", id);
  if (error) {
    if (error.code === "23503") {
      return {
        error:
          "Cannot delete this branch because it contains active memberships, conversations, packages, or operational records. Deactivate or reassign them first.",
      };
    }
    return { error: error.message };
  }
  return { error: null };
}

/**
 * Returns all branch IDs for a given gym.
 * Used by the automation runner to scope automations correctly.
 */
export async function getBranchIds(gymId: string): Promise<Result<string[]>> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("branches")
    .select("id")
    .eq("gym_id", gymId);
  if (error) return { data: null, error: error.message };
  return { data: (data ?? []).map((r) => r.id), error: null };
}

/** Trusted webhook lookup. Maps the destination WhatsApp identity to gym, endpoint, and optional branch. */
export async function resolveWhatsAppBranch(
  phoneNumberId: string | null,
  displayPhone: string | null,
): Promise<Result<{ gymId: string; branchId: string | null; endpointId?: string | null } | null>> {
  const { resolveWhatsAppEndpoint } = await import("@/services/whatsapp-endpoint.server");
  return resolveWhatsAppEndpoint(phoneNumberId, displayPhone);
}

/**
 * Returns all gym IDs in the system.
 * Used by the automation scheduler to iterate every gym.
 * This function uses the system client (service role) — only call from trusted server contexts.
 */
export async function getAllGymIds(): Promise<Result<string[]>> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.from("gyms").select("id");
  if (error) return { data: null, error: error.message };
  return { data: (data ?? []).map((r) => r.id), error: null };
}
