import { createServerSupabaseClient } from "@/lib/supabase/server";
import type {
  AutomationConfig,
  AutomationExecution,
  AutomationType,
} from "@/types/automation";

type Result<T> = { data: T; error: null } | { data: null; error: string };

/**
 * Returns automation configs for a gym, optionally scoped to one branch.
 * Omit branchId to get all branches (e.g. for the automation runner iterating all branches).
 */
export async function getAutomationConfigs(
  gymId: string,
  branchId?: string,
): Promise<Result<AutomationConfig[]>> {
  const supabase = await createServerSupabaseClient();
  let query = supabase.from("automation_configs").select("*").eq("gym_id", gymId);

  if (branchId) {
    query = query.eq("branch_id", branchId);
  }

  const { data, error } = await query;
  if (error) return { data: null, error: error.message };
  return { data: (data ?? []) as AutomationConfig[], error: null };
}

/**
 * Creates or updates an automation config for a specific gym + branch + type.
 * The unique constraint is now (gym_id, branch_id, automation_type).
 */
export async function saveAutomationConfig(
  input: Omit<AutomationConfig, "id" | "created_at" | "updated_at">,
): Promise<Result<AutomationConfig>> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("automation_configs")
    .upsert(input, { onConflict: "gym_id,branch_id,automation_type" })
    .select()
    .single();
  if (error) return { data: null, error: error.message };
  return { data: data as AutomationConfig, error: null };
}

export async function createAutomationExecution(input: {
  gym_id: string;
  branch_id?: string | null;
  automation_config_id: string;
  conversation_id: string;
  membership_id?: string | null;
  trigger_key: string;
}): Promise<Result<AutomationExecution>> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc("claim_automation_execution", {
    p_gym_id: input.gym_id,
    p_branch_id: input.branch_id ?? null,
    p_automation_config_id: input.automation_config_id,
    p_conversation_id: input.conversation_id,
    p_membership_id: input.membership_id ?? null,
    p_trigger_key: input.trigger_key,
    p_lease_seconds: 300,
  });
  if (error) return { data: null, error: error.message };
  const row = Array.isArray(data) ? data[0] : null;
  return row
    ? { data: row as AutomationExecution, error: null }
    : { data: null, error: "Execution is already complete or actively claimed." };
}

export async function completeAutomationExecution(
  id: string,
  claimToken: string,
  patch: Pick<AutomationExecution, "status"> & {
    error_message?: string | null;
    sent_message_id?: string | null;
  },
): Promise<Result<AutomationExecution>> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("automation_executions")
    .update({
      ...patch,
      completed_at: new Date().toISOString(),
      claim_token: null,
      lease_expires_at: null,
    })
    .eq("id", id)
    .eq("claim_token", claimToken)
    .select()
    .maybeSingle();
  if (error) return { data: null, error: error.message };
  return data
    ? { data: data as AutomationExecution, error: null }
    : { data: null, error: "Automation execution claim is no longer owned." };
}

export async function countSentAutomationExecutions(
  configId: string,
  conversationId: string,
  membershipId?: string | null,
  since?: string | null,
): Promise<Result<number>> {
  const supabase = await createServerSupabaseClient();
  let query = supabase
    .from("automation_executions")
    .select("id", { count: "exact", head: true })
    .eq("automation_config_id", configId)
    .eq("conversation_id", conversationId)
    .eq("status", "sent");

  if (membershipId) {
    query = query.eq("membership_id", membershipId);
  }
  if (since) {
    query = query.gt("created_at", since);
  }

  const { count, error } = await query;
  if (error) return { data: null, error: error.message };
  return { data: count ?? 0, error: null };
}

/**
 * Returns the most recent successful follow-up in this automation sequence.
 * This is used to keep scheduler frequency independent from follow-up cadence.
 */
export async function getLatestSentAutomationExecution(
  configId: string,
  conversationId: string,
  membershipId?: string | null,
  since?: string | null,
): Promise<Result<AutomationExecution | null>> {
  const supabase = await createServerSupabaseClient();
  let query = supabase
    .from("automation_executions")
    .select("*")
    .eq("automation_config_id", configId)
    .eq("conversation_id", conversationId)
    .eq("status", "sent")
    .order("completed_at", { ascending: false })
    .limit(1);

  if (membershipId) query = query.eq("membership_id", membershipId);
  if (since) query = query.gt("created_at", since);

  const { data, error } = await query.maybeSingle();
  if (error) return { data: null, error: error.message };
  return { data: data as AutomationExecution | null, error: null };
}

export const AUTOMATION_TYPES: AutomationType[] = [
  "membership_expiry_reminder",
  "expired_membership_follow_up",
  "member_check_in",
  "lead_follow_up",
];
