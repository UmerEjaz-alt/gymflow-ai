"use server";

import {
  getInboxThreadSnapshot,
  sendOwnerWhatsAppMessage,
  setOwnerConversationControl,
} from "@/services/conversation-control.server";

export async function takeOverConversation(conversationId: string) {
  return setOwnerConversationControl(conversationId, true);
}

export async function returnConversationToAI(conversationId: string) {
  return setOwnerConversationControl(conversationId, false);
}

export async function sendOwnerMessage(
  conversationId: string,
  text: string,
  clientRequestId: string,
) {
  return sendOwnerWhatsAppMessage(conversationId, text, clientRequestId);
}

export async function refreshInboxThread(conversationId: string) {
  return getInboxThreadSnapshot(conversationId);
}
