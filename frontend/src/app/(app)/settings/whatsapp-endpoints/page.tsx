import { MessageSquare } from "lucide-react";

import { WhatsAppEndpointsManager } from "@/features/settings/components/whatsapp-endpoints-manager";
import { getGym } from "@/services/gym.server";
import { getBranches } from "@/services/branch.server";
import {
  createWhatsAppEndpoint,
  deleteWhatsAppEndpoint,
  getWhatsAppEndpoints,
  updateWhatsAppEndpoint,
} from "@/services/whatsapp-endpoint.server";
import type {
  CreateWhatsAppEndpointPayload,
  UpdateWhatsAppEndpointPayload,
  WhatsAppEndpoint,
} from "@/types/whatsapp-endpoint";

export const dynamic = "force-dynamic";

async function createEndpointAction(
  payload: CreateWhatsAppEndpointPayload,
): Promise<{ error: string | null; data?: WhatsAppEndpoint }> {
  "use server";
  const gymResult = await getGym();
  if (gymResult.error || !gymResult.data) {
    return { error: gymResult.error ?? "Gym profile not found." };
  }

  const result = await createWhatsAppEndpoint({
    ...payload,
    gym_id: gymResult.data.id,
  });

  return result.error
    ? { error: result.error }
    : { error: null, data: result.data ?? undefined };
}

async function updateEndpointAction(
  id: string,
  payload: UpdateWhatsAppEndpointPayload,
): Promise<{ error: string | null; data?: WhatsAppEndpoint }> {
  "use server";
  const gymResult = await getGym();
  if (gymResult.error || !gymResult.data) {
    return { error: gymResult.error ?? "Gym profile not found." };
  }

  // Validate that the endpoint belongs to the authenticated gym before updating
  const existing = await getWhatsAppEndpoints(gymResult.data.id);
  if (existing.error) return { error: existing.error };
  const owns = existing.data?.some((e) => e.id === id);
  if (!owns) return { error: "WhatsApp endpoint not found." };

  const result = await updateWhatsAppEndpoint(id, payload);
  return result.error
    ? { error: result.error }
    : { error: null, data: result.data ?? undefined };
}

async function deleteEndpointAction(id: string): Promise<{ error: string | null }> {
  "use server";
  const gymResult = await getGym();
  if (gymResult.error || !gymResult.data) {
    return { error: gymResult.error ?? "Gym profile not found." };
  }

  // Validate ownership before deletion
  const existing = await getWhatsAppEndpoints(gymResult.data.id);
  if (existing.error) return { error: existing.error };
  const owns = existing.data?.some((e) => e.id === id);
  if (!owns) return { error: "WhatsApp endpoint not found." };

  return deleteWhatsAppEndpoint(id);
}

export default async function WhatsAppEndpointsPage() {
  const gymResult = await getGym();
  if (gymResult.error || !gymResult.data) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-8">
        <p className="rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-700">
          {gymResult.error ?? "Create your gym profile first."}
        </p>
      </div>
    );
  }

  const gym = gymResult.data;
  const [branchesResult, endpointsResult] = await Promise.all([
    getBranches(gym.id),
    getWhatsAppEndpoints(gym.id),
  ]);

  const branches = branchesResult.data ?? [];
  const endpoints = endpointsResult.data ?? [];

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="mb-8 flex items-center gap-3">
        <div className="bg-muted grid size-9 shrink-0 place-items-center rounded-lg">
          <MessageSquare aria-hidden className="size-4" />
        </div>
        <div>
          <h1 className="text-xl font-semibold tracking-tight">WhatsApp Configuration</h1>
          <p className="text-muted-foreground text-sm">
            Configure how your gym connects to WhatsApp. Use a single number across all branches or separate numbers for each location.
          </p>
        </div>
      </div>

      {endpointsResult.error && (
        <div className="border-border mb-6 rounded-lg border bg-red-500/10 px-4 py-3 text-sm text-red-700">
          Could not load WhatsApp endpoints: {endpointsResult.error}
        </div>
      )}

      <div className="border-border bg-card space-y-6 rounded-xl border p-6 sm:p-8">
        <WhatsAppEndpointsManager
          gymId={gym.id}
          branches={branches}
          initialEndpoints={endpoints}
          onCreateEndpoint={createEndpointAction}
          onUpdateEndpoint={updateEndpointAction}
          onDeleteEndpoint={deleteEndpointAction}
        />
      </div>
    </div>
  );
}
