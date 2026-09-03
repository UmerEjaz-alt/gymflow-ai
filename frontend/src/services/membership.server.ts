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

export async function getMemberships(
  gymId: string,
  branchId?: string,
): Promise<Result<Membership[]>> {
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
  const { data: conversation, error: conversationError } = await supabase
    .from("conversations")
    .select("branch_id, source")
    .eq("id", input.conversationId)
    .maybeSingle();
  if (conversationError || !conversation?.branch_id) {
    return {
      data: null,
      error: conversationError?.message ?? "Conversation branch not found.",
    };
  }
  const { data: branch, error: branchError } = await supabase
    .from("branches")
    .select("country_code")
    .eq("id", conversation.branch_id)
    .maybeSingle();
  if (branchError || !branch) {
    return {
      data: null,
      error: branchError?.message ?? "Conversation branch not found.",
    };
  }
  // Meta wa_id values are already international identifiers without a leading +.
  // Other local-looking manual values still require the branch country context.
  const phoneInput =
    conversation.source === "whatsapp" && /^\d+$/.test(input.customerPhone.trim())
      ? `+${input.customerPhone.trim()}`
      : input.customerPhone;
  const normalizedPhone = normalizePhoneNumber(phoneInput, branch.country_code);
  if (!normalizedPhone.e164) return { data: null, error: normalizedPhone.error! };
  const { data, error } = await supabase.rpc("convert_conversation_to_member", {
    p_conversation_id: input.conversationId,
    p_membership_package_id: input.membershipPackageId,
    p_customer_name: input.customerName,
    p_customer_phone: normalizedPhone.e164,
    p_start_date: input.startDate,
  });
  if (error) return { data: null, error: error.message };
  return { data: data as Membership, error: null };
}

export type MemberImportInput = {
  rowNumber: number;
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
  name: string;
  phone: string;
  packageId: string;
  startDate: string;
  expiryDate: string | null;
};

/**
 * Revalidates and imports a bounded batch into one already-authorized branch.
 * The RPC keeps each member's conversation + membership mutation atomic.
 */
export async function importMembersToBranch(
  gymId: string,
  branch: Branch,
  rows: MemberImportInput[],
): Promise<Result<MemberImportResult>> {
  if (rows.length === 0) {
    return {
      data: { imported_count: 0, duplicate_count: 0, failed_count: 0, row_errors: [] },
      error: null,
    };
  }
  if (rows.length > 500)
    return { data: null, error: "Imports are limited to 500 rows at a time." };

  const [packagesResult, membershipsResult] = await Promise.all([
    getMembershipPackages(gymId, branch.id),
    getMemberships(gymId, branch.id),
  ]);
  if (packagesResult.error) return { data: null, error: packagesResult.error };
  if (membershipsResult.error) return { data: null, error: membershipsResult.error };

  const packageMatches = new Map<string, string[]>();
  for (const pkg of packagesResult.data!.filter((item) => item.active)) {
    const key = normalizeImportName(pkg.package_name);
    packageMatches.set(key, [...(packageMatches.get(key) ?? []), pkg.id]);
  }

  const existingPhones = new Set<string>();
  for (const membership of getLatestMemberships(membershipsResult.data!)) {
    const phone = membership.conversation?.customer_phone;
    if (!phone) continue;
    const normalized = normalizePhoneNumber(phone, branch.country_code);
    if (normalized.e164) existingPhones.add(normalized.e164);
  }

  const errors: MemberImportRowError[] = [];
  const validRows: ValidImportRow[] = [];
  const seenPhones = new Set<string>();
  let preflightDuplicates = 0;
  const defaultStartDate = branch.timezone ? dateForTimeZone(branch.timezone) : null;

  for (const raw of rows) {
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
    if (seenPhones.has(normalizedPhone.e164)) {
      preflightDuplicates += 1;
      errors.push({ rowNumber, error: "Duplicate phone number in this file." });
      continue;
    }
    seenPhones.add(normalizedPhone.e164);
    if (existingPhones.has(normalizedPhone.e164)) {
      preflightDuplicates += 1;
      errors.push({
        rowNumber,
        error: "A member with this phone number already exists in this branch.",
      });
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
      name,
      phone: normalizedPhone.e164,
      packageId: packageIds[0],
      startDate,
      expiryDate: expiry.value,
    });
  }

  const supabase = await createServerSupabaseClient();
  let imported = 0;
  let duplicates = 0;
  for (let start = 0; start < validRows.length; start += 10) {
    const chunk = validRows.slice(start, start + 10);
    const outcomes = await Promise.all(
      chunk.map(async (row) => {
        const { error } = await supabase.rpc("import_member_to_branch", {
          p_branch_id: branch.id,
          p_customer_name: row.name,
          p_customer_phone: row.phone,
          p_membership_package_id: row.packageId,
          p_start_date: row.startDate,
          p_expiry_date: row.expiryDate,
        });
        return { row, error };
      }),
    );
    for (const { row, error } of outcomes) {
      if (!error) {
        imported += 1;
      } else if (/already exists/i.test(error.message)) {
        duplicates += 1;
        errors.push({
          rowNumber: row.rowNumber,
          error: "A member with this phone number already exists in this branch.",
        });
      } else {
        errors.push({ rowNumber: row.rowNumber, error: error.message });
      }
    }
  }

  return {
    data: {
      imported_count: imported,
      duplicate_count: preflightDuplicates + duplicates,
      failed_count: errors.length - preflightDuplicates - duplicates,
      row_errors: errors,
    },
    error: null,
  };
}
