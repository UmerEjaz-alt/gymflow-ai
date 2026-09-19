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
): Promise<SaveAIReplyResult> {
  const totalStartedAt = performance.now();
  // Guard: skip unapproved responses without writing anything
  if (!response.approved) {
    return { saved: false, error: null };
  }

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

  // Persist one deterministic channel-neutral sequence. Unknown assets are ignored.
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
    total_ms: elapsedMs(totalStartedAt),
  });

  return {
    saved: true,
    error: null,
    messageId: savedMessages[0]!.id,
    messages: savedMessages,
  };
}
