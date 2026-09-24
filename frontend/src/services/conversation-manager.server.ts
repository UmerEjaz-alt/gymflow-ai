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
import {
  createMessage,
  getMessageByWhatsAppMessageId,
  listRecentMessages,
} from "@/services/message.server";
import { elapsedMs, logPerformance } from "@/lib/performance-log.server";
import { createServerSupabaseClient } from "@/lib/supabase/server";

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
  /** SMS endpoint / destination this message arrived on. */
  smsEndpointId?: string | null;
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
  /** Provider-scoped SMS identity. Never implies outbound delivery. */
  smsProvider?: string | null;
  smsMessageId?: string | null;
  metadata?: Record<string, unknown>;
  /**
   * A channel-decoding failure response. It is persisted without invoking the
   * receptionist model so an unreadable inbound payload cannot change lead,
   * booking, or memory state.
   */
  safeFallbackReplyText?: string | null;
  /** Persist the inbound message but do not invoke an expensive model call. */
  suppressAI?: boolean;
  /** Hashed durable AI budgets consumed inside established ingestion. */
  aiRateLimit?: {
    customerBucket: string;
    customerLimit: number;
    gymBucket: string;
    gymLimit: number;
    windowSeconds: number;
  };
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
  /** Set by the transactional ingestion boundary when another worker won. */
  duplicateInbound?: boolean;
  /** Present only for a proactive automation-generated turn. */
  automationInstruction?: string;
};

// ---------------------------------------------------------------------------
// Internal constants
// ---------------------------------------------------------------------------

const LATEST_MESSAGES_LIMIT = 20;

type EstablishedIngestionResult = {
  outcome: "inserted" | "duplicate" | "not_established";
  conversation: Conversation | null;
  message: Message | null;
  recentMessages: Message[];
  timings: {
    lookupMs: number;
    persistenceMs: number;
    updateMs: number;
    historyMs: number;
    rateLimitMs: number;
  };
  customerAllowed: boolean | null;
  gymAllowed: boolean | null;
};

async function ingestEstablishedWhatsAppMessage(
  event: IncomingMessageEvent,
  now: string,
): Promise<
  { data: EstablishedIngestionResult; error: null } | { data: null; error: string }
> {
  const aiRateLimit = event.aiRateLimit;
  if (!aiRateLimit) {
    return { data: null, error: "Durable AI rate-limit input is missing." };
  }
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc("ingest_established_whatsapp_message", {
    p_gym_id: event.gymId,
    p_endpoint_id: event.endpointId,
    p_customer_bucket: aiRateLimit.customerBucket,
    p_customer_limit: aiRateLimit.customerLimit,
    p_gym_bucket: aiRateLimit.gymBucket,
      p_gym_limit: aiRateLimit.gymLimit,
      p_window_seconds: aiRateLimit.windowSeconds,
      p_customer_phone: event.customerPhone,
      p_message_type: event.messageType,
    p_content: event.content,
    p_whatsapp_message_id: event.whatsappMessageId,
    p_metadata: event.metadata ?? {},
    p_last_message_at: now,
    p_history_limit: LATEST_MESSAGES_LIMIT,
  });
  const row = Array.isArray(data) ? data[0] : null;
  if (error || !row) {
    return {
      data: null,
      error: error?.message ?? "Established WhatsApp ingestion was unavailable.",
    };
  }

  return {
    data: {
      outcome: row.outcome as EstablishedIngestionResult["outcome"],
      conversation: row.conversation_row as Conversation | null,
      message: row.message_row as Message | null,
      recentMessages: Array.isArray(row.recent_messages)
        ? (row.recent_messages as Message[])
        : [],
      timings: {
        lookupMs: Number(row.conversation_lookup_ms ?? 0),
        persistenceMs: Number(row.inbound_persistence_ms ?? 0),
        updateMs: Number(row.conversation_update_ms ?? 0),
        historyMs: Number(row.history_load_ms ?? 0),
        rateLimitMs: Number(row.rate_limit_ms ?? 0),
      },
      customerAllowed:
        typeof row.customer_allowed === "boolean" ? row.customer_allowed : null,
      gymAllowed: typeof row.gym_allowed === "boolean" ? row.gym_allowed : null,
    },
    error: null,
  };
}

async function ingestSmsMessage(
  event: IncomingMessageEvent,
  now: string,
): Promise<
  { data: EstablishedIngestionResult; error: null } | { data: null; error: string }
> {
  const aiRateLimit = event.aiRateLimit;
  if (
    !aiRateLimit ||
    !event.smsEndpointId ||
    !event.smsProvider ||
    !event.smsMessageId
  ) {
    return { data: null, error: "Complete SMS ingestion identity is required." };
  }
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc("ingest_sms_message", {
    p_gym_id: event.gymId,
    p_sms_endpoint_id: event.smsEndpointId,
    p_provider: event.smsProvider,
    p_provider_message_id: event.smsMessageId,
    p_customer_phone: event.customerPhone,
    p_customer_name: event.customerName ?? null,
    p_message_type: event.messageType,
    p_content: event.content,
    p_metadata: event.metadata ?? {},
    p_last_message_at: now,
    p_customer_bucket: aiRateLimit.customerBucket,
    p_customer_limit: aiRateLimit.customerLimit,
    p_gym_bucket: aiRateLimit.gymBucket,
    p_gym_limit: aiRateLimit.gymLimit,
    p_window_seconds: aiRateLimit.windowSeconds,
    p_history_limit: LATEST_MESSAGES_LIMIT,
  });
  const row = Array.isArray(data) ? data[0] : null;
  if (error || !row) {
    return { data: null, error: error?.message ?? "SMS ingestion was unavailable." };
  }
  return {
    data: {
      outcome: row.outcome as EstablishedIngestionResult["outcome"],
      conversation: row.conversation_row as Conversation | null,
      message: row.message_row as Message | null,
      recentMessages: Array.isArray(row.recent_messages)
        ? (row.recent_messages as Message[])
        : [],
      timings: {
        lookupMs: 0,
        persistenceMs: 0,
        updateMs: 0,
        historyMs: 0,
        rateLimitMs: 0,
      },
      customerAllowed:
        typeof row.customer_allowed === "boolean" ? row.customer_allowed : null,
      gymAllowed: typeof row.gym_allowed === "boolean" ? row.gym_allowed : null,
    },
    error: null,
  };
}

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
  const totalStartedAt = performance.now();
  const {
    gymId,
    endpointId,
    smsEndpointId,
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
  let effectiveSuppressAI = Boolean(event.suppressAI);

  if (source === "sms") {
    const smsIngestion = await ingestSmsMessage(event, now);
    if (smsIngestion.error || !smsIngestion.data) {
      return { data: null, error: `SMS ingestion failed: ${smsIngestion.error}` };
    }
    const { conversation, message } = smsIngestion.data;
    if (!conversation || !message || smsIngestion.data.outcome === "not_established") {
      return { data: null, error: "SMS ingestion returned an invalid result." };
    }
    const duplicateInbound = smsIngestion.data.outcome === "duplicate";
    const rateLimitWasConsumed =
      smsIngestion.data.customerAllowed !== null &&
      smsIngestion.data.gymAllowed !== null;
    if (rateLimitWasConsumed) {
      effectiveSuppressAI ||=
        smsIngestion.data.customerAllowed !== true ||
        smsIngestion.data.gymAllowed !== true;
    }
    logPerformance("sms.conversation_load", {
      source,
      message_type: messageType,
      duplicate: duplicateInbound,
      rate_limit_allowed: rateLimitWasConsumed ? !effectiveSuppressAI : null,
      history_rows_loaded: smsIngestion.data.recentMessages.length,
      total_ms: elapsedMs(totalStartedAt),
    });
    return {
      data: {
        conversation,
        latestMessages: smsIngestion.data.recentMessages,
        shouldCallAI:
          !duplicateInbound &&
          !effectiveSuppressAI &&
          conversation.ai_enabled &&
          conversation.status === "active",
        humanTakeover: conversation.status === "human",
        leadStage: conversation.lead_stage,
        status: conversation.status,
        latestCustomerMessage: message,
        duplicateInbound,
      },
      error: null,
    };
  }

  if (source === "whatsapp" && endpointId && whatsappMessageId && event.aiRateLimit) {
    const fastPathStartedAt = performance.now();
    const fastPath = await ingestEstablishedWhatsAppMessage(event, now);
    const fastPathMs = elapsedMs(fastPathStartedAt);
    if (fastPath.error || !fastPath.data) {
      return {
        data: null,
        error: `Established WhatsApp ingestion failed: ${fastPath.error}`,
      };
    }
    const rateLimitWasConsumed =
      fastPath.data.customerAllowed !== null && fastPath.data.gymAllowed !== null;
    if (rateLimitWasConsumed) {
      const allowed =
        fastPath.data.customerAllowed === true && fastPath.data.gymAllowed === true;
      logPerformance("whatsapp.rate_limit", {
        scope: "ai",
        allowed,
        consolidated_ingestion: true,
        total_ms: fastPath.data.timings.rateLimitMs,
      });
      effectiveSuppressAI ||= !allowed;
    }
    if (
      fastPath.data.outcome !== "not_established" &&
      fastPath.data.conversation &&
      fastPath.data.message
    ) {
      const conversation = fastPath.data.conversation;
      const duplicateInbound = fastPath.data.outcome === "duplicate";
      logPerformance("whatsapp.conversation_load", {
        source,
        message_type: messageType,
        established_fast_path: true,
        duplicate: duplicateInbound,
        conversation_lookup_ms: fastPath.data.timings.lookupMs,
        conversation_create_ms: 0,
        route_stamp_ms: 0,
        inbound_persistence_ms: fastPath.data.timings.persistenceMs,
        conversation_update_ms: fastPath.data.timings.updateMs,
        history_load_ms: fastPath.data.timings.historyMs,
        history_rows_loaded: fastPath.data.recentMessages.length,
        history_rows_used: fastPath.data.recentMessages.length,
        total_ms: fastPathMs,
      });
      return {
        data: {
          conversation,
          latestMessages: fastPath.data.recentMessages,
          shouldCallAI:
            !duplicateInbound &&
            !effectiveSuppressAI &&
            conversation.ai_enabled &&
            conversation.status === "active",
          humanTakeover: conversation.status === "human",
          leadStage: conversation.lead_stage,
          status: conversation.status,
          latestCustomerMessage: fastPath.data.message,
          duplicateInbound,
        },
        error: null,
      };
    }

    // New endpoint conversations retain the existing creation/fallback path.
    // Recheck immediately before that path so the second idempotency boundary
    // is not lost if another worker created the conversation meanwhile.
    const existing = await getMessageByWhatsAppMessageId(whatsappMessageId);
    if (existing.error) {
      return {
        data: null,
        error: `Webhook idempotency lookup failed: ${existing.error}`,
      };
    }
    if (existing.data) {
      const conversationResult = await getConversation(existing.data.conversation_id);
      if (conversationResult.error || !conversationResult.data) {
        return {
          data: null,
          error: conversationResult.error ?? "Duplicate conversation was unavailable.",
        };
      }
      const conversation = conversationResult.data;
      return {
        data: {
          conversation,
          latestMessages: [],
          shouldCallAI: false,
          humanTakeover: conversation.status === "human",
          leadStage: conversation.lead_stage,
          status: conversation.status,
          latestCustomerMessage: existing.data,
          duplicateInbound: true,
        },
        error: null,
      };
    }
  }

  // ── Step 1: Resolve or create the conversation ───────────────────────────
  const lookupStartedAt = performance.now();
  const lookupResult = await getConversationByPhone(
    gymId,
    customerPhone,
    endpointId,
    branchId,
    { source, smsEndpointId },
  );
  const lookupMs = elapsedMs(lookupStartedAt);
  if (lookupResult.error) {
    return { data: null, error: `Conversation lookup failed: ${lookupResult.error}` };
  }

  let conversation: Conversation;
  let conversationCreateMs = 0;

  if (lookupResult.data) {
    conversation = lookupResult.data;
  } else {
    const createStartedAt = performance.now();
    const createResult = await createConversation({
      gym_id: gymId,
      branch_id: branchId ?? null,
      whatsapp_endpoint_id: endpointId ?? null,
      sms_endpoint_id: smsEndpointId ?? null,
      customer_phone: customerPhone,
      customer_name: customerName ?? null,
      source,
      last_message_at: now,
    });
    conversationCreateMs = elapsedMs(createStartedAt);
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
  if (smsEndpointId && !conversation.sms_endpoint_id) {
    updates.sms_endpoint_id = smsEndpointId;
  }

  const routeStampStartedAt = performance.now();
  if (Object.keys(updates).length > 0) {
    const branchUpdate = await updateConversation(conversation.id, updates);
    if (!branchUpdate.error && branchUpdate.data) {
      conversation = branchUpdate.data;
    }
  }
  const routeStampMs = elapsedMs(routeStampStartedAt);

  // ── Step 3: Persist the customer message ─────────────────────────────────
  const messagePersistenceStartedAt = performance.now();
  const messageResult = await createMessage({
    conversation_id: conversation.id,
    sender_type: "customer",
    message_type: messageType,
    whatsapp_message_id: whatsappMessageId ?? null,
    content,
    metadata: metadata ?? {},
  });
  const messagePersistenceMs = elapsedMs(messagePersistenceStartedAt);
  if (messageResult.error) {
    return { data: null, error: `Message persistence failed: ${messageResult.error}` };
  }
  const latestCustomerMessage = messageResult.data!;

  // ── Step 4: Update conversation timestamp ────────────────────────────────
  const conversationUpdatePromise = (async () => {
    const startedAt = performance.now();
    const result = await updateConversation(conversation.id, {
      last_message_at: now,
    });
    return { result, elapsedMs: elapsedMs(startedAt) };
  })();

  // The message is already durable at this point. Updating the conversation
  // summary and reading its recent history are independent operations, so they
  // can share one network round trip without changing persistence ordering.
  const historyPromise = (async () => {
    const startedAt = performance.now();
    const result = await listRecentMessages(conversation.id, LATEST_MESSAGES_LIMIT);
    return { result, elapsedMs: elapsedMs(startedAt) };
  })();

  const [conversationUpdate, historyLoad] = await Promise.all([
    conversationUpdatePromise,
    historyPromise,
  ]);
  const updateResult = conversationUpdate.result;
  const conversationUpdateMs = conversationUpdate.elapsedMs;
  if (updateResult.error) {
    return { data: null, error: `Conversation update failed: ${updateResult.error}` };
  }
  conversation = updateResult.data!;

  // ── Step 5: Load recent messages ─────────────────────────────────────────
  const messagesResult = historyLoad.result;
  const historyLoadMs = historyLoad.elapsedMs;
  if (messagesResult.error) {
    return { data: null, error: `Message retrieval failed: ${messagesResult.error}` };
  }
  const latestMessages = messagesResult.data!;

  logPerformance("whatsapp.conversation_load", {
    source,
    message_type: messageType,
    conversation_lookup_ms: lookupMs,
    conversation_create_ms: conversationCreateMs,
    route_stamp_ms: routeStampMs,
    inbound_persistence_ms: messagePersistenceMs,
    conversation_update_ms: conversationUpdateMs,
    history_load_ms: historyLoadMs,
    history_rows_loaded: latestMessages.length,
    history_rows_used: latestMessages.length,
    total_ms: elapsedMs(totalStartedAt),
  });

  // ── Step 6: Assemble context ──────────────────────────────────────────────
  return {
    data: {
      conversation,
      latestMessages,
      shouldCallAI:
        !effectiveSuppressAI &&
        conversation.ai_enabled &&
        conversation.status === "active",
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

  const messagesResult = await listRecentMessages(
    input.conversationId,
    LATEST_MESSAGES_LIMIT,
  );
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
      latestMessages: messagesResult.data!,
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
