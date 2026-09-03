import { createServerSupabaseClient } from "@/lib/supabase/server";
import type {
  CreateWhatsAppEndpointPayload,
  UpdateWhatsAppEndpointPayload,
  WhatsAppEndpoint,
} from "@/types/whatsapp-endpoint";

type Result<T> = { data: T; error: null } | { data: null; error: string };

export type ResolvedWhatsAppDestination = {
  gymId: string;
  endpointId: string | null;
  /** Nullable: null for shared gym endpoints; non-null for dedicated branch endpoints. */
  branchId: string | null;
};

/**
 * Resolves the incoming WhatsApp message destination to a gym, endpoint, and branch.
 * Priority:
 * 1. Meta phone_number_id on whatsapp_endpoints
 * 2. Normalized phone number on whatsapp_endpoints
 * 3. Fallback to branch-level or gym-level configuration for backwards compatibility
 */
export async function resolveWhatsAppEndpoint(
  phoneNumberId: string | null,
  displayPhone: string | null,
): Promise<Result<ResolvedWhatsAppDestination | null>> {
  const supabase = await createServerSupabaseClient();

  // Try RPC resolve_whatsapp_endpoint
  const { data: rpcData, error: rpcError } = await supabase.rpc(
    "resolve_whatsapp_endpoint",
    {
      p_phone_number_id: phoneNumberId,
      p_display_phone_number: displayPhone,
    },
  );

  if (!rpcError && rpcData && Array.isArray(rpcData) && rpcData.length > 0) {
    const row = rpcData[0] as {
      gym_id: string;
      endpoint_id: string | null;
      branch_id: string | null;
    };
    return {
      data: {
        gymId: row.gym_id,
        endpointId: row.endpoint_id ?? null,
        branchId: row.branch_id ?? null,
      },
      error: null,
    };
  }

  // Graceful fallback to querying branches directly if RPC or table is pending migration
  if (phoneNumberId) {
    const { data: branchByMetaId } = await supabase
      .from("branches")
      .select("id, gym_id")
      .eq("whatsapp_phone_number_id", phoneNumberId)
      .maybeSingle();

    if (branchByMetaId) {
      return {
        data: {
          gymId: branchByMetaId.gym_id,
          endpointId: null,
          branchId: branchByMetaId.id,
        },
        error: null,
      };
    }
  }

  if (displayPhone) {
    const normalized = displayPhone.replace(/\D/g, "");
    if (normalized) {
      const { data: branches } = await supabase
        .from("branches")
        .select("id, gym_id, whatsapp_number");

      const matchedBranch = (branches ?? []).find(
        (b) => (b.whatsapp_number ?? "").replace(/\D/g, "") === normalized,
      );

      if (matchedBranch) {
        return {
          data: {
            gymId: matchedBranch.gym_id,
            endpointId: null,
            branchId: matchedBranch.id,
          },
          error: null,
        };
      }

      // Check gym-level whatsapp_number (shared gym line)
      const { data: gyms } = await supabase.from("gyms").select("id, whatsapp_number");

      const matchedGym = (gyms ?? []).find(
        (g) => (g.whatsapp_number ?? "").replace(/\D/g, "") === normalized,
      );

      if (matchedGym) {
        return {
          data: {
            gymId: matchedGym.id,
            endpointId: null,
            branchId: null,
          },
          error: null,
        };
      }
    }
  }

  return { data: null, error: null };
}

/**
 * Returns all WhatsApp endpoints for a gym.
 */
export async function getWhatsAppEndpoints(
  gymId: string,
): Promise<Result<WhatsAppEndpoint[]>> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("whatsapp_endpoints")
    .select("*")
    .eq("gym_id", gymId)
    .order("created_at", { ascending: true });

  if (error) {
    // If table does not exist yet, fallback to synthesize endpoints from branches
    const { data: branches, error: bError } = await supabase
      .from("branches")
      .select("id, gym_id, branch_name, whatsapp_number, whatsapp_phone_number_id")
      .eq("gym_id", gymId);

    if (bError) return { data: null, error: bError.message };

    const synthetic: WhatsAppEndpoint[] = (branches ?? [])
      .filter((b) => b.whatsapp_number || b.whatsapp_phone_number_id)
      .map((b) => ({
        id: b.id,
        gym_id: b.gym_id,
        branch_id: b.id,
        phone_number: b.whatsapp_number ?? "",
        phone_number_id: b.whatsapp_phone_number_id ?? null,
        display_phone_number: b.whatsapp_number ?? null,
        label: `${b.branch_name} WhatsApp`,
        is_active: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }));

    return { data: synthetic, error: null };
  }

  return { data: data as WhatsAppEndpoint[], error: null };
}

/**
 * Creates a new WhatsApp endpoint.
 */
export async function createWhatsAppEndpoint(
  payload: CreateWhatsAppEndpointPayload,
): Promise<Result<WhatsAppEndpoint>> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("whatsapp_endpoints")
    .insert(payload)
    .select()
    .single();

  if (error) return { data: null, error: error.message };
  return { data: data as WhatsAppEndpoint, error: null };
}

/**
 * Updates an existing WhatsApp endpoint.
 */
export async function updateWhatsAppEndpoint(
  id: string,
  payload: UpdateWhatsAppEndpointPayload,
): Promise<Result<WhatsAppEndpoint>> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("whatsapp_endpoints")
    .update(payload)
    .eq("id", id)
    .select()
    .single();

  if (error) return { data: null, error: error.message };
  return { data: data as WhatsAppEndpoint, error: null };
}

/**
 * Deletes a WhatsApp endpoint by id.
 */
export async function deleteWhatsAppEndpoint(
  id: string,
): Promise<{ error: string | null }> {
  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.from("whatsapp_endpoints").delete().eq("id", id);
  return { error: error?.message ?? null };
}
