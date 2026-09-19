import { Inbox } from "lucide-react";

import {
  ConversationSimulator,
  type SimulatorConversation,
} from "@/features/conversation-simulator/components/conversation-simulator";
import {
  createConversation,
  listConversationsWithMessagePreview,
  getConversation,
} from "@/services/conversation.server";
import { processIncomingConversationTurn } from "@/services/conversation-turn.server";
import { getGym } from "@/services/gym.server";
import { listMessages } from "@/services/message.server";
import { resolveActiveBranch } from "@/lib/active-branch.server";
import { getWhatsAppEndpoints } from "@/services/whatsapp-endpoint.server";
import type { Branch } from "@/types/branch";
import type { WhatsAppEndpoint } from "@/types/whatsapp-endpoint";
import { elapsedMs, logPerformance } from "@/lib/performance-log.server";
import { getActiveScopeConversationHistory } from "@/services/conversation-history.server";

export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// Data loading
// ---------------------------------------------------------------------------

async function loadSimulatorData(): Promise<{
  conversations: SimulatorConversation[];
  activeEndpoints: WhatsAppEndpoint[];
  branches: Branch[];
  error?: string;
}> {
  const totalStartedAt = performance.now();
  const branchStartedAt = performance.now();
  const resolved = await resolveActiveBranch();
  if (resolved.error || !resolved.gym)
    return {
      conversations: [],
      activeEndpoints: [],
      branches: [],
      error: resolved.error ?? "Create your gym profile before opening the inbox.",
    };
  const branchMs = elapsedMs(branchStartedAt);

  const gym = resolved.gym;

  const branches = resolved.branches;
  const dataStartedAt = performance.now();
  const conversationScope = resolved.isUnassigned ? "unassigned" : resolved.branch.id;
  const [endpointsResult, conversationsResult] = await Promise.all([
    getWhatsAppEndpoints(gym.id),
    listConversationsWithMessagePreview(gym.id, undefined, conversationScope),
  ]);
  const dataMs = elapsedMs(dataStartedAt);
  const activeEndpoints = (endpointsResult.data ?? []).filter((ep) => ep.is_active);

  const messagesStartedAt = performance.now();
  const conversations = [...(conversationsResult.data ?? [])];
  if (conversations[0]) {
    const messages = await listMessages(conversations[0].id);
    conversations[0] = { ...conversations[0], messages: messages.data ?? [] };
  }
  const messagesMs = elapsedMs(messagesStartedAt);

  logPerformance("dashboard.inbox.load", {
    branch_resolution_ms: branchMs,
    data_queries_ms: dataMs,
    messages_ms: messagesMs,
    conversation_count: conversations.length,
    initial_history_count: conversations[0]?.messages.length ?? 0,
    preview_count: conversations.slice(1).filter((item) => item.messages.length > 0)
      .length,
    total_ms: elapsedMs(totalStartedAt),
  });

  return { conversations, activeEndpoints, branches };
}

async function loadConversationHistory(conversationId: string) {
  "use server";
  return getActiveScopeConversationHistory(conversationId);
}

// ---------------------------------------------------------------------------
// Server Actions
// ---------------------------------------------------------------------------

/**
 * Creates a simulated customer conversation.
 * The selected endpoint determines whether branch_id starts NULL (shared) or resolved (dedicated).
 */
async function createSimulatedCustomer(
  name: string,
  phone: string,
  endpointId: string | null,
) {
  "use server";
  const gymResult = await getGym();
  if (gymResult.error || !gymResult.data)
    return { error: gymResult.error ?? "Gym profile not found." };

  if (endpointId) {
    const endpointsResult = await getWhatsAppEndpoints(gymResult.data.id);
    const targetEndpoint = (endpointsResult.data ?? []).find(
      (e) => e.id === endpointId,
    );

    if (targetEndpoint) {
      const result = await createConversation({
        gym_id: gymResult.data.id,
        branch_id: targetEndpoint.branch_id ?? null,
        whatsapp_endpoint_id: targetEndpoint.id,
        customer_name: name.trim() || null,
        customer_phone: phone.trim(),
        source: "simulator",
      });
      return result.error
        ? { error: result.error }
        : { conversationId: result.data!.id };
    }
  }

  // Fallback: use active branch
  const branchResult = await resolveActiveBranch();
  const result = await createConversation({
    gym_id: gymResult.data.id,
    branch_id: branchResult.branch?.id ?? null,
    whatsapp_endpoint_id: null,
    customer_name: name.trim() || null,
    customer_phone: phone.trim(),
    source: "simulator",
  });
  return result.error ? { error: result.error } : { conversationId: result.data!.id };
}

/**
 * Sends a message within a simulated conversation.
 * Uses the exact production conversation turn pipeline.
 */
async function sendSimulatorMessage(conversationId: string, content: string) {
  "use server";
  const gymResult = await getGym();
  if (gymResult.error || !gymResult.data)
    return { error: gymResult.error ?? "Gym profile not found." };

  const convResult = await getConversation(conversationId);
  if (convResult.error || !convResult.data)
    return { error: convResult.error ?? "Simulated conversation not found." };
  const conversation = convResult.data;
  if (conversation.source !== "simulator") {
    return { error: "Real WhatsApp conversations are read-only in the inbox." };
  }

  const result = await processIncomingConversationTurn({
    gymId: gymResult.data.id,
    endpointId: conversation.whatsapp_endpoint_id ?? undefined,
    branchId: conversation.branch_id ?? undefined,
    customerPhone: conversation.customer_phone,
    customerName: conversation.customer_name,
    source: "simulator",
    messageType: "text",
    content: content.trim(),
    metadata: { source: "simulator" },
  });

  if (result.error) return { error: result.error };
  const messages = await listMessages(conversationId);
  return { messages: messages.data ?? [] };
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

/** Branch-scoped inbox for real WhatsApp and simulated conversations. */
export default async function InboxPage() {
  const { conversations, activeEndpoints, branches, error } = await loadSimulatorData();
  return (
    <div className="mx-auto flex w-full max-w-7xl flex-1 flex-col px-4 py-6 sm:px-6 lg:px-8">
      <div className="mb-5 flex items-center gap-3">
        <div className="bg-muted grid size-9 place-items-center rounded-lg">
          <Inbox aria-hidden className="size-4" />
        </div>
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Inbox</h1>
          <p className="text-muted-foreground text-sm">
            Review real WhatsApp conversations and test the same AI pipeline with
            simulated customers.
          </p>
        </div>
      </div>
      <ConversationSimulator
        initialConversations={conversations}
        initialError={error}
        activeEndpoints={activeEndpoints}
        branches={branches}
        onCreateCustomer={createSimulatedCustomer}
        onLoadMessages={loadConversationHistory}
        onSendMessage={sendSimulatorMessage}
      />
    </div>
  );
}
