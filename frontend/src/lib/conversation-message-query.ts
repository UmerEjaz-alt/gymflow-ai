import type { Conversation } from "@/types/conversation";
import type { Message } from "@/types/message";

type EmbeddedConversation = Conversation & { messages?: Message[] | null };

/** Keeps one correctly associated newest-message preview per conversation row. */
export function normalizeConversationMessagePreviews(
  rows: readonly EmbeddedConversation[],
): Array<Conversation & { messages: Message[] }> {
  return rows.map((row) => ({
    ...row,
    messages: (row.messages ?? [])
      .filter((message) => message.conversation_id === row.id)
      .slice(0, 1),
  }));
}

/** Explicit application-layer guard in addition to database RLS. */
export function conversationMatchesScope(
  conversation: Pick<Conversation, "gym_id" | "branch_id">,
  gymId: string,
  branchId: string | null,
): boolean {
  return conversation.gym_id === gymId && conversation.branch_id === branchId;
}

/** Replaces only the selected conversation's history with associated messages. */
export function replaceConversationMessages<
  T extends Conversation & { messages: Message[] },
>(rows: readonly T[], conversationId: string, messages: readonly Message[]): T[] {
  const associated = messages.filter(
    (message) => message.conversation_id === conversationId,
  );
  return rows.map((row) =>
    row.id === conversationId ? { ...row, messages: [...associated] } : row,
  );
}
