import type { Conversation } from "@/types/conversation";

/** Missing epochs are legacy version zero, never the freshly reloaded epoch. */
export function controlVersion(conversation: Pick<Conversation, "control_version">) {
  return conversation.control_version ?? 0;
}

export function aiControlMatches(
  conversation: Pick<Conversation, "status" | "ai_enabled" | "control_version">,
  expectedVersion: number,
  automation = false,
) {
  return (
    conversation.status === "active" &&
    (conversation.ai_enabled || automation) &&
    controlVersion(conversation) === expectedVersion
  );
}

export const OWNER_TEXT_LIMIT = 4096;
export function validateOwnerText(text: unknown): string | null {
  if (typeof text !== "string" || !text.trim()) return "Enter a message to send.";
  if ([...text.trim()].length > OWNER_TEXT_LIMIT)
    return "Keep your message to 4,096 characters or fewer.";
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(text))
    return "The message contains unsupported characters.";
  return null;
}

export function isUuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
  );
}
