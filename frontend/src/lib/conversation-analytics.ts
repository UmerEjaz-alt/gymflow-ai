export type ConversationAnalyticsRow = {
  id: string;
  status: string;
};

export type ConversationAnalyticsMessageRow = {
  conversation_id: string;
  sender_type: string;
};

const ACTIVITY_SENDERS = new Set(["customer", "ai", "human"]);

/**
 * Conversation rows can exist before any communication occurs. Analytics only
 * treats persisted participant messages as genuine conversation activity.
 */
export function summarizeConversationActivity(
  conversations: ConversationAnalyticsRow[],
  messages: ConversationAnalyticsMessageRow[],
) {
  const conversationIdsWithActivity = new Set<string>();
  const aiConversationIds = new Set<string>();

  for (const message of messages) {
    if (!ACTIVITY_SENDERS.has(message.sender_type)) continue;
    conversationIdsWithActivity.add(message.conversation_id);
    if (message.sender_type === "ai") {
      aiConversationIds.add(message.conversation_id);
    }
  }

  let totalConversations = 0;
  let activeConversations = 0;
  let humanTakeovers = 0;

  for (const conversation of conversations) {
    if (!conversationIdsWithActivity.has(conversation.id)) continue;
    totalConversations += 1;
    if (conversation.status === "active") activeConversations += 1;
    if (conversation.status === "human") humanTakeovers += 1;
  }

  return {
    conversationIdsWithActivity,
    aiConversationIds,
    totalConversations,
    activeConversations,
    humanTakeovers,
    aiConversations: aiConversationIds.size,
  };
}
