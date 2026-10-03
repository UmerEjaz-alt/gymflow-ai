import "server-only";

import { createServerSupabaseClient } from "@/lib/supabase/server";
import { runWithSystemSupabase } from "@/lib/supabase/request-context";
import { resolveActiveBranch } from "@/lib/active-branch.server";
import { conversationMatchesScope } from "@/lib/conversation-message-query";
import { controlVersion, isUuid, validateOwnerText } from "@/lib/conversation-control";
import { getConversation } from "@/services/conversation.server";
import { listRecentMessages } from "@/services/message.server";
import { deliverWhatsAppMessage } from "@/services/whatsapp-outbox.server";
import type { Conversation } from "@/types/conversation";
import type { Message } from "@/types/message";

export type InboxThreadSnapshot = {
  conversation: Conversation;
  messages: Message[];
  ownerSendAllowed: boolean;
  ownerSendExplanation: string | null;
};
export type OwnerMessageResult = {
  message?: Message;
  error?: string;
  notice?: string;
};

async function authorizeConversation(id: string) {
  if (!isUuid(id)) throw new Error("Conversation not found.");
  const client = await createServerSupabaseClient();
  const {
    data: { user },
  } = await client.auth.getUser();
  if (!user) throw new Error("Sign in again to manage this conversation.");
  const scope = await resolveActiveBranch();
  if (scope.error || !scope.gym)
    throw new Error("Your gym or branch could not be verified.");
  const result = await getConversation(id);
  const branchId = scope.isUnassigned ? null : scope.branch.id;
  if (!result.data || !conversationMatchesScope(result.data, scope.gym.id, branchId)) {
    throw new Error("Conversation is outside the active gym or branch.");
  }
  if (result.data.source !== "whatsapp")
    throw new Error("This action is available only for WhatsApp conversations.");
  return { client, conversation: result.data, gymId: scope.gym.id, branchId };
}

function publicError(error: unknown) {
  return error instanceof Error
    ? error.message
    : "The request could not be completed. Refresh and try again.";
}

export async function setOwnerConversationControl(id: string, takeOver: boolean) {
  try {
    const authorized = await authorizeConversation(id);
    const { data, error } = await authorized.client.rpc(
      "set_owner_conversation_control",
      {
        p_conversation_id: id,
        p_gym_id: authorized.gymId,
        p_branch_id: authorized.branchId,
        p_take_over: takeOver,
      },
    );
    if (error) throw new Error(error.message);
    return {
      conversation: data.conversation as Conversation,
      notice: data.notice as string | null,
    };
  } catch (error) {
    return { error: publicError(error) };
  }
}

export async function sendOwnerWhatsAppMessage(
  conversationId: string,
  text: string,
  clientRequestId: string,
): Promise<OwnerMessageResult> {
  let persisted: Message | undefined;
  try {
    const textError = validateOwnerText(text);
    if (textError) throw new Error(textError);
    if (!isUuid(clientRequestId))
      throw new Error("Invalid message request. Refresh and try again.");
    const authorized = await authorizeConversation(conversationId);
    const { data, error } = await authorized.client.rpc(
      "persist_owner_whatsapp_message",
      {
        p_conversation_id: conversationId,
        p_gym_id: authorized.gymId,
        p_branch_id: authorized.branchId,
        p_expected_control_version: controlVersion(authorized.conversation),
        p_text: text.trim(),
        p_client_request_id: clientRequestId,
      },
    );
    if (error) throw new Error(error.message);
    persisted = data as Message;
    // Escalate only the already-authorized, database-derived message identity.
    const state = await runWithSystemSupabase(async () => {
      await deliverWhatsAppMessage(persisted!.id, persisted);
      const system = await createServerSupabaseClient();
      const row = await system
        .from("whatsapp_outbound_deliveries")
        .select("status,retryable")
        .eq("message_id", persisted!.id)
        .single();
      if (row.error)
        throw new Error(
          "Message saved, but its send status could not be confirmed. Refresh before retrying.",
        );
      return row.data;
    });
    persisted.owner_delivery_state =
      state.status === "sent"
        ? "sent"
        : state.status === "uncertain" || state.status === "sending"
          ? "unconfirmed"
          : state.status === "failed" && !state.retryable
            ? "failed"
            : "pending";
    return {
      message: persisted,
      notice:
        persisted.owner_delivery_state === "unconfirmed"
          ? "Your message may have been sent. Do not send it again until its status is confirmed."
          : persisted.owner_delivery_state === "failed"
            ? "Your message could not be sent. Check the WhatsApp connection and reply window."
            : undefined,
    };
  } catch (error) {
    return { ...(persisted ? { message: persisted } : {}), error: publicError(error) };
  }
}

/** Bounded selected-thread refresh. Privileged delivery fields never bypass scope authorization. */
export async function getInboxThreadSnapshot(
  id: string,
): Promise<{ data?: InboxThreadSnapshot; error?: string }> {
  try {
    const authorized = await authorizeConversation(id);
    const messages = await listRecentMessages(id, 100);
    if (messages.error) throw new Error(messages.error);
    const threadMessages = messages.data ?? [];
    const projected = await runWithSystemSupabase(async () => {
      const system = await createServerSupabaseClient();
      const window = await system.rpc("whatsapp_customer_window_open", {
        p_conversation_id: id,
      });
      if (window.error)
        throw new Error("WhatsApp reply availability could not be checked.");
      const ids = threadMessages
        .filter((m) => m.sender_type === "human")
        .map((m) => m.id);
      const deliveries = ids.length
        ? await system
            .from("whatsapp_outbound_deliveries")
            .select("message_id,status,retryable")
            .eq("conversation_id", id)
            .in("message_id", ids)
        : null;
      if (deliveries?.error)
        throw new Error("Message send status could not be refreshed.");
      const byMessage = new Map((deliveries?.data ?? []).map((d) => [d.message_id, d]));
      const endpoint = authorized.conversation.whatsapp_endpoint_id
        ? await system
            .from("whatsapp_endpoints")
            .select("id")
            .eq("id", authorized.conversation.whatsapp_endpoint_id)
            .eq("gym_id", authorized.gymId)
            .eq("is_active", true)
            .not("phone_number_id", "is", null)
            .maybeSingle()
        : null;
      const explanation = !window.data
        ? "WhatsApp replies are available for 24 hours after the latest customer message. Wait for a new message to reply."
        : !endpoint?.data
          ? "The original WhatsApp number is unavailable. Check your WhatsApp connection."
          : null;
      return {
        explanation,
        messages: threadMessages.map((m) => {
          if (m.sender_type !== "human") return m;
          const d = byMessage.get(m.id);
          const owner_delivery_state: Message["owner_delivery_state"] = !d
            ? "unconfirmed"
            : d.status === "sent"
              ? "sent"
              : d.status === "uncertain" || d.status === "sending"
                ? "unconfirmed"
                : d.status === "failed" && !d.retryable
                  ? "failed"
                  : "pending";
          return { ...m, owner_delivery_state };
        }),
      };
    });
    return {
      data: {
        conversation: authorized.conversation,
        messages: projected.messages,
        ownerSendAllowed:
          authorized.conversation.status === "human" && !projected.explanation,
        ownerSendExplanation: projected.explanation,
      },
    };
  } catch (error) {
    return { error: publicError(error) };
  }
}
