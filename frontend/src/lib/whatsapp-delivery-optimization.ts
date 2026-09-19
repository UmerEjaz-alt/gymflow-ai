import type { Message } from "@/types/message";

type ClaimedDeliveryIdentity = {
  message_id: string;
  conversation_id: string;
};

/** Endpoint-backed inbound turns are already resolved by the durable queue trigger. */
export function requiresLegacyDeliveryPreparation(endpointId: string | null): boolean {
  return endpointId === null;
}

/**
 * Only reuse a row returned by the authoritative message INSERT for the exact
 * claimed delivery. Recovery and mismatched claims must reload durable state.
 */
export function isPersistedMessageForClaim(
  delivery: ClaimedDeliveryIdentity,
  message: Message | null | undefined,
): message is Message {
  return (
    message?.id === delivery.message_id &&
    message.conversation_id === delivery.conversation_id &&
    message.sender_type === "ai"
  );
}
