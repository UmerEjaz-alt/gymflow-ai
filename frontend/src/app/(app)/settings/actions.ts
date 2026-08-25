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
import type { UpdateBranchPayload } from "@/types/branch";
import type { Facility, CreateFacilityPayload } from "@/types/facility";
import type { MediaAsset, CreateMediaAssetPayload } from "@/types/media-asset";

/** Server Action: saves business-level gym fields (name, email) to the gyms table. */
export async function saveGymProfileAction(
  payload: { gym_name: string; email?: string | null },
): Promise<{ error: string | null }> {
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
  if (facilityId) return updateFacility(facilityId, scopedPayload);
  return createFacility(scopedPayload);
}

export async function deleteFacilityAction(facilityId: string): Promise<{ error: string | null }> {
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

export async function saveMediaAssetAction(
  assetId: string | null,
  payload: CreateMediaAssetPayload,
): Promise<{ data: MediaAsset | null; error: string | null }> {
  const resolved = await resolveActiveBranch();
  if (resolved.error || !resolved.gym || !resolved.branch) {
    return { data: null, error: resolved.error ?? "Active branch not resolved." };
  }
  const scopedPayload: CreateMediaAssetPayload = {
    ...payload,
    gym_id: resolved.gym.id,
    branch_id: resolved.branch.id,
  };
  if (assetId) return updateMediaAsset(assetId, scopedPayload);
  return createMediaAsset(scopedPayload);
}

export async function deleteMediaAssetAction(assetId: string): Promise<{ error: string | null }> {
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
