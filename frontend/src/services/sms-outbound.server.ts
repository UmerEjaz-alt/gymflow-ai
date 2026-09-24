import "server-only";

import { buildTwilioSmsStatusCallbackUrl } from "@/lib/twilio-webhook-auth.server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { estimateSmsSegments } from "@/services/sms-segments";
import { getTwilioOutboundConfig, sendTwilioSms } from "@/services/twilio-sms.server";
import type { Message } from "@/types/message";

type SmsDeliveryStatus =
  | "pending"
  | "processing"
  | "sending"
  | "sent"
  | "delivered"
  | "failed"
  | "undelivered"
  | "uncertain";

type SmsDeliveryRow = {
  id: string;
  message_id: string;
  gym_id: string;
  conversation_id: string;
  sms_endpoint_id: string;
  provider: string;
  destination_phone: string;
  origin_phone: string;
  status: SmsDeliveryStatus;
  attempt_count: number;
  max_attempts: number;
  claim_token: string;
  lease_expires_at: string;
};

type SmsEndpointRow = {
  id: string;
  gym_id: string;
  phone_number: string;
  provider: string;
  is_active: boolean;
};

type ClaimedSmsDelivery = {
  delivery: SmsDeliveryRow;
  message: Message;
  endpoint: SmsEndpointRow;
};

export type SmsDeliveryOutcome =
  "sent" | "deferred" | "retryable_failure" | "failed" | "uncertain";

function normalizedPhone(value: string): string {
  return value.replace(/\D/g, "");
}

async function claimSmsDelivery(
  messageId?: string,
): Promise<ClaimedSmsDelivery | null> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc("claim_sms_outbound_delivery", {
    p_message_id: messageId ?? null,
    p_lease_seconds: 300,
  });
  if (error) throw new Error(`SMS outbound claim failed: ${error.message}`);
  const row = Array.isArray(data) ? data[0] : null;
  if (!row) return null;
  return {
    delivery: row.delivery_row as SmsDeliveryRow,
    message: row.message_row as Message,
    endpoint: row.endpoint_row as SmsEndpointRow,
  };
}

async function beginSmsSend(
  claim: ClaimedSmsDelivery,
  encoding: "gsm7" | "ucs2",
  segmentCount: number,
): Promise<boolean> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc("begin_sms_outbound_send", {
    p_delivery_id: claim.delivery.id,
    p_claim_token: claim.delivery.claim_token,
    p_sms_encoding: encoding,
    p_expected_segment_count: segmentCount,
  });
  if (error) throw new Error(`SMS send boundary failed: ${error.message}`);
  return data === true;
}

async function failSmsDelivery(
  claim: ClaimedSmsDelivery,
  disposition: "retryable" | "permanent" | "uncertain",
  errorMessage: string,
): Promise<SmsDeliveryOutcome> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc("fail_sms_outbound_delivery", {
    p_delivery_id: claim.delivery.id,
    p_claim_token: claim.delivery.claim_token,
    p_disposition: disposition,
    p_error: errorMessage,
  });
  if (error) throw new Error(`SMS failure finalization failed: ${error.message}`);
  if (data === "retryable_failure" || data === "uncertain" || data === "failed") {
    return data;
  }
  return "deferred";
}

async function finalizeSmsAcceptance(
  claim: ClaimedSmsDelivery,
  providerMessageId: string,
  providerStatus: string,
): Promise<boolean> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc("finalize_sms_outbound_acceptance", {
    p_delivery_id: claim.delivery.id,
    p_claim_token: claim.delivery.claim_token,
    p_provider_message_id: providerMessageId,
    p_provider_status: providerStatus,
    p_accepted_at: new Date().toISOString(),
  });
  if (error) throw new Error(`SMS acceptance finalization failed: ${error.message}`);
  return data === true;
}

async function deliverClaim(claim: ClaimedSmsDelivery): Promise<SmsDeliveryOutcome> {
  const { delivery, endpoint, message } = claim;
  if (
    delivery.provider !== "twilio" ||
    endpoint.provider !== delivery.provider ||
    endpoint.id !== delivery.sms_endpoint_id ||
    endpoint.gym_id !== delivery.gym_id ||
    !endpoint.is_active ||
    normalizedPhone(endpoint.phone_number) !== normalizedPhone(delivery.origin_phone)
  ) {
    return failSmsDelivery(
      claim,
      "permanent",
      "The authoritative SMS endpoint is unavailable or changed.",
    );
  }
  if (
    message.id !== delivery.message_id ||
    message.conversation_id !== delivery.conversation_id ||
    message.sender_type !== "ai" ||
    message.message_type !== "text" ||
    !message.content.trim()
  ) {
    return failSmsDelivery(
      claim,
      "permanent",
      "The canonical outbound SMS message is unavailable or unsupported.",
    );
  }
  if (Array.from(message.content).length > 1600) {
    return failSmsDelivery(
      claim,
      "permanent",
      "The outbound SMS exceeds Twilio's 1600-character Messages API limit.",
    );
  }

  const config = getTwilioOutboundConfig();
  const statusCallback = buildTwilioSmsStatusCallbackUrl(delivery.id);
  if (!config || !statusCallback) {
    return failSmsDelivery(
      claim,
      "permanent",
      "Twilio outbound SMS configuration is missing or invalid.",
    );
  }

  const segmentEstimate = estimateSmsSegments(message.content);
  if (
    !(await beginSmsSend(claim, segmentEstimate.encoding, segmentEstimate.segmentCount))
  ) {
    return "deferred";
  }

  const result = await sendTwilioSms({
    config,
    from: endpoint.phone_number,
    to: delivery.destination_phone,
    body: message.content,
    statusCallback,
  });
  if (result.kind === "ambiguous") {
    return failSmsDelivery(claim, "uncertain", result.error);
  }
  if (result.kind === "rejected") {
    return failSmsDelivery(
      claim,
      result.retryable ? "retryable" : "permanent",
      result.error,
    );
  }

  try {
    return (await finalizeSmsAcceptance(
      claim,
      result.providerMessageId,
      result.providerStatus,
    ))
      ? "sent"
      : "uncertain";
  } catch (error) {
    // Twilio accepted the request. Keep the sending lease intact so expiry
    // quarantines it; automatic retry could send the customer a duplicate.
    console.error("[SMS outbox] Twilio acceptance could not be finalized", {
      deliveryId: delivery.id,
      messageId: delivery.message_id,
      error: error instanceof Error ? error.message : "Unknown finalization error.",
    });
    return "uncertain";
  }
}

export async function deliverSmsMessage(
  messageId: string,
): Promise<SmsDeliveryOutcome> {
  const claim = await claimSmsDelivery(messageId);
  return claim ? deliverClaim(claim) : "deferred";
}

export async function recoverSmsOutboundDeliveries(
  limit = 10,
): Promise<Record<SmsDeliveryOutcome, number>> {
  const boundedLimit = Math.max(1, Math.min(25, Math.floor(limit)));
  const counts: Record<SmsDeliveryOutcome, number> = {
    sent: 0,
    deferred: 0,
    retryable_failure: 0,
    failed: 0,
    uncertain: 0,
  };
  for (let index = 0; index < boundedLimit; index += 1) {
    const claim = await claimSmsDelivery();
    if (!claim) break;
    counts[await deliverClaim(claim)] += 1;
  }
  return counts;
}

export async function applyTwilioSmsDeliveryStatus(input: {
  deliveryId: string;
  providerMessageId: string;
  providerStatus: string;
  errorCode: string | null;
  providerSegmentCount: number | null;
}): Promise<string> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc("apply_sms_delivery_status", {
    p_delivery_id: input.deliveryId,
    p_provider: "twilio",
    p_provider_message_id: input.providerMessageId,
    p_provider_status: input.providerStatus,
    p_error_code: input.errorCode,
    p_provider_segment_count: input.providerSegmentCount,
  });
  if (error) throw new Error(`SMS status update failed: ${error.message}`);
  return typeof data === "string" ? data : "unknown";
}
