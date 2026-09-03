import type { MembershipPackage } from "@/types/membership-package";
import { isoToZonedLocalInput, zonedLocalInputToIso } from "@/lib/zoned-datetime";

export type OfferType =
  | "percentage_discount"
  | "fixed_discount"
  | "admission_fee_waived"
  | "special_package_price"
  | "free_addon";
export type PromotionMode = "proactive" | "relevant_only" | "asked_only";
export type OfferStatus = "scheduled" | "active" | "expired" | "disabled";

export type Offer = {
  id: string;
  gym_id: string;
  branch_id: string | null;
  name: string;
  description: string | null;
  offer_type: OfferType;
  value: number | null;
  start_at: string;
  end_at: string;
  time_zone: string;
  /** New all-branch offers use their wall-clock schedule in each branch timezone. */
  uses_branch_timezone: boolean;
  promotion_mode: PromotionMode;
  terms: string | null;
  is_active: boolean;
  package_target_ids: string[];
  created_at: string;
  updated_at: string;
};

export type CreateOfferPayload = Omit<
  Offer,
  "id" | "created_at" | "updated_at" | "package_target_ids"
> & {
  package_target_ids?: string[];
};
export type UpdateOfferPayload = Partial<Omit<CreateOfferPayload, "gym_id">>;

export type OfferPackagePrice = {
  package_id: string;
  package_name: string;
  currency: MembershipPackage["currency"];
  regular_price: number;
  discount_amount: number;
  final_price: number;
};

export type GroundedOffer = Offer & {
  package_prices: OfferPackagePrice[];
  eligible_package_names: string[];
};

export function getOfferStatus(
  offer: Pick<
    Offer,
    | "is_active"
    | "start_at"
    | "end_at"
    | "branch_id"
    | "time_zone"
    | "uses_branch_timezone"
  >,
  now = new Date(),
  branchTimeZone?: string,
): OfferStatus {
  if (!offer.is_active) return "disabled";
  const window = resolveOfferWindow(offer, branchTimeZone);
  // Active windows are [start_at, end_at): start is inclusive, end is exclusive.
  if (new Date(window.end_at).getTime() <= now.getTime()) return "expired";
  if (new Date(window.start_at).getTime() > now.getTime()) return "scheduled";
  return "active";
}

export function resolveOfferWindow(
  offer: Pick<
    Offer,
    "branch_id" | "start_at" | "end_at" | "time_zone" | "uses_branch_timezone"
  >,
  branchTimeZone?: string,
): { start_at: string; end_at: string } {
  if (offer.uses_branch_timezone && branchTimeZone) {
    const startLocal = isoToZonedLocalInput(offer.start_at, offer.time_zone);
    const endLocal = isoToZonedLocalInput(offer.end_at, offer.time_zone);
    const start_at = zonedLocalInputToIso(startLocal, branchTimeZone);
    const end_at = zonedLocalInputToIso(endLocal, branchTimeZone);
    if (start_at && end_at) return { start_at, end_at };
  }
  return { start_at: offer.start_at, end_at: offer.end_at };
}

export function calculateOfferPrice(
  offer: Offer,
  pkg: MembershipPackage,
): OfferPackagePrice | null {
  if (offer.package_target_ids.length > 0 && !offer.package_target_ids.includes(pkg.id))
    return null;
  if (
    offer.offer_type === "admission_fee_waived" ||
    offer.offer_type === "free_addon"
  ) {
    return null;
  }
  const regular_price = pkg.price;
  let final_price = regular_price;
  if (offer.offer_type === "percentage_discount") {
    final_price = regular_price * (1 - (offer.value ?? 0) / 100);
  } else if (offer.offer_type === "fixed_discount") {
    final_price = regular_price - (offer.value ?? 0);
  } else if (offer.offer_type === "special_package_price") {
    final_price = offer.value ?? regular_price;
  }
  return {
    package_id: pkg.id,
    package_name: pkg.package_name,
    currency: pkg.currency,
    regular_price,
    discount_amount: Math.max(0, regular_price - final_price),
    final_price: Math.max(0, final_price),
  };
}
