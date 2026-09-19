"use server";

import { revalidatePath } from "next/cache";
import { updateGym, createGym, getGym } from "@/services/gym.server";
import { updateBranch } from "@/services/branch.server";
import {
  getFacilities,
  createFacility,
  updateFacility,
  deleteFacility,
} from "@/services/facility.server";
import {
  getMediaAssets,
  createMediaAsset,
  updateMediaAsset,
  deleteMediaAsset,
} from "@/services/media-asset.server";
import { resolveActiveBranch } from "@/lib/active-branch.server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { validateWhatsAppImageUpload } from "@/lib/whatsapp-media-upload";
import type { UpdateBranchPayload } from "@/types/branch";
import type { Facility, CreateFacilityPayload } from "@/types/facility";
import type { MediaAsset, CreateMediaAssetPayload } from "@/types/media-asset";

/** Server Action: saves business-level gym fields (name, email) to the gyms table. */
export async function saveGymProfileAction(payload: {
  gym_name: string;
  email?: string | null;
}): Promise<{ error: string | null }> {
  const { data: existing } = await getGym();
  if (existing) {
    const { error } = await updateGym({
      gym_name: payload.gym_name.trim(),
      email: payload.email?.trim() || null,
    });
    if (error) return { error };
    revalidatePath("/settings");
    revalidatePath("/", "layout");
    return { error: null };
  }

  const gymName = payload.gym_name.trim();
  if (!gymName) return { error: "Gym name is required." };
  const { error } = await createGym({
    gym_name: gymName,
    email: payload.email?.trim() || null,
  });
  if (error) return { error };
  revalidatePath("/", "layout");
  return { error: null };
}

/** Saves a gym-wide logo URL after verifying the uploaded object belongs to the active gym and branch. */
export async function saveGymLogoAction(
  storagePath: string | null,
): Promise<{ data: string | null; error: string | null }> {
  const resolved = await resolveActiveBranch();
  if (resolved.error || !resolved.gym) {
    return { data: null, error: resolved.error ?? "Gym not found." };
  }

  if (storagePath === null) {
    const { error } = await updateGym({ logo_url: null }, resolved.gym.id);
    if (!error) {
      revalidatePath("/settings");
      revalidatePath("/", "layout");
    }
    return { data: null, error };
  }

  if (!resolved.branch) {
    return { data: null, error: "Select a branch before uploading a logo." };
  }

  const prefix = `${resolved.gym.id}/${resolved.branch.id}/logos/`;
  const filename = storagePath.startsWith(prefix)
    ? storagePath.slice(prefix.length)
    : "";
  if (!/^[0-9a-f-]{36}\.(?:jpe?g|png|webp)$/i.test(filename)) {
    return { data: null, error: "Invalid logo upload path." };
  }

  const supabase = await createServerSupabaseClient();
  const logoUrl = supabase.storage.from("gymflow-media").getPublicUrl(storagePath)
    .data.publicUrl;
  const { error } = await updateGym({ logo_url: logoUrl }, resolved.gym.id);
  if (!error) {
    revalidatePath("/settings");
    revalidatePath("/", "layout");
  }
  return { data: error ? null : logoUrl, error };
}

/** Server Action: saves branch-specific fields (address, hours, policies, etc.) to the branches table. */
export async function saveBranchProfileAction(
  branchId: string,
  payload: UpdateBranchPayload,
): Promise<{ error: string | null }> {
  const resolved = await resolveActiveBranch();
  if (resolved.error || !resolved.gym) {
    return { error: resolved.error ?? "Gym not found." };
  }
  const ownsBranch = resolved.branches.some((b) => b.id === branchId);
  if (!ownsBranch) {
    return { error: "Branch not found." };
  }
  const { error } = await updateBranch(branchId, payload);
  if (!error) {
    revalidatePath("/settings");
    revalidatePath("/", "layout");
  }
  return { error };
}

export async function saveFacilityAction(
  facilityId: string | null,
  payload: CreateFacilityPayload,
): Promise<{ data: Facility | null; error: string | null }> {
  const resolved = await resolveActiveBranch();
  if (resolved.error || !resolved.gym || !resolved.branch) {
    return { data: null, error: resolved.error ?? "Active branch not resolved." };
  }
  const scopedPayload: CreateFacilityPayload = {
    ...payload,
    gym_id: resolved.gym.id,
    branch_id: resolved.branch.id,
  };
  if (facilityId) {
    const existing = await getFacilities(resolved.gym.id, resolved.branch.id);
    if (existing.error) return { data: null, error: existing.error };
    if (!existing.data?.some((facility) => facility.id === facilityId)) {
      return { data: null, error: "Facility not found." };
    }
    return updateFacility(facilityId, scopedPayload);
  }
  return createFacility(scopedPayload);
}

export async function deleteFacilityAction(
  facilityId: string,
): Promise<{ error: string | null }> {
  const resolved = await resolveActiveBranch();
  if (resolved.error || !resolved.gym || !resolved.branch) {
    return { error: resolved.error ?? "Active branch not resolved." };
  }
  const existing = await getFacilities(resolved.gym.id, resolved.branch.id);
  if (existing.error) return { error: existing.error };
  const owns = existing.data?.some((f) => f.id === facilityId);
  if (!owns) return { error: "Facility not found." };
  return deleteFacility(facilityId);
}

export async function uploadMediaAssetAction(
  formData: FormData,
): Promise<{ data: MediaAsset | null; error: string | null }> {
  const resolved = await resolveActiveBranch();
  if (resolved.error || !resolved.gym || !resolved.branch) {
    return { data: null, error: resolved.error ?? "Active branch not resolved." };
  }

  const file = formData.get("file");
  const title = String(formData.get("title") ?? "").trim();
  const requestedCategory = String(formData.get("category") ?? "");
  const trainerId = String(formData.get("trainerId") ?? "").trim() || null;
  const allowedCategories = new Set([
    "general_gym",
    "cardio",
    "strength_area",
    "sauna",
    "locker_room",
    "other",
  ]);
  if (!(file instanceof File) || !title) {
    return { data: null, error: "Choose an image and add a title." };
  }
  if (!trainerId && !allowedCategories.has(requestedCategory)) {
    return { data: null, error: "Invalid media category." };
  }

  const validated = await validateWhatsAppImageUpload(file);
  if (validated.error || !validated.data) {
    return { data: null, error: validated.error };
  }

  const supabase = await createServerSupabaseClient();
  const storagePath = `${resolved.gym.id}/${resolved.branch.id}/${crypto.randomUUID()}.${validated.data.extension}`;
  const uploaded = await supabase.storage
    .from("gymflow-media")
    .upload(storagePath, file, {
      contentType: validated.data.mimeType,
      upsert: false,
    });
  if (uploaded.error) return { data: null, error: uploaded.error.message };

  const mediaUrl = supabase.storage.from("gymflow-media").getPublicUrl(storagePath)
    .data.publicUrl;
  const scopedPayload: CreateMediaAssetPayload = {
    gym_id: resolved.gym.id,
    branch_id: resolved.branch.id,
    title,
    media_type: "photo",
    category: trainerId
      ? "trainer"
      : (requestedCategory as CreateMediaAssetPayload["category"]),
    media_url: mediaUrl,
    active: true,
    featured: trainerId ? false : formData.get("featured") === "true",
    trainer_id: trainerId,
  };

  const saved = await createMediaAsset(scopedPayload);
  if (saved.error) {
    await supabase.storage.from("gymflow-media").remove([storagePath]);
    return saved;
  }
  revalidatePath("/settings/media");
  return saved;
}

export async function archiveMediaAssetAction(
  assetId: string,
): Promise<{ error: string | null }> {
  const resolved = await resolveActiveBranch();
  if (resolved.error || !resolved.gym || !resolved.branch)
    return { error: resolved.error ?? "Active branch not resolved." };
  const existing = await getMediaAssets(resolved.gym.id, resolved.branch.id);
  if (!existing.data?.some((asset) => asset.id === assetId))
    return { error: "Media asset not found." };
  const result = await updateMediaAsset(assetId, { active: false, featured: false });
  return { error: result.error };
}

export async function deleteMediaAssetAction(
  assetId: string,
): Promise<{ error: string | null }> {
  const resolved = await resolveActiveBranch();
  if (resolved.error || !resolved.gym || !resolved.branch) {
    return { error: resolved.error ?? "Active branch not resolved." };
  }
  const existing = await getMediaAssets(resolved.gym.id, resolved.branch.id);
  if (existing.error) return { error: existing.error };
  const owns = existing.data?.some((m) => m.id === assetId);
  if (!owns) return { error: "Media asset not found." };
  return deleteMediaAsset(assetId);
}
