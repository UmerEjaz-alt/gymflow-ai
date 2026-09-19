import "server-only";

import { createServerSupabaseClient } from "@/lib/supabase/server";
import {
  sendWhatsAppImage,
  sendWhatsAppText,
} from "@/services/whatsapp-cloud-api.server";
import type { Message } from "@/types/message";
import { failureDeliveryPatch } from "@/services/whatsapp-delivery-policy";
import { elapsedMs, logPerformance } from "@/lib/performance-log.server";
import { isPersistedMessageForClaim } from "@/lib/whatsapp-delivery-optimization";

type DeliveryRow = {
  id: string;
  message_id: string;
  conversation_id: string;
  phone_number_id: string | null;
  recipient_phone: string;
  status: "pending" | "processing" | "sending" | "sent" | "failed" | "uncertain";
  attempt_count: number;
  claim_token: string | null;
  lease_expires_at: string | null;
};

export type DeliveryOutcome =
  "sent" | "deferred" | "retryable_failure" | "failed" | "uncertain";

/** Supplies the trusted inbound destination for pre-endpoint legacy conversations. */
export async function prepareWhatsAppDelivery(
  messageId: string,
  phoneNumberId: string,
): Promise<void> {
  const startedAt = performance.now();
  const supabase = await createServerSupabaseClient();
  await supabase
    .from("whatsapp_outbound_deliveries")
    .update({
      phone_number_id: phoneNumberId,
      status: "pending",
      retryable: true,
      next_attempt_at: new Date().toISOString(),
      last_error: null,
      updated_at: new Date().toISOString(),
    })
    .eq("message_id", messageId)
    .is("phone_number_id", null)
    .is("whatsapp_endpoint_id", null);
  logPerformance("whatsapp.delivery_prepare", {
    total_ms: elapsedMs(startedAt),
  });
}

async function claimDelivery(input: {
  messageId?: string;
  conversationId?: string;
}): Promise<DeliveryRow | null> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc("claim_whatsapp_outbound_delivery", {
    p_message_id: input.messageId ?? null,
    p_conversation_id: input.conversationId ?? null,
  });
  if (error) throw new Error(`Outbound delivery claim failed: ${error.message}`);
  return (Array.isArray(data) ? data[0] : null) as DeliveryRow | null;
}

async function finishDelivery(
  delivery: DeliveryRow,
  patch: Record<string, unknown>,
  expectedStatus: "processing" | "sending" = "sending",
): Promise<boolean> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("whatsapp_outbound_deliveries")
    .update({
      ...patch,
      claim_token: null,
      lease_expires_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", delivery.id)
    .eq("status", expectedStatus)
    .eq("claim_token", delivery.claim_token)
    .select("id")
    .maybeSingle();
  if (error) throw new Error(`Outbound delivery completion failed: ${error.message}`);
  return Boolean(data);
}

async function beginDeliverySend(delivery: DeliveryRow): Promise<boolean> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc("begin_whatsapp_outbound_send", {
    p_delivery_id: delivery.id,
    p_claim_token: delivery.claim_token,
  });
  if (error) throw new Error(`Outbound send boundary failed: ${error.message}`);
  return data === true;
}

async function finalizeSuccessfulDelivery(
  delivery: DeliveryRow,
  metaMessageId: string,
  deliveredAt: string,
): Promise<boolean> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc("finalize_whatsapp_outbound_delivery", {
    p_delivery_id: delivery.id,
    p_claim_token: delivery.claim_token,
    p_meta_message_id: metaMessageId,
    p_sent_at: deliveredAt,
  });
  if (error) throw new Error(`Outbound delivery finalization failed: ${error.message}`);
  return data === true;
}

async function deliverClaim(
  delivery: DeliveryRow,
  persistedMessage?: Message,
): Promise<DeliveryOutcome> {
  const messageLoadStartedAt = performance.now();
  const reusableMessage = isPersistedMessageForClaim(delivery, persistedMessage)
    ? persistedMessage
    : null;
  let data: Message | null = reusableMessage;
  let messageLoadError: string | null = null;
  if (!data) {
    const supabase = await createServerSupabaseClient();
    const result = await supabase
      .from("messages")
      .select("*")
      .eq("id", delivery.message_id)
      .maybeSingle();
    data = result.data as Message | null;
    messageLoadError = result.error?.message ?? null;
  }
  logPerformance("whatsapp.delivery_message_load", {
    found: Boolean(data),
    reused_persisted_message: Boolean(reusableMessage),
    total_ms: elapsedMs(messageLoadStartedAt),
  });
  if (messageLoadError || !data || !delivery.phone_number_id) {
    const failureFinalizeStartedAt = performance.now();
    await finishDelivery(
      delivery,
      {
        status: "failed",
        retryable: false,
        last_error:
          messageLoadError ?? "Outbound message or destination is unavailable.",
      },
      "processing",
    );
    logPerformance("whatsapp.delivery_finalize", {
      outcome: "failed_before_send",
      total_ms: elapsedMs(failureFinalizeStartedAt),
    });
    return "failed";
  }

  const message = data;
  const phoneNumberId = delivery.phone_number_id;
  const imageUrl =
    typeof message.metadata?.media_url === "string" ? message.metadata.media_url : null;
  const send =
    message.message_type === "image" && imageUrl
      ? () =>
          sendWhatsAppImage({
            phoneNumberId,
            to: delivery.recipient_phone,
            imageUrl,
            caption: message.content,
          })
      : message.message_type === "text"
        ? () =>
            sendWhatsAppText({
              phoneNumberId,
              to: delivery.recipient_phone,
              body: message.content,
            })
        : null;

  if (!send) {
    const unsupportedFinalizeStartedAt = performance.now();
    await finishDelivery(
      delivery,
      {
        status: "failed",
        retryable: false,
        last_error: `Unsupported outbound message type: ${message.message_type}`,
      },
      "processing",
    );
    logPerformance("whatsapp.delivery_finalize", {
      outcome: "unsupported_message",
      total_ms: elapsedMs(unsupportedFinalizeStartedAt),
    });
    return "failed";
  }

  // This durable transition is the external-side-effect boundary. Expired
  // `processing` work is safe to reclaim; expired `sending` work is quarantined
  // as uncertain because Meta may already have accepted it.
  const sendBoundaryStartedAt = performance.now();
  const beganSending = await beginDeliverySend(delivery);
  logPerformance("whatsapp.delivery_send_boundary", {
    transitioned: beganSending,
    total_ms: elapsedMs(sendBoundaryStartedAt),
  });
  if (!beganSending) return "deferred";
  const metaSendStartedAt = performance.now();
  const result = await send();
  logPerformance("whatsapp.meta_send", {
    message_type: message.message_type,
    accepted: Boolean(result.data),
    delivery_ms: elapsedMs(metaSendStartedAt),
  });

  if (!result.data) {
    const failure = failureDeliveryPatch(result, delivery.attempt_count);
    const { outcome, ...patch } = failure;
    const failureFinalizeStartedAt = performance.now();
    await finishDelivery(delivery, patch);
    logPerformance("whatsapp.delivery_finalize", {
      outcome,
      total_ms: elapsedMs(failureFinalizeStartedAt),
    });
    return outcome;
  }

  const metaMessageId = result.data.whatsappMessageId;
  const deliveredAt = new Date().toISOString();
  const finalizeStartedAt = performance.now();
  let completed = false;
  try {
    completed = await finalizeSuccessfulDelivery(delivery, metaMessageId, deliveredAt);
  } catch (error) {
    // Meta accepted the request. A failed/ambiguous database response must
    // never cause a blind resend; leave the sending lease for reconciliation.
    console.error("[WhatsApp outbox] accepted send could not be finalized", {
      deliveryId: delivery.id,
      messageId: delivery.message_id,
      error: error instanceof Error ? error.message : "Unknown finalization error.",
    });
  }
  const finalizeMs = elapsedMs(finalizeStartedAt);
  logPerformance("whatsapp.delivery_finalize", {
    outcome: completed ? "sent" : "uncertain",
    message_mirror_atomic: true,
    total_ms: finalizeMs,
  });
  logPerformance("whatsapp.delivery_message_mirror", {
    saved: completed,
    atomic_with_finalize: true,
    total_ms: 0,
  });
  if (!completed) {
    // Do not resend an accepted Meta request. The sending row is intentionally
    // left for operator reconciliation rather than risking duplicate delivery.
    console.error(
      "[WhatsApp outbox] Meta accepted a send but state was not finalized",
      {
        deliveryId: delivery.id,
        messageId: delivery.message_id,
      },
    );
    return "uncertain";
  }

  return "sent";
}

export async function deliverWhatsAppMessage(
  messageId: string,
  persistedMessage?: Message,
): Promise<DeliveryOutcome> {
  const totalStartedAt = performance.now();
  const claimStartedAt = performance.now();
  const claim = await claimDelivery({ messageId });
  const claimMs = elapsedMs(claimStartedAt);
  const outcome = claim ? await deliverClaim(claim, persistedMessage) : "deferred";
  logPerformance("whatsapp.delivery", {
    claim_ms: claimMs,
    outcome,
    total_ms: elapsedMs(totalStartedAt),
  });
  return outcome;
}

export async function recoverWhatsAppDeliveries(
  limit = 25,
  conversationId?: string,
): Promise<{ sent: number; failed: number; uncertain: number }> {
  const counts = { sent: 0, failed: 0, uncertain: 0 };
  for (let index = 0; index < limit; index += 1) {
    const claim = await claimDelivery({ conversationId });
    if (!claim) break;
    const outcome = await deliverClaim(claim);
    if (outcome === "sent") counts.sent += 1;
    else if (outcome === "uncertain") counts.uncertain += 1;
    else counts.failed += 1;
  }
  return counts;
}

export async function hasRecoverableWhatsAppDeliveries(
  conversationId: string,
): Promise<boolean> {
  const supabase = await createServerSupabaseClient();
  const { count, error } = await supabase
    .from("whatsapp_outbound_deliveries")
    .select("id", { count: "exact", head: true })
    .eq("conversation_id", conversationId)
    .eq("retryable", true)
    .in("status", ["pending", "failed"]);
  if (error) throw new Error(`Outbound recovery lookup failed: ${error.message}`);
  return (count ?? 0) > 0;
}
