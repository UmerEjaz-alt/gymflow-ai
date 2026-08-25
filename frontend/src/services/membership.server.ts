import { createServerSupabaseClient } from "@/lib/supabase/server";
import type { Membership } from "@/types/membership";

type Result<T> = { data: T; error: null } | { data: null; error: string };

type MembershipRow = Membership & {
  branch_id?: string | null;
  conversation: Membership["conversation"] | Membership["conversation"][];
  membership_package:
    Membership["membership_package"] | Membership["membership_package"][];
};

function normalize(row: MembershipRow): Membership {
  return {
    ...row,
    branch_id: row.branch_id ?? null,
    conversation: Array.isArray(row.conversation)
      ? row.conversation[0]
      : row.conversation,
    membership_package: Array.isArray(row.membership_package)
      ? row.membership_package[0]
      : row.membership_package,
  };
}

export async function getMemberships(gymId: string, branchId?: string): Promise<Result<Membership[]>> {
  const supabase = await createServerSupabaseClient();
  let query = supabase
    .from("memberships")
    .select(
      "*, conversation:conversations(*), membership_package:membership_packages(*)",
    )
    .eq("gym_id", gymId)
    .order("start_date", { ascending: false });

  if (branchId) {
    query = query.eq("branch_id", branchId);
  }

  const { data, error } = await query;
  if (error) return { data: null, error: error.message };
  return { data: ((data ?? []) as MembershipRow[]).map(normalize), error: null };
}

/** One current/latest membership record per conversation, preserving renewal history. */
export function getLatestMemberships(memberships: Membership[]): Membership[] {
  const latest = new Map<string, Membership>();
  for (const membership of memberships) {
    const existing = latest.get(membership.conversation_id);
    if (!existing || membership.start_date > existing.start_date)
      latest.set(membership.conversation_id, membership);
  }
  return [...latest.values()];
}

export async function convertConversationToMember(input: {
  conversationId: string;
  membershipPackageId: string;
  customerName: string;
  customerPhone: string;
  startDate: string;
}): Promise<Result<Membership>> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc("convert_conversation_to_member", {
    p_conversation_id: input.conversationId,
    p_membership_package_id: input.membershipPackageId,
    p_customer_name: input.customerName,
    p_customer_phone: input.customerPhone,
    p_start_date: input.startDate,
  });
  if (error) return { data: null, error: error.message };
  return { data: data as Membership, error: null };
}
