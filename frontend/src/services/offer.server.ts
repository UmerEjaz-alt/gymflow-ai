import { createServerSupabaseClient } from "@/lib/supabase/server";
import {
  calculateOfferPrice,
  getOfferStatus,
  type CreateOfferPayload,
  type GroundedOffer,
  type Offer,
  type UpdateOfferPayload,
} from "@/types/offer";
import type { MembershipPackage } from "@/types/membership-package";

type Result<T> = { data: T; error: null } | { data: null; error: string };
type OfferRow = Omit<Offer, "package_target_ids"> & {
  offer_package_targets?: Array<{ membership_package_id: string }> | null;
};

function normalize(row: OfferRow): Offer {
  return {
    ...row,
    value: row.value === null ? null : Number(row.value),
    package_target_ids: (row.offer_package_targets ?? []).map(
      (target) => target.membership_package_id,
    ),
  };
}

function validateTimeZone(timeZone: string | undefined): string | null {
  if (timeZone === undefined) return null;
  try {
    Intl.DateTimeFormat("en-US", { timeZone });
    return null;
  } catch {
    return "Invalid offer time zone.";
  }
}

export async function getOffers(
  gymId: string,
  branchId?: string,
): Promise<Result<Offer[]>> {
  const supabase = await createServerSupabaseClient();
  let query = supabase
    .from("offers")
    .select(
      "*, offer_package_targets!offer_package_targets_offer_id_fkey(membership_package_id)",
    )
    .eq("gym_id", gymId)
    .order("start_at", { ascending: false });
  if (branchId) query = query.or(`branch_id.is.null,branch_id.eq.${branchId}`);
  const { data, error } = await query;
  if (error) return { data: null, error: error.message };
  return { data: (data ?? []).map((row) => normalize(row as OfferRow)), error: null };
}

export async function getActiveOffers(
  gymId: string,
  branchId: string | null,
  packages: MembershipPackage[],
  branchTimeZone: string | null,
  now = new Date(),
): Promise<Result<GroundedOffer[]>> {
  const supabase = await createServerSupabaseClient();
  let query = supabase
    .from("offers")
    .select(
      "*, offer_package_targets!offer_package_targets_offer_id_fkey(membership_package_id)",
    )
    .eq("gym_id", gymId)
    .eq("is_active", true);
  if (branchId) query = query.or(`branch_id.is.null,branch_id.eq.${branchId}`);
  else query = query.is("branch_id", null);
  const { data, error } = await query;
  if (error) return { data: null, error: error.message };
  const offers = (data ?? [])
    .map((row) => normalize(row as OfferRow))
    .filter(
      (offer) => getOfferStatus(offer, now, branchTimeZone ?? undefined) === "active",
    );
  return { data: resolveOfferConflicts(offers, packages), error: null };
}

/**
 * Deterministic v1 conflict policy. For each package, one price-changing offer
 * wins: branch-specific beats gym-wide, package-targeted beats all-packages,
 * then the oldest active offer wins. A single admission-fee waiver and a
 * single free add-on may coexist with that price offer under the same order.
 */
function resolveOfferConflicts(
  offers: Offer[],
  packages: MembershipPackage[],
): GroundedOffer[] {
  const priceTypes = new Set([
    "percentage_discount",
    "fixed_discount",
    "special_package_price",
  ]);
  const priceWinnerByPackage = new Map<string, string>();
  const winnerIds = new Set<string>();
  for (const pkg of packages) {
    const candidates = offers
      .filter(
        (offer) =>
          priceTypes.has(offer.offer_type) &&
          (offer.package_target_ids.length === 0 ||
            offer.package_target_ids.includes(pkg.id)),
      )
      .sort(compareOfferPriority);
    if (candidates[0]) priceWinnerByPackage.set(pkg.id, candidates[0].id);
  }
  for (const type of ["admission_fee_waived", "free_addon"] as const) {
    const candidate = offers
      .filter((offer) => offer.offer_type === type)
      .sort(compareOfferPriority)[0];
    if (candidate) winnerIds.add(candidate.id);
  }
  for (const offerId of priceWinnerByPackage.values()) winnerIds.add(offerId);
  return offers
    .filter((offer) => winnerIds.has(offer.id))
    .map((offer) => ({
      ...offer,
      eligible_package_names: packages
        .filter(
          (pkg) =>
            offer.package_target_ids.length === 0 ||
            offer.package_target_ids.includes(pkg.id),
        )
        .map((pkg) => pkg.package_name),
      package_prices: packages
        .filter((pkg) => priceWinnerByPackage.get(pkg.id) === offer.id)
        .map((pkg) => calculateOfferPrice(offer, pkg))
        .filter((price): price is NonNullable<typeof price> => price !== null),
    }));
}

function compareOfferPriority(left: Offer, right: Offer): number {
  const leftScope = (left.branch_id ? 2 : 0) + (left.package_target_ids.length ? 1 : 0);
  const rightScope =
    (right.branch_id ? 2 : 0) + (right.package_target_ids.length ? 1 : 0);
  if (leftScope !== rightScope) return rightScope - leftScope;
  const createdDifference =
    new Date(left.created_at).getTime() - new Date(right.created_at).getTime();
  return createdDifference !== 0 ? createdDifference : left.id.localeCompare(right.id);
}

export async function createOffer(payload: CreateOfferPayload): Promise<Result<Offer>> {
  const timeZoneError = validateTimeZone(payload.time_zone);
  if (timeZoneError) return { data: null, error: timeZoneError };
  const supabase = await createServerSupabaseClient();
  const { package_target_ids = [], ...offer } = payload;
  const { data, error } = await supabase.from("offers").insert(offer).select().single();
  if (error) return { data: null, error: error.message };
  if (package_target_ids.length) {
    const { error: targetError } = await supabase
      .from("offer_package_targets")
      .insert(
        package_target_ids.map((membership_package_id) => ({
          offer_id: data.id,
          gym_id: payload.gym_id,
          membership_package_id,
        })),
      );
    if (targetError) return { data: null, error: targetError.message };
  }
  return { data: { ...normalize(data as OfferRow), package_target_ids }, error: null };
}

export async function updateOffer(
  id: string,
  payload: UpdateOfferPayload,
): Promise<Result<Offer>> {
  const timeZoneError = validateTimeZone(payload.time_zone);
  if (timeZoneError) return { data: null, error: timeZoneError };
  const supabase = await createServerSupabaseClient();
  const { package_target_ids, ...offer } = payload;
  const { data, error } = await supabase
    .from("offers")
    .update(offer)
    .eq("id", id)
    .select()
    .single();
  if (error) return { data: null, error: error.message };
  if (package_target_ids !== undefined) {
    const { error: deleteError } = await supabase
      .from("offer_package_targets")
      .delete()
      .eq("offer_id", id);
    if (deleteError) return { data: null, error: deleteError.message };
    if (package_target_ids.length) {
      const { error: targetError } = await supabase
        .from("offer_package_targets")
        .insert(
          package_target_ids.map((membership_package_id) => ({
            offer_id: id,
            gym_id: data.gym_id,
            membership_package_id,
          })),
        );
      if (targetError) return { data: null, error: targetError.message };
    }
  }
  return {
    data: {
      ...normalize(data as OfferRow),
      package_target_ids: package_target_ids ?? [],
    },
    error: null,
  };
}

export async function deleteOffer(id: string): Promise<{ error: string | null }> {
  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.from("offers").delete().eq("id", id);
  return { error: error?.message ?? null };
}

export { getOfferStatus };
