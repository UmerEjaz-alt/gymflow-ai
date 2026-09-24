import { createSystemSupabaseClient } from "@/lib/supabase/system";

type Result<T> = { data: T; error: null } | { data: null; error: string };

export type ResolvedSmsEndpoint = {
  endpointId: string;
  gymId: string;
  branchId: string | null;
  provider: string;
  isActive: boolean;
};

/** Resolves only sms_endpoints by normalized destination number. */
export async function resolveSmsEndpoint(
  destinationPhone: string,
): Promise<Result<ResolvedSmsEndpoint | null>> {
  const supabase = createSystemSupabaseClient();
  const { data, error } = await supabase.rpc("resolve_sms_endpoint", {
    p_destination_phone: destinationPhone,
  });
  if (error) return { data: null, error: "SMS endpoint resolution failed." };
  const row = Array.isArray(data) ? data[0] : null;
  if (!row) return { data: null, error: null };
  return {
    data: {
      endpointId: String(row.endpoint_id),
      gymId: String(row.gym_id),
      branchId: row.branch_id ? String(row.branch_id) : null,
      provider: String(row.provider),
      isActive: row.is_active === true,
    },
    error: null,
  };
}
