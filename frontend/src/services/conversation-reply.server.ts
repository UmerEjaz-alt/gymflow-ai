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
import type { UpdateConversationPayload } from "@/types/conversation";
import { mergeConversationMemory } from "@/services/memory-extractor.server";
import { getConversation, updateConversation } from "@/services/conversation.server";
import { createMessage } from "@/services/message.server";
import type { MediaAsset } from "@/types/media-asset";

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
): Promise<SaveAIReplyResult> {
  // Guard: skip unapproved responses without writing anything
  if (!response.approved) {
    return { saved: false, error: null };
  }

  // Step 1: load conversation for memory merge
  const conversationResult = await getConversation(conversationId);
  if (conversationResult.error || !conversationResult.data) {
    return {
      saved: false,
      error: `Failed to load conversation for reply save: ${conversationResult.error ?? "Conversation not found."}`,
    };
  }

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

  if (
    response.selectedBranchId &&
    allowedBranchIds.includes(response.selectedBranchId) &&
    conversationResult.data.branch_id !== response.selectedBranchId
  ) {
    conversationUpdatePayload.branch_id = response.selectedBranchId;
  }

  const preSaveConversationUpdate = await updateConversation(
    conversationId,
    conversationUpdatePayload,
  );

  if (preSaveConversationUpdate.error) {
    return {
      saved: false,
      error: `Failed to update understanding before saving reply: ${preSaveConversationUpdate.error}`,
    };
  }

  // Step 2: persist the AI message
  const messageResult = await createMessage({
    conversation_id: conversationId,
    sender_type: "ai",
    message_type: "text",
    content: response.text,
    metadata: {
      model,
      understanding: response.understanding,
      fallback_used: response.usedFallback,
    },
  });

  if (messageResult.error) {
    return { saved: false, error: `Failed to save AI message: ${messageResult.error}` };
  }

  // The AI can only reference asset IDs provided by this gym's knowledge
  // context. Unknown IDs are ignored, preventing arbitrary media injection.
  const mediaById = new Map(availableMedia.map((asset) => [asset.id, asset]));
  for (const action of response.mediaActions) {
    const asset = mediaById.get(action.assetId);
    if (!asset) continue;
    const mediaType =
      asset.media_type === "photo"
        ? "image"
        : asset.media_type === "video"
          ? "video"
          : "document";
    const mediaResult = await createMessage({
      conversation_id: conversationId,
      sender_type: "ai",
      message_type: mediaType,
      content: action.caption ?? asset.title,
      metadata: {
        media_asset_id: asset.id,
        media_url: asset.media_url,
        title: asset.title,
        model,
      },
    });
    if (mediaResult.error) {
      return {
        saved: false,
        error: `AI reply saved but media could not be saved: ${mediaResult.error}`,
      };
    }
  }

  return { saved: true, error: null, messageId: messageResult.data!.id };
}
