import type {
  MembershipPackage,
  CreateMembershipPackagePayload,
  UpdateMembershipPackagePayload,
  PackageCurrency,
} from "@/types/membership-package";
import { createServerSupabaseClient } from "@/lib/supabase/server";

type ServiceResult<T> = { data: T; error: null } | { data: null; error: string };

/** Raw row shape from Supabase before normalization. */
type MembershipPackageRow = {
  id: string;
  gym_id: string;
  branch_id: string;
  package_name: string;
  duration_months: number;
  price: number;
  currency?: PackageCurrency | null;
  features?: string[] | null;
  description: string | null;
  personal_training_included: boolean;
  active: boolean;
  created_at: string;
  updated_at: string;
};

function normalizeMembershipPackage(row: MembershipPackageRow): MembershipPackage {
  return {
    id: row.id,
    gym_id: row.gym_id,
    branch_id: row.branch_id,
    package_name: row.package_name,
    duration_months: row.duration_months,
    price: row.price,
    currency: row.currency ?? "PKR",
    features: Array.isArray(row.features) ? row.features : [],
    description: row.description,
    personal_training_included: row.personal_training_included,
    active: row.active,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function prepareCreatePayload(payload: CreateMembershipPackagePayload) {
  return {
    gym_id: payload.gym_id,
    branch_id: payload.branch_id,
    package_name: payload.package_name,
    duration_months: payload.duration_months,
    price: payload.price,
    currency: payload.currency ?? "PKR",
    features: payload.features ?? [],
    description: payload.description ?? null,
    personal_training_included: payload.personal_training_included ?? false,
    active: payload.active ?? true,
  };
}

function prepareUpdatePayload(payload: UpdateMembershipPackagePayload) {
  const updateData: Record<string, unknown> = {};

  if (payload.branch_id !== undefined) updateData.branch_id = payload.branch_id;
  if (payload.package_name !== undefined)
    updateData.package_name = payload.package_name;
  if (payload.duration_months !== undefined)
    updateData.duration_months = payload.duration_months;
  if (payload.price !== undefined) updateData.price = payload.price;
  if (payload.currency !== undefined) updateData.currency = payload.currency;
  if (payload.features !== undefined) updateData.features = payload.features ?? [];
  if (payload.description !== undefined) updateData.description = payload.description;
  if (payload.personal_training_included !== undefined)
    updateData.personal_training_included = payload.personal_training_included;
  if (payload.active !== undefined) updateData.active = payload.active;

  return updateData;
}

/**
 * Returns membership packages for the given gym, optionally filtered to a branch.
 * Pass branchId to get only that branch's packages (correct for AI context).
 * Omit branchId to get all packages across the gym (correct for settings UI).
 */
export async function getMembershipPackages(
  gymId: string,
  branchId?: string,
): Promise<ServiceResult<MembershipPackage[]>> {
  const supabase = await createServerSupabaseClient();

  let query = supabase
    .from("membership_packages")
    .select("*")
    .eq("gym_id", gymId)
    .order("created_at", { ascending: true });

  if (branchId) {
    query = query.eq("branch_id", branchId);
  }

  const { data, error } = await query;
  if (error) return { data: null, error: error.message };

  return {
    data: ((data ?? []) as MembershipPackageRow[]).map(normalizeMembershipPackage),
    error: null,
  };
}

/**
 * Creates a new membership package for the specified gym and branch.
 */
export async function createMembershipPackage(
  payload: CreateMembershipPackagePayload,
): Promise<ServiceResult<MembershipPackage>> {
  const supabase = await createServerSupabaseClient();

  const { data, error } = await supabase
    .from("membership_packages")
    .insert(prepareCreatePayload(payload))
    .select()
    .single();

  if (error) return { data: null, error: error.message };
  return {
    data: normalizeMembershipPackage(data as MembershipPackageRow),
    error: null,
  };
}

/**
 * Updates an existing membership package by id.
 */
export async function updateMembershipPackage(
  id: string,
  payload: UpdateMembershipPackagePayload,
): Promise<ServiceResult<MembershipPackage>> {
  const supabase = await createServerSupabaseClient();

  const { data, error } = await supabase
    .from("membership_packages")
    .update(prepareUpdatePayload(payload))
    .eq("id", id)
    .select()
    .single();

  if (error) return { data: null, error: error.message };
  return {
    data: normalizeMembershipPackage(data as MembershipPackageRow),
    error: null,
  };
}

/**
 * Deletes a membership package by id.
 */
export async function deleteMembershipPackage(
  id: string,
): Promise<{ error: string | null }> {
  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.from("membership_packages").delete().eq("id", id);
  return { error: error?.message ?? null };
}
