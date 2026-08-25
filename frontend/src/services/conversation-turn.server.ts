/**
 * Channel-neutral conversation turn processor.
 *
 * Channel adapters normalize an inbound message, then call this service. It
 * persists the customer message, runs the established AI pipeline, and saves
 * the approved reply. Delivery remains the responsibility of the adapter.
 */

import type { IncomingMessageEvent } from "@/services/conversation-manager.server";
import { handleIncomingMessage } from "@/services/conversation-manager.server";
import { generateValidatedReply } from "@/services/ai-pipeline.server";
import { saveAIReply } from "@/services/conversation-reply.server";
import { getMessageByWhatsAppMessageId, listMessages } from "@/services/message.server";
import type { Message } from "@/types/message";

export type ProcessConversationTurnResult = {
  customerMessage: Message | null;
  aiMessage: Message | null;
  action: string;
  error: string | null;
};

export async function processIncomingConversationTurn(
  event: IncomingMessageEvent,
): Promise<ProcessConversationTurnResult> {
  if (event.whatsappMessageId) {
    const existing = await getMessageByWhatsAppMessageId(event.whatsappMessageId);
    if (existing.error) {
      return {
        customerMessage: null,
        aiMessage: null,
        action: "error",
        error: `Webhook idempotency lookup failed: ${existing.error}`,
      };
    }
    if (existing.data) {
      return {
        customerMessage: existing.data,
        aiMessage: null,
        action: "duplicate",
        error: null,
      };
    }
  }

  const managerResult = await handleIncomingMessage(event);
  if (managerResult.error || !managerResult.data) {
    return {
      customerMessage: null,
      aiMessage: null,
      action: "error",
      error: `Conversation manager failed: ${managerResult.error ?? "Unknown error."}`,
    };
  }

  const context = managerResult.data;

  try {
    const pipelineResult = await generateValidatedReply(context);
    if (
      pipelineResult.action !== "knowledge_ready" ||
      !pipelineResult.validatedResponse
    ) {
      return {
        customerMessage: context.latestCustomerMessage,
        aiMessage: null,
        action: pipelineResult.action,
        error: null,
      };
    }

    const saveResult = await saveAIReply(
      context.conversation.id,
      pipelineResult.validatedResponse,
      pipelineResult.aiResponse?.model ?? "unknown",
      pipelineResult.knowledge?.media ?? [],
      pipelineResult.knowledge?.allBranches?.map((branch) => branch.id) ?? [],
    );

    if (!saveResult.saved) {
      return {
        customerMessage: context.latestCustomerMessage,
        aiMessage: null,
        action: pipelineResult.action,
        error: saveResult.error ?? "The AI reply was not saved.",
      };
    }

    // saveAIReply has just created one AI message. Read it through the
    // existing message service only when a channel needs to render/deliver it.
    const messagesResult = await listMessages(context.conversation.id);
    if (messagesResult.error) {
      return {
        customerMessage: context.latestCustomerMessage,
        aiMessage: null,
        action: pipelineResult.action,
        error: `Reply saved but could not be loaded: ${messagesResult.error}`,
      };
    }

    const aiMessage =
      [...messagesResult.data!]
        .reverse()
        .find((message) => message.sender_type === "ai") ?? null;

    return {
      customerMessage: context.latestCustomerMessage,
      aiMessage,
      action: pipelineResult.action,
      error: null,
    };
  } catch (error) {
    return {
      customerMessage: context.latestCustomerMessage,
      aiMessage: null,
      action: "error",
      error:
        error instanceof Error
          ? `AI pipeline error: ${error.message}`
          : "AI pipeline error.",
    };
  }
}
