import type {
  Conversation,
  ConversationSource,
  ConversationStatus,
  LeadStage,
} from "@/types/conversation";
import type { Message, MessageType } from "@/types/message";
import {
  createConversation,
  getConversation,
  getConversationByPhone,
  updateConversation,
} from "@/services/conversation.server";
import { createMessage, listMessages } from "@/services/message.server";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Input describing a single incoming message event from a customer. */
export type IncomingMessageEvent = {
  gymId: string;
  /**
   * WhatsApp endpoint / destination this message arrived on.
   */
  endpointId?: string | null;
  /**
   * Branch this message arrived on (when dedicated to a branch).
   * Null for shared gym endpoints.
   */
  branchId?: string | null;
  customerPhone: string;
  customerName?: string | null;
  source?: ConversationSource;
  messageType: MessageType;
  content: string;
  /** Stable channel message ID used for database-backed idempotency. */
  whatsappMessageId?: string | null;
  metadata?: Record<string, unknown>;
  /**
   * A channel-decoding failure response. It is persisted without invoking the
   * receptionist model so an unreadable inbound payload cannot change lead,
   * booking, or memory state.
   */
  safeFallbackReplyText?: string | null;
};

/**
 * Rich context produced after processing one message turn.
 * All downstream consumers (AI pipeline, webhook handler, knowledge layer)
 * read exclusively from this object.
 */
export type ConversationContext = {
  conversation: Conversation;
  latestMessages: Message[];
  shouldCallAI: boolean;
  humanTakeover: boolean;
  leadStage: LeadStage;
  status: ConversationStatus;
  latestCustomerMessage: Message;
  /** Present only for a proactive automation-generated turn. */
  automationInstruction?: string;
};

// ---------------------------------------------------------------------------
// Internal constants
// ---------------------------------------------------------------------------

const LATEST_MESSAGES_LIMIT = 20;

// ---------------------------------------------------------------------------
// Orchestration — inbound message
// ---------------------------------------------------------------------------

/**
 * Processes an incoming customer message end-to-end:
 *
 * 1. Looks up or creates the conversation for this phone number and endpoint.
 * 2. When branchId is provided (dedicated endpoint) and the conversation has no branch yet,
 *    stamps it onto the conversation so future turns use the correct branch context.
 * 3. When endpointId is provided and not yet recorded, stamps it on the conversation.
 * 4. Persists the customer message.
 * 5. Updates last_message_at.
 * 6. Loads the 20 most-recent messages.
 * 7. Returns a ConversationContext.
 *
 * Does NOT call any LLM or send any outbound message.
 */
export async function handleIncomingMessage(
  event: IncomingMessageEvent,
): Promise<{ data: ConversationContext; error: null } | { data: null; error: string }> {
  const {
    gymId,
    endpointId,
    branchId,
    customerPhone,
    customerName,
    source = "whatsapp",
    messageType,
    content,
    whatsappMessageId,
    metadata,
  } = event;
  const now = new Date().toISOString();

  // ── Step 1: Resolve or create the conversation ───────────────────────────
  const lookupResult = await getConversationByPhone(
    gymId,
    customerPhone,
    endpointId,
    branchId,
  );
  if (lookupResult.error) {
    return { data: null, error: `Conversation lookup failed: ${lookupResult.error}` };
  }

  let conversation: Conversation;

  if (lookupResult.data) {
    conversation = lookupResult.data;
  } else {
    const createResult = await createConversation({
      gym_id: gymId,
      branch_id: branchId ?? null,
      whatsapp_endpoint_id: endpointId ?? null,
      customer_phone: customerPhone,
      customer_name: customerName ?? null,
      source,
      last_message_at: now,
    });
    if (createResult.error) {
      return {
        data: null,
        error: `Conversation creation failed: ${createResult.error}`,
      };
    }
    conversation = createResult.data!;
  }

  // ── Step 2: Stamp branch_id or endpoint_id if newly resolved ────────────
  const updates: Partial<Conversation> = {};
  if (branchId && !conversation.branch_id) {
    updates.branch_id = branchId;
  }
  if (endpointId && !conversation.whatsapp_endpoint_id) {
    updates.whatsapp_endpoint_id = endpointId;
  }

  if (Object.keys(updates).length > 0) {
    const branchUpdate = await updateConversation(conversation.id, updates);
    if (!branchUpdate.error && branchUpdate.data) {
      conversation = branchUpdate.data;
    }
  }

  // ── Step 3: Persist the customer message ─────────────────────────────────
  const messageResult = await createMessage({
    conversation_id: conversation.id,
    sender_type: "customer",
    message_type: messageType,
    whatsapp_message_id: whatsappMessageId ?? null,
    content,
    metadata: metadata ?? {},
  });
  if (messageResult.error) {
    return { data: null, error: `Message persistence failed: ${messageResult.error}` };
  }
  const latestCustomerMessage = messageResult.data!;

  // ── Step 4: Update conversation timestamp ────────────────────────────────
  const updateResult = await updateConversation(conversation.id, {
    last_message_at: now,
  });
  if (updateResult.error) {
    return { data: null, error: `Conversation update failed: ${updateResult.error}` };
  }
  conversation = updateResult.data!;

  // ── Step 5: Load recent messages ─────────────────────────────────────────
  const messagesResult = await listMessages(conversation.id);
  if (messagesResult.error) {
    return { data: null, error: `Message retrieval failed: ${messagesResult.error}` };
  }
  const latestMessages = messagesResult.data!.slice(-LATEST_MESSAGES_LIMIT);

  // ── Step 6: Assemble context ──────────────────────────────────────────────
  return {
    data: {
      conversation,
      latestMessages,
      shouldCallAI: conversation.ai_enabled && conversation.status === "active",
      humanTakeover: conversation.status === "human",
      leadStage: conversation.lead_stage,
      status: conversation.status,
      latestCustomerMessage,
    },
    error: null,
  };
}

// ---------------------------------------------------------------------------
// Orchestration — outbound automation turn
// ---------------------------------------------------------------------------

/**
 * Builds a ConversationContext for a proactive automation turn without
 * creating a fake inbound customer message. The AI pipeline receives the
 * same history, memory, knowledge and validation path as inbound turns.
 *
 * The synthetic latestCustomerMessage has message_type='system' and empty
 * content so the AI does not answer an old question instead of following
 * the automation instruction.
 */
export async function buildAutomationConversationContext(input: {
  conversationId: string;
  instruction: string;
}): Promise<
  { data: ConversationContext; error: null } | { data: null; error: string }
> {
  const conversationResult = await getConversation(input.conversationId);
  if (conversationResult.error || !conversationResult.data)
    return { data: null, error: conversationResult.error ?? "Conversation not found." };

  const messagesResult = await listMessages(input.conversationId);
  if (messagesResult.error) return { data: null, error: messagesResult.error };

  const conversation = conversationResult.data;

  const latestCustomerMessage: Message = {
    id: `automation-${input.conversationId}`,
    conversation_id: input.conversationId,
    sender_type: "customer",
    message_type: "system",
    whatsapp_message_id: null,
    content: "",
    metadata: { automation: true },
    delivered_at: null,
    read_at: null,
    created_at: new Date().toISOString(),
  };

  return {
    data: {
      conversation,
      latestMessages: messagesResult.data!.slice(-LATEST_MESSAGES_LIMIT),
      // Automation turns bypass the per-conversation ai_enabled flag — the
      // automation config's own enabled flag is the opt-in. The orchestrator
      // enforces this separately.
      shouldCallAI: conversation.ai_enabled && conversation.status === "active",
      humanTakeover: conversation.status === "human",
      leadStage: conversation.lead_stage,
      status: conversation.status,
      latestCustomerMessage,
      automationInstruction: input.instruction,
    },
    error: null,
  };
}
