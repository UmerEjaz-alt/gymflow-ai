import { createServerSupabaseClient } from "@/lib/supabase/server";
import { dateForTimeZone } from "@/lib/member-import";
import { membershipStatus } from "@/lib/membership-lifecycle";
import type { Branch } from "@/types/branch";
import type { Conversation } from "@/types/conversation";

/** A prompt-safe projection: no identifiers, contact details or audit fields. */
export type MemberContext = {
  name: string;
  membership?: {
    branch: string;
    package: string;
    status: "scheduled" | "active" | "expired";
    startDate: string;
    expiryDate: string;
  };
};

export async function loadMemberContext(
  conversation: Conversation,
  branch: Branch | null,
): Promise<MemberContext | null> {
  if (!conversation.member_id) return null;
  const db = await createServerSupabaseClient();
  const { data: member, error } = await db
    .from("members")
    .select("name")
    .eq("id", conversation.member_id)
    .eq("gym_id", conversation.gym_id)
    .maybeSingle();
  if (error || !member?.name?.trim()) return null;
  const identity: MemberContext = { name: member.name };
  // Never infer private membership scope from a single-branch fallback or a
  // temporary branch mentioned by the customer. Only persisted routing counts.
  if (
    !branch ||
    branch.id !== conversation.branch_id ||
    branch.gym_id !== conversation.gym_id ||
    !branch.timezone
  )
    return identity;
  let today: string;
  try {
    today = dateForTimeZone(branch.timezone);
  } catch {
    return identity;
  }
  const query = () =>
    db
      .from("memberships")
      .select(
        "start_date, expiry_date, membership_package:membership_packages!memberships_membership_package_id_fkey(package_name,gym_id,branch_id)",
      )
      .eq("gym_id", conversation.gym_id)
      .eq("member_id", conversation.member_id!)
      .eq("branch_id", branch.id);
  // Same priority as Members: active, nearest scheduled, latest expired.
  // Bounded reads avoid loading a member's full historical periods each turn.
  const results = await Promise.all([
    query().lte("start_date", today).gte("expiry_date", today).limit(2),
    query().gt("start_date", today).order("start_date").limit(2),
    query().lt("expiry_date", today).order("start_date", { ascending: false }).limit(2),
  ]);
  if (results.some((result) => result.error)) return identity;
  const candidates = results.find((result) => result.data?.length)?.data ?? [];
  if (!candidates.length) return identity;
  const period = candidates[0];
  // Historical overlap can predate canonical registration. Do not pick an
  // arbitrary active period, or a tied scheduled/expired period.
  if (
    candidates.length > 1 &&
    (membershipStatus(period, today) === "Active" ||
      candidates[1].start_date === period.start_date)
  )
    return identity;
  const pkg = Array.isArray(period.membership_package)
    ? period.membership_package[0]
    : period.membership_package;
  if (
    !pkg?.package_name ||
    pkg.gym_id !== conversation.gym_id ||
    pkg.branch_id !== branch.id
  )
    return identity;
  return {
    ...identity,
    membership: {
      branch: branch.branch_name,
      package: pkg.package_name,
      status: membershipStatus(period, today).toLowerCase() as
        "scheduled" | "active" | "expired",
      startDate: period.start_date,
      expiryDate: period.expiry_date,
    },
  };
}
