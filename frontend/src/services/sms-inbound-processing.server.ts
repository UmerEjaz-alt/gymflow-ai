import "server-only";

import { createServerSupabaseClient } from "@/lib/supabase/server";
import { processIncomingConversationTurn } from "@/services/conversation-turn.server";
import type { ConversationContext } from "@/services/conversation-manager.server";
import type { Conversation } from "@/types/conversation";
import type { Message } from "@/types/message";

type ProcessingRow = {
  id: string;
  gym_id: string;
  conversation_id: string;
  message_id: string;
  status: "processing";
  attempt_count: number;
  max_attempts: number;
  claim_token: string;
  lease_expires_at: string;
};

type ClaimedSmsWork = {
  processing: ProcessingRow;
  conversation: Conversation;
  message: Message;
  recentMessages: Message[];
};

export type SmsProcessingOutcome =
  | "completed"
  | "failed"
  | "dead"
  | "skipped"
  | "deferred";

async function claimSmsInboundWork(
  messageId?: string,
): Promise<ClaimedSmsWork | null> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc("claim_sms_inbound_processing", {
    p_message_id: messageId ?? null,
    p_lease_seconds: 600,
  });
  if (error) throw new Error(`SMS processing claim failed: ${error.message}`);
  const row = Array.isArray(data) ? data[0] : null;
  if (!row) return null;
  return {
    processing: row.processing_row as ProcessingRow,
    conversation: row.conversation_row as Conversation,
    message: row.message_row as Message,
    recentMessages: Array.isArray(row.recent_messages)
      ? (row.recent_messages as Message[])
      : [],
  };
}

async function finishClaim(
  claim: ClaimedSmsWork,
  responseMessageId: string | null,
): Promise<boolean> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc("complete_sms_inbound_processing", {
    p_processing_id: claim.processing.id,
    p_claim_token: claim.processing.claim_token,
    p_response_message_id: responseMessageId,
  });
  if (error) throw new Error(`SMS processing completion failed: ${error.message}`);
  return data === true;
}

async function skipClaim(
  claim: ClaimedSmsWork,
  reason: string,
): Promise<boolean> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc("skip_sms_inbound_processing", {
    p_processing_id: claim.processing.id,
    p_claim_token: claim.processing.claim_token,
    p_reason: reason,
  });
  if (error) throw new Error(`SMS processing skip failed: ${error.message}`);
  return data === true;
}

async function failClaim(
  claim: ClaimedSmsWork,
  errorMessage: string,
): Promise<"failed" | "dead" | "deferred"> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc("fail_sms_inbound_processing", {
    p_processing_id: claim.processing.id,
    p_claim_token: claim.processing.claim_token,
    p_error: errorMessage,
  });
  if (error) throw new Error(`SMS processing failure update failed: ${error.message}`);
  return data === "failed" || data === "dead" ? data : "deferred";
}

async function processClaimedSmsWork(
  claim: ClaimedSmsWork,
): Promise<SmsProcessingOutcome> {
  // Re-check mutable conversation controls after claiming. A conversation may
  // have entered human/closed/disabled mode while the job was waiting.
  if (claim.conversation.status !== "active" || !claim.conversation.ai_enabled) {
    const reason =
      claim.conversation.status === "human"
        ? "human_takeover"
        : claim.conversation.status === "closed"
          ? "conversation_closed"
          : "ai_disabled";
    return (await skipClaim(claim, reason)) ? "skipped" : "deferred";
  }

  const context: ConversationContext = {
    conversation: claim.conversation,
    latestMessages: claim.recentMessages,
    shouldCallAI: true,
    humanTakeover: false,
    leadStage: claim.conversation.lead_stage,
    status: claim.conversation.status,
    latestCustomerMessage: claim.message,
  };

  try {
    const turn = await processIncomingConversationTurn(
      {
        gymId: claim.conversation.gym_id,
        smsEndpointId: claim.conversation.sms_endpoint_id ?? null,
        branchId: claim.conversation.branch_id,
        customerPhone: claim.conversation.customer_phone,
        customerName: claim.conversation.customer_name,
        source: "sms",
        messageType: claim.message.message_type,
        content: claim.message.content,
        smsProvider: claim.message.sms_provider ?? null,
        smsMessageId: claim.message.sms_message_id ?? null,
        metadata: claim.message.metadata,
      },
      context,
    );

    if (turn.error) return failClaim(claim, turn.error);
    return (await finishClaim(claim, turn.aiMessage?.id ?? null))
      ? "completed"
      : "deferred";
  } catch (error) {
    return failClaim(
      claim,
      error instanceof Error ? error.message : "SMS AI processing failed.",
    );
  }
}

/** Claims and processes one exact inbound message when it is due. */
export async function processSmsInboundWork(
  messageId: string,
): Promise<SmsProcessingOutcome> {
  const claim = await claimSmsInboundWork(messageId);
  return claim ? processClaimedSmsWork(claim) : "deferred";
}

/** Bounded maintenance recovery; each loop atomically claims one due job. */
export async function recoverSmsInboundProcessing(
  limit = 5,
): Promise<Record<SmsProcessingOutcome, number>> {
  const boundedLimit = Math.max(1, Math.min(25, Math.floor(limit)));
  const counts: Record<SmsProcessingOutcome, number> = {
    completed: 0,
    failed: 0,
    dead: 0,
    skipped: 0,
    deferred: 0,
  };
  for (let index = 0; index < boundedLimit; index += 1) {
    const claim = await claimSmsInboundWork();
    if (!claim) break;
    const outcome = await processClaimedSmsWork(claim);
    counts[outcome] += 1;
  }
  return counts;
}
