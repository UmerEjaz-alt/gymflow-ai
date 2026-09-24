/**
 * Conversation Reply
 *
 * Persists an approved AI reply as a message and updates the conversation
 * timestamp. Unapproved responses are silently skipped — the caller decides
 * how to handle rejections (e.g. escalate to a human agent).
 *
 * No WhatsApp sending. Reuses existing service layer only.
 */

import type { ValidatedResponse } from "@/services/response-validator.server";
import { isLeadStage, type UpdateConversationPayload } from "@/types/conversation";
import { mergeConversationMemory } from "@/services/memory-extractor.server";
import { getConversation, updateConversation } from "@/services/conversation.server";
import { createMessage } from "@/services/message.server";
import type { MediaAsset } from "@/types/media-asset";
import type { Message } from "@/types/message";
import type { ResolvedTurnContext } from "@/services/knowledge-layer.server";
import { elapsedMs, logPerformance } from "@/lib/performance-log.server";
import { createServerSupabaseClient } from "@/lib/supabase/server";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type SaveAIReplyResult = {
  /** Whether the reply was persisted. False when response was not approved. */
  saved: boolean;
  /** Error message if persistence failed, null otherwise. */
  error: string | null;
  /** The text reply message persisted for channel delivery/execution logs. */
  messageId?: string;
  messages?: Message[];
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Persists an approved AI reply to the database.
 *
 * Steps (only when response.approved === true):
 *   1. Update conversation with understanding + memory changes.
 *   2. Create a message row with sender_type "ai".
 *
 * Returns immediately with saved=false when the response is not approved.
 */
export async function saveAIReply(
  conversationId: string,
  response: ValidatedResponse,
  model: string,
  availableMedia: MediaAsset[] = [],
  allowedBranchIds: string[] = [],
  resolvedBranchSelectionId: string | null = null,
  resolvedTurn: ResolvedTurnContext | null = null,
  queueWhatsAppDelivery = false,
  atomicWhatsAppTextPersistence = false,
  concurrencyRetryCount = 0,
  priorAttemptMs = 0,
  smsInboundReplyToMessageId: string | null = null,
): Promise<SaveAIReplyResult> {
  const totalStartedAt = performance.now();
  // Guard: skip unapproved responses without writing anything
  if (!response.approved) {
    return { saved: false, error: null };
  }

  // Resolve the authoritative delivery sequence before choosing persistence.
  // Multi-message/media replies retain their existing ordered insert path.
  const mediaById = new Map(availableMedia.map((asset) => [asset.id, asset]));
  const sequence =
    response.messageSequence.length > 0
      ? response.messageSequence
      : [
          { type: "text" as const, text: response.text },
          ...response.mediaActions.map((action) => ({
            type: "image" as const,
            assetId: action.assetId,
            caption: action.caption,
          })),
        ];

  // Step 1: load conversation for memory merge
  const conversationLoadStartedAt = performance.now();
  const conversationResult = await getConversation(conversationId);
  const conversationLoadMs = elapsedMs(conversationLoadStartedAt);
  if (conversationResult.error || !conversationResult.data) {
    return {
      saved: false,
      error: `Failed to load conversation for reply save: ${conversationResult.error ?? "Conversation not found."}`,
    };
  }

  const memoryMergeStartedAt = performance.now();
  const memoryMerge = mergeConversationMemory(
    conversationResult.data.customer_memory,
    response.understanding.memory_updates,
  );

  const safeUnderstanding = { ...response.understanding };
  if (
    conversationResult.data.status !== "human" &&
    safeUnderstanding.conversation_stage === "handoff"
  ) {
    if (
      memoryMerge.memory?.visit_discussed ||
      memoryMerge.memory?.trial_discussed ||
      safeUnderstanding.package_interest
    ) {
      safeUnderstanding.conversation_stage = "decision";
    } else {
      safeUnderstanding.conversation_stage = "consideration";
    }
  }
  const memoryMergeMs = elapsedMs(memoryMergeStartedAt);

  // Update understanding and memory only when changed.
  const conversationUpdatePayload: UpdateConversationPayload = {
    latest_understanding: safeUnderstanding,
    last_message_at: new Date().toISOString(),
  };

  if (memoryMerge.changed) {
    conversationUpdatePayload.customer_memory = memoryMerge.memory;
  }

  // Lead stage progression based on semantic AI understanding
  const currentLeadStage = conversationResult.data.lead_stage;
  const signal = safeUnderstanding.lead_signal;

  if (currentLeadStage !== "member") {
    if (signal === "rejection") {
      // Customer semantically communicates disinterest / opt-out
      conversationUpdatePayload.lead_stage = "lost";
    } else if (signal === "visit_commitment") {
      // Customer commits/agrees to a concrete visit, appointment, or trial booking
      conversationUpdatePayload.lead_stage = "trial_booked";
    } else if (
      signal === "interest" ||
      signal === "high_intent" ||
      signal === "visit_inquiry" ||
      signal === "reengagement"
    ) {
      // New leads and reactivated lost leads become qualified
      if (currentLeadStage === "new_lead" || currentLeadStage === "lost") {
        conversationUpdatePayload.lead_stage = "qualified";
      }
      // If currently qualified or trial_booked, keep existing stage (never downgrade)
    }
    // "neutral" signals do not change lead stage
  }

  // This marker preserves history only. Whether a conversation is a lead is
  // determined solely by the same lead-stage rule used by the Leads workspace.
  const effectiveLeadStage = conversationUpdatePayload.lead_stage ?? currentLeadStage;
  if (!conversationResult.data.ai_lead_at && isLeadStage(effectiveLeadStage)) {
    conversationUpdatePayload.ai_lead_at = new Date().toISOString();
  }

  // Branch state is owned by the resolved turn, not optional model JSON. This
  // prevents an exploratory cross-branch answer from permanently switching a
  // customer's selected branch.
  const branchIdToPersist = resolvedBranchSelectionId;
  if (
    branchIdToPersist &&
    allowedBranchIds.includes(branchIdToPersist) &&
    conversationResult.data.branch_id !== branchIdToPersist
  ) {
    conversationUpdatePayload.branch_id = branchIdToPersist;
  }

  const atomicTextItem =
    queueWhatsAppDelivery &&
    atomicWhatsAppTextPersistence &&
    sequence.length === 1 &&
    sequence[0]?.type === "text"
      ? sequence[0]
      : null;
  if (atomicTextItem) {
    const attachPendingMedia = response.pendingMedia !== null;
    const messageMetadata = {
      model,
      understanding: response.understanding,
      fallback_used: response.usedFallback,
      outbound_delivery: "whatsapp_outbox",
      ...(attachPendingMedia ? { pending_media: response.pendingMedia } : {}),
      ...(resolvedTurn
        ? {
            turn_context: {
              effective_branch_id: resolvedTurn.effectiveBranchId,
              is_temporary_branch: resolvedTurn.isTemporaryBranch,
              intent: resolvedTurn.intent,
              entity: resolvedTurn.entity,
            },
          }
        : {}),
    };
    const atomicStartedAt = performance.now();
    const supabase = await createServerSupabaseClient();
    const { data, error } = await supabase.rpc("persist_whatsapp_ai_text_reply", {
      p_conversation_id: conversationId,
      p_expected_updated_at: conversationResult.data.updated_at,
      p_latest_understanding: conversationUpdatePayload.latest_understanding ?? null,
      p_update_customer_memory: Object.prototype.hasOwnProperty.call(
        conversationUpdatePayload,
        "customer_memory",
      ),
      p_customer_memory: conversationUpdatePayload.customer_memory ?? null,
      p_lead_stage: conversationUpdatePayload.lead_stage ?? null,
      p_ai_lead_at: conversationUpdatePayload.ai_lead_at ?? null,
      p_update_branch: Object.prototype.hasOwnProperty.call(
        conversationUpdatePayload,
        "branch_id",
      ),
      p_branch_id: conversationUpdatePayload.branch_id ?? null,
      p_last_message_at: conversationUpdatePayload.last_message_at,
      p_content: atomicTextItem.text,
      p_metadata: messageMetadata,
    });
    const atomicMs = elapsedMs(atomicStartedAt);
    const row = Array.isArray(data) ? data[0] : null;
    if (error || !row) {
      return {
        saved: false,
        error: `Failed to persist atomic AI reply: ${error?.message ?? "No result returned."}`,
      };
    }
    if (row.outcome === "conflict" && concurrencyRetryCount < 1) {
      return saveAIReply(
        conversationId,
        response,
        model,
        availableMedia,
        allowedBranchIds,
        resolvedBranchSelectionId,
        resolvedTurn,
        queueWhatsAppDelivery,
        atomicWhatsAppTextPersistence,
        concurrencyRetryCount + 1,
        priorAttemptMs + elapsedMs(totalStartedAt),
        smsInboundReplyToMessageId,
      );
    }
    if (row.outcome !== "saved" || !row.message_row) {
      return {
        saved: false,
        error:
          row.outcome === "conflict"
            ? "Conversation changed while saving the AI reply."
            : "Conversation was unavailable while saving the AI reply.",
      };
    }
    const savedMessage = row.message_row as Message;
    logPerformance("ai.reply_persistence", {
      conversation_load_ms: conversationLoadMs,
      memory_merge_ms: memoryMergeMs,
      conversation_update_ms: Number(row.conversation_update_ms ?? 0),
      message_insert_ms: Number(row.message_insert_ms ?? 0),
      slowest_message_insert_ms: Number(row.message_insert_ms ?? 0),
      atomic_rpc_ms: atomicMs,
      message_insert_count: 1,
      queues_whatsapp_delivery: true,
      optimistic_retry_count: concurrencyRetryCount,
      round_trip_count: 2,
      total_ms: priorAttemptMs + elapsedMs(totalStartedAt),
    });
    return {
      saved: true,
      error: null,
      messageId: savedMessage.id,
      messages: [savedMessage],
    };
  }

  const conversationUpdateStartedAt = performance.now();
  const preSaveConversationUpdate = await updateConversation(
    conversationId,
    conversationUpdatePayload,
  );
  const conversationUpdateMs = elapsedMs(conversationUpdateStartedAt);

  if (preSaveConversationUpdate.error) {
    return {
      saved: false,
      error: `Failed to update understanding before saving reply: ${preSaveConversationUpdate.error}`,
    };
  }

  // SMS is text-only in Phase 3. Collapse all supported text parts into one
  // canonical message/outbox item and make omitted media auditable. This avoids
  // claiming an image/document was delivered while preserving useful text.
  if (smsInboundReplyToMessageId) {
    const sequenceText = sequence
      .filter(
        (item): item is Extract<(typeof sequence)[number], { type: "text" }> =>
          item.type === "text",
      )
      .map((item) => item.text.trim())
      .filter(Boolean);
    const textParts =
      sequenceText.length > 0
        ? sequenceText
        : response.text.trim()
          ? [response.text.trim()]
          : [];
    if (textParts.length === 0) {
      return { saved: false, error: "SMS AI reply produced no text content." };
    }
    const unsupportedMediaCount = sequence.filter(
      (item) => item.type !== "text",
    ).length;
    const messageInsertStartedAt = performance.now();
    const result = await createMessage({
      conversation_id: conversationId,
      sender_type: "ai",
      message_type: "text",
      sms_inbound_reply_to_message_id: smsInboundReplyToMessageId,
      content: textParts.join("\n\n"),
      metadata: {
        model,
        understanding: response.understanding,
        fallback_used: response.usedFallback,
        sms_text_part_count: textParts.length,
        sms_unsupported_media_count: unsupportedMediaCount,
        ...(resolvedTurn
          ? {
              turn_context: {
                effective_branch_id: resolvedTurn.effectiveBranchId,
                is_temporary_branch: resolvedTurn.isTemporaryBranch,
                intent: resolvedTurn.intent,
                entity: resolvedTurn.entity,
              },
            }
          : {}),
      },
    });
    if (result.error || !result.data) {
      return {
        saved: false,
        error: `Failed to save SMS AI reply: ${result.error ?? "No message returned."}`,
      };
    }
    const messageInsertMs = elapsedMs(messageInsertStartedAt);
    logPerformance("ai.reply_persistence", {
      conversation_load_ms: conversationLoadMs,
      memory_merge_ms: memoryMergeMs,
      conversation_update_ms: conversationUpdateMs,
      message_insert_ms: messageInsertMs,
      slowest_message_insert_ms: messageInsertMs,
      message_insert_count: 1,
      queues_whatsapp_delivery: false,
      queues_sms_delivery: true,
      sms_unsupported_media_count: unsupportedMediaCount,
      atomic_rpc_ms: 0,
      optimistic_retry_count: concurrencyRetryCount,
      round_trip_count: 3,
      total_ms: priorAttemptMs + elapsedMs(totalStartedAt),
    });
    return {
      saved: true,
      error: null,
      messageId: result.data.id,
      messages: [result.data],
    };
  }

  // Persist one deterministic channel-neutral sequence. Unknown assets are ignored.
  const savedMessages: Message[] = [];
  let pendingMediaAttached = false;
  let messageInsertMs = 0;
  let slowestMessageInsertMs = 0;
  for (const item of sequence) {
    const isText = item.type === "text";
    const asset = !isText ? mediaById.get(item.assetId) : null;
    if (!isText && (!asset || asset.media_type !== "photo")) continue;
    const attachPendingMedia =
      isText && response.pendingMedia !== null && !pendingMediaAttached;
    const messageInsertStartedAt = performance.now();
    const result = await createMessage({
      conversation_id: conversationId,
      sender_type: "ai",
      message_type: isText ? "text" : "image",
      ...(savedMessages.length === 0 && smsInboundReplyToMessageId
        ? { sms_inbound_reply_to_message_id: smsInboundReplyToMessageId }
        : {}),
      content: isText ? item.text : (item.caption ?? asset!.title),
      metadata: isText
        ? {
            model,
            understanding: response.understanding,
            fallback_used: response.usedFallback,
            ...(queueWhatsAppDelivery ? { outbound_delivery: "whatsapp_outbox" } : {}),
            ...(attachPendingMedia ? { pending_media: response.pendingMedia } : {}),
            ...(isText && resolvedTurn
              ? {
                  turn_context: {
                    effective_branch_id: resolvedTurn.effectiveBranchId,
                    is_temporary_branch: resolvedTurn.isTemporaryBranch,
                    intent: resolvedTurn.intent,
                    entity: resolvedTurn.entity,
                  },
                }
              : {}),
          }
        : {
            media_asset_id: asset!.id,
            media_url: asset!.media_url,
            title: asset!.title,
            model,
            ...(queueWhatsAppDelivery ? { outbound_delivery: "whatsapp_outbox" } : {}),
          },
    });
    const currentMessageInsertMs = elapsedMs(messageInsertStartedAt);
    messageInsertMs += currentMessageInsertMs;
    slowestMessageInsertMs = Math.max(slowestMessageInsertMs, currentMessageInsertMs);
    if (result.error)
      return {
        saved: false,
        error: `Failed to save AI sequence message: ${result.error}`,
      };
    savedMessages.push(result.data!);
    if (attachPendingMedia) pendingMediaAttached = true;
  }
  if (savedMessages.length === 0)
    return { saved: false, error: "AI reply produced no deliverable messages." };

  logPerformance("ai.reply_persistence", {
    conversation_load_ms: conversationLoadMs,
    memory_merge_ms: memoryMergeMs,
    conversation_update_ms: conversationUpdateMs,
    message_insert_ms: Math.round(messageInsertMs * 10) / 10,
    slowest_message_insert_ms: slowestMessageInsertMs,
    message_insert_count: savedMessages.length,
    queues_whatsapp_delivery: queueWhatsAppDelivery,
    atomic_rpc_ms: 0,
    optimistic_retry_count: concurrencyRetryCount,
    round_trip_count: 2 + savedMessages.length,
    total_ms: priorAttemptMs + elapsedMs(totalStartedAt),
  });

  return {
    saved: true,
    error: null,
    messageId: savedMessages[0]!.id,
    messages: savedMessages,
  };
}
