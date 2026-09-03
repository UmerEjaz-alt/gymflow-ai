import type {
  MediaAsset,
  CreateMediaAssetPayload,
  UpdateMediaAssetPayload,
} from "@/types/media-asset";
import { createServerSupabaseClient } from "@/lib/supabase/server";

type ServiceResult<T> = { data: T; error: null } | { data: null; error: string };

/**
 * Returns media assets for the given gym, optionally filtered to a branch.
 */
export async function getMediaAssets(
  gymId: string,
  branchId?: string,
): Promise<ServiceResult<MediaAsset[]>> {
  const supabase = await createServerSupabaseClient();

  let query = supabase
    .from("media_assets")
    .select("*")
    .eq("gym_id", gymId)
    .order("created_at", { ascending: false });

  if (branchId) {
    query = query.eq("branch_id", branchId);
  }

  const { data, error } = await query;
  if (error) return { data: null, error: error.message };
  return { data: data as MediaAsset[], error: null };
}

/**
 * Creates a new media asset for the specified gym and branch.
 */
export async function createMediaAsset(
  payload: CreateMediaAssetPayload,
): Promise<ServiceResult<MediaAsset>> {
  const supabase = await createServerSupabaseClient();

  if (payload.trainer_id) {
    const { data, error } = await supabase.rpc("replace_trainer_card", {
      p_gym_id: payload.gym_id,
      p_branch_id: payload.branch_id,
      p_trainer_id: payload.trainer_id,
      p_title: payload.title,
      p_media_url: payload.media_url,
    });
    if (error) return { data: null, error: error.message };
    return { data: data as MediaAsset, error: null };
  }

  const { data, error } = await supabase
    .from("media_assets")
    .insert(payload)
    .select()
    .single();

  if (error) return { data: null, error: error.message };
  return { data: data as MediaAsset, error: null };
}

/**
 * Updates an existing media asset by id.
 */
export async function updateMediaAsset(
  id: string,
  payload: UpdateMediaAssetPayload,
): Promise<ServiceResult<MediaAsset>> {
  const supabase = await createServerSupabaseClient();

  const { data, error } = await supabase
    .from("media_assets")
    .update(payload)
    .eq("id", id)
    .select()
    .single();

  if (error) return { data: null, error: error.message };
  return { data: data as MediaAsset, error: null };
}

/**
 * Deletes a media asset by id.
 */
export async function deleteMediaAsset(id: string): Promise<{ error: string | null }> {
  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.from("media_assets").delete().eq("id", id);
  return { error: error?.message ?? null };
}
