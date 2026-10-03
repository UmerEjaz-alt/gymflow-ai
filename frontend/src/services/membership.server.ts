import { createServerSupabaseClient } from "@/lib/supabase/server";
import {
  dateForTimeZone,
  normalizeImportName,
  parseImportDate,
} from "@/lib/member-import";
import { normalizePhoneNumber } from "@/lib/phone-number";
import type { Branch } from "@/types/branch";
import { getMembershipPackages } from "@/services/membership-package.server";
import type { Membership } from "@/types/membership";
import type { Member, RegisterMemberInput } from "@/types/member";
import { selectMemberships } from "@/lib/membership-lifecycle";
import { getActiveScopeConversationHistory } from "@/services/conversation-history.server";
import type { Message } from "@/types/message";

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
    member: Array.isArray(row.member) ? row.member[0] : row.member,
    conversation: Array.isArray(row.conversation)
      ? row.conversation[0]
      : row.conversation,
    membership_package: Array.isArray(row.membership_package)
      ? row.membership_package[0]
      : row.membership_package,
  };
}

export async function getMemberships(
  gymId: string,
  branchId?: string,
): Promise<Result<Membership[]>> {
  const supabase = await createServerSupabaseClient();
  let query = supabase
    .from("memberships")
    .select(
      "*, member:members(*), conversation:conversations(*), membership_package:membership_packages(*)",
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

/** One current period per canonical member/branch; callers provide branch-local today. */
export function getLatestMemberships(
  memberships: Membership[],
  today = dateForTimeZone("UTC"),
): Membership[] {
  return selectMemberships(memberships, today);
}

export type Registration = {
  member: Member;
  membership: Membership;
  replayed: boolean;
};

/** All creation entry points converge here and on one database transaction. */
export async function registerMember(
  input: RegisterMemberInput,
  branch: Branch,
  source: "manual" | "import" | "lead_conversion" = "manual",
  conversationId?: string,
): Promise<Result<Registration>> {
  if (
    !input ||
    typeof input.name !== "string" ||
    typeof input.phone !== "string" ||
    typeof input.requestId !== "string" ||
    typeof input.startDate !== "string" ||
    (input.expiryDate !== undefined && typeof input.expiryDate !== "string") ||
    (input.email !== undefined && typeof input.email !== "string")
  )
    return { data: null, error: "Invalid member registration details." };
  if (input.branchId !== branch.id)
    return { data: null, error: "The selected branch changed. Reopen the form." };
  const phone = normalizePhoneNumber(input.phone, branch.country_code);
  if (!phone.e164) return { data: null, error: phone.error! };
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      input.requestId,
    )
  )
    return { data: null, error: "A valid registration request ID is required." };
  const start = parseImportDate(input.startDate);
  const end = parseImportDate(input.expiryDate ?? "");
  if (!start.value || start.error || end.error)
    return { data: null, error: start.error ?? end.error ?? "Start date is required." };
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc("register_member_membership", {
    p_request_id: input.requestId,
    p_branch_id: branch.id,
    p_name: input.name,
    p_phone_e164: phone.e164,
    p_email: input.email?.trim() || null,
    p_package_id: input.packageId,
    p_start_date: start.value,
    p_expiry_date: end.value,
    p_source: source,
    p_existing_member_id: input.existingMemberId ?? null,
    p_conversation_id: conversationId ?? null,
  });
  return error
    ? { data: null, error: error.message }
    : { data: data as Registration, error: null };
}

export async function findMemberByPhone(
  phone: string,
  branch: Branch,
): Promise<Result<Member | null>> {
  if (typeof phone !== "string") return { data: null, error: "Phone is required." };
  const normalized = normalizePhoneNumber(phone, branch.country_code);
  if (!normalized.e164) return { data: null, error: normalized.error! };
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("members")
    .select("*")
    .eq("gym_id", branch.gym_id)
    .eq("phone_e164", normalized.e164)
    .maybeSingle();
  return error
    ? { data: null, error: error.message }
    : { data: data as Member | null, error: null };
}

/** Gym-owned full period history; the active branch still controls the list. */
export async function getMemberHistory(
  memberId: string,
  gymId: string,
): Promise<Result<Membership[]>> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("memberships")
    .select(
      "*, member:members(*), conversation:conversations(*), membership_package:membership_packages(*), branch:branches(branch_name)",
    )
    .eq("gym_id", gymId)
    .eq("member_id", memberId)
    .order("start_date", { ascending: false });
  return error
    ? { data: null, error: error.message }
    : { data: ((data ?? []) as MembershipRow[]).map(normalize), error: null };
}

/** Conversation linkage is canonical on conversations, not period provenance. */
export async function getMemberConversationHistory(
  memberId: string,
  branch: Branch,
): Promise<Result<Message[]>> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("conversations")
    .select("id")
    .eq("gym_id", branch.gym_id)
    .eq("branch_id", branch.id)
    .eq("member_id", memberId)
    .order("last_message_at", { ascending: false })
    .order("id")
    .limit(1)
    .maybeSingle();
  if (error) return { data: null, error: error.message };
  if (!data) return { data: [], error: null };
  const result = await getActiveScopeConversationHistory(data.id);
  return result.error
    ? { data: null, error: result.error }
    : { data: result.data ?? [], error: null };
}

export async function convertConversationToMember(input: {
  conversationId: string;
  membershipPackageId: string;
  customerName: string;
  customerPhone: string;
  startDate: string;
  requestId: string;
}): Promise<Result<Membership>> {
  const supabase = await createServerSupabaseClient();
  const { data: conversation, error } = await supabase
    .from("conversations")
    .select("branch_id, source, customer_phone")
    .eq("id", input.conversationId)
    .maybeSingle();
  if (error || !conversation?.branch_id)
    return { data: null, error: error?.message ?? "Conversation branch not found." };
  const { data: branch } = await supabase
    .from("branches")
    .select("*")
    .eq("id", conversation.branch_id)
    .maybeSingle();
  if (!branch) return { data: null, error: "Conversation branch not found." };
  // The browser cannot replace the transport identity. Normalize for comparison only.
  const authoritative =
    conversation.source === "whatsapp" && /^\d+$/.test(conversation.customer_phone)
      ? `+${conversation.customer_phone}`
      : conversation.customer_phone;
  const phone = normalizePhoneNumber(authoritative, branch.country_code);
  const provided = normalizePhoneNumber(
    conversation.source === "whatsapp" && /^\d+$/.test(input.customerPhone.trim())
      ? `+${input.customerPhone.trim()}`
      : input.customerPhone,
    branch.country_code,
  );
  if (!phone.e164 || provided.e164 !== phone.e164)
    return { data: null, error: "Phone must match this conversation." };
  const result = await registerMember(
    {
      requestId: input.requestId,
      branchId: branch.id,
      name: input.customerName,
      phone: phone.e164,
      packageId: input.membershipPackageId,
      startDate: input.startDate,
    },
    branch as Branch,
    "lead_conversion",
    input.conversationId,
  );
  return result.error
    ? { data: null, error: result.error }
    : { data: result.data!.membership, error: null };
}

export type MemberImportInput = {
  rowNumber: number;
  requestId: string;
  name: string;
  phone: string;
  packageName: string;
  startDate?: string;
  expiryDate?: string;
};

export type MemberImportRowError = { rowNumber: number; error: string };
export type MemberImportResult = {
  imported_count: number;
  duplicate_count: number;
  failed_count: number;
  row_errors: MemberImportRowError[];
};

type ValidImportRow = {
  rowNumber: number;
  requestId: string;
  name: string;
  phone: string;
  packageId: string;
  startDate: string;
  expiryDate: string | null;
};

/**
 * Revalidates and imports a bounded batch into one already-authorized branch.
 * The canonical RPC atomically registers member identity and the period.
 */
export async function importMembersToBranch(
  gymId: string,
  branch: Branch,
  rows: MemberImportInput[],
): Promise<Result<MemberImportResult>> {
  if (!Array.isArray(rows)) return { data: null, error: "Invalid import rows." };
  if (rows.length === 0) {
    return {
      data: { imported_count: 0, duplicate_count: 0, failed_count: 0, row_errors: [] },
      error: null,
    };
  }
  if (rows.length > 500)
    return { data: null, error: "Imports are limited to 500 rows at a time." };

  const packagesResult = await getMembershipPackages(gymId, branch.id);
  if (packagesResult.error) return { data: null, error: packagesResult.error };
  const packageMatches = new Map<string, string[]>();
  for (const pkg of packagesResult.data!.filter((item) => item.active)) {
    const key = normalizeImportName(pkg.package_name);
    packageMatches.set(key, [...(packageMatches.get(key) ?? []), pkg.id]);
  }

  const errors: MemberImportRowError[] = [];
  const validRows: ValidImportRow[] = [];
  const defaultStartDate = branch.timezone ? dateForTimeZone(branch.timezone) : null;

  for (const raw of rows) {
    if (
      !raw ||
      typeof raw.name !== "string" ||
      typeof raw.phone !== "string" ||
      typeof raw.packageName !== "string" ||
      (raw.startDate !== undefined && typeof raw.startDate !== "string") ||
      (raw.expiryDate !== undefined && typeof raw.expiryDate !== "string")
    ) {
      errors.push({ rowNumber: raw?.rowNumber ?? 0, error: "Invalid import row." });
      continue;
    }
    const rowNumber =
      Number.isInteger(raw.rowNumber) && raw.rowNumber > 0 ? raw.rowNumber : 0;
    const name = raw.name.trim().replace(/\s+/g, " ");
    if (!name) {
      errors.push({ rowNumber, error: "Member name is required." });
      continue;
    }
    const normalizedPhone = normalizePhoneNumber(raw.phone, branch.country_code);
    if (!normalizedPhone.e164) {
      errors.push({ rowNumber, error: normalizedPhone.error! });
      continue;
    }
    const packageIds = packageMatches.get(normalizeImportName(raw.packageName)) ?? [];
    if (packageIds.length !== 1) {
      errors.push({
        rowNumber,
        error: raw.packageName.trim()
          ? "Package was not found uniquely in this branch."
          : "Membership package is required.",
      });
      continue;
    }
    const start = parseImportDate(raw.startDate ?? "");
    const expiry = parseImportDate(raw.expiryDate ?? "");
    if (start.error || expiry.error) {
      errors.push({ rowNumber, error: start.error ?? expiry.error! });
      continue;
    }
    if (!start.value && !defaultStartDate) {
      errors.push({
        rowNumber,
        error: "Start date is required until this branch has a timezone configured.",
      });
      continue;
    }
    const startDate = start.value ?? defaultStartDate!;
    if (expiry.value && expiry.value <= startDate) {
      errors.push({ rowNumber, error: "Expiry date must be after the start date." });
      continue;
    }
    validRows.push({
      rowNumber,
      requestId: raw.requestId,
      name,
      phone: normalizedPhone.e164,
      packageId: packageIds[0],
      startDate,
      expiryDate: expiry.value,
    });
  }

  let imported = 0;
  let duplicates = 0;
  for (let start = 0; start < validRows.length; start += 10) {
    const chunk = validRows.slice(start, start + 10);
    const outcomes = await Promise.all(
      chunk.map(async (row) => {
        const { error } = await registerMember(
          {
            requestId: row.requestId,
            branchId: branch.id,
            name: row.name,
            phone: row.phone,
            packageId: row.packageId,
            startDate: row.startDate,
            expiryDate: row.expiryDate ?? undefined,
          },
          branch,
          "import",
        );
        return { row, error };
      }),
    );
    for (const { row, error } of outcomes) {
      if (!error) {
        imported += 1;
      } else if (/overlaps/i.test(error)) {
        duplicates += 1;
        errors.push({
          rowNumber: row.rowNumber,
          error: "Membership period overlaps an existing period in this branch.",
        });
      } else {
        errors.push({ rowNumber: row.rowNumber, error });
      }
    }
  }

  return {
    data: {
      imported_count: imported,
      duplicate_count: duplicates,
      failed_count: errors.length - duplicates,
      row_errors: errors,
    },
    error: null,
  };
}
