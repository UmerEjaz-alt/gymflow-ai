import { resolveActiveBranch } from "@/lib/active-branch.server";
import { getConversation } from "@/services/conversation.server";
import { listMessages } from "@/services/message.server";
import type { Message } from "@/types/message";
import { conversationMatchesScope } from "@/lib/conversation-message-query";

type Result = { data: Message[]; error: null } | { data: null; error: string };

/** Loads a full history only when it belongs to the request's active gym/scope. */
export async function getActiveScopeConversationHistory(
  conversationId: string,
): Promise<Result> {
  const resolved = await resolveActiveBranch();
  if (resolved.error || !resolved.gym) {
    return { data: null, error: resolved.error ?? "Active branch was not resolved." };
  }

  const conversation = await getConversation(conversationId);
  if (
    conversation.error ||
    !conversation.data ||
    !conversationMatchesScope(
      conversation.data,
      resolved.gym.id,
      resolved.isUnassigned ? null : resolved.branch?.id,
    )
  ) {
    return { data: null, error: "Conversation is outside the active gym or branch." };
  }

  return listMessages(conversationId);
}
