import { type NextRequest, NextResponse } from "next/server";

import { processIncomingConversationTurn } from "@/services/conversation-turn.server";
import { prepareWhatsAppInbound } from "@/services/whatsapp-endpoint.server";
import { runWithSystemSupabase } from "@/lib/supabase/request-context";
import { normalizeIncomingMessageWebhooks } from "@/services/whatsapp-normalizer";
import { downloadWhatsAppAudio } from "@/services/whatsapp-cloud-api.server";
import { transcribeWhatsAppVoiceNote } from "@/services/gemini-transcription.server";
import { verifyWhatsAppWebhookSignature } from "@/lib/whatsapp-webhook-auth.server";
import {
  deliverWhatsAppMessage,
  hasRecoverableWhatsAppDeliveries,
  prepareWhatsAppDelivery,
  recoverWhatsAppDeliveries,
} from "@/services/whatsapp-outbox.server";
import {
  consumeDurableRateLimit,
  rateLimitBucket,
} from "@/services/durable-rate-limit.server";
import { elapsedMs, logPerformance } from "@/lib/performance-log.server";
import { requiresLegacyDeliveryPreparation } from "@/lib/whatsapp-delivery-optimization";

export const runtime = "nodejs";

const MAX_WEBHOOK_BODY_BYTES = 1024 * 1024;
const AI_CUSTOMER_LIMIT = 30;
const AI_GYM_LIMIT = 300;
const AI_WINDOW_SECONDS = 10 * 60;
const VOICE_CUSTOMER_LIMIT = 5;
const VOICE_GYM_LIMIT = 50;
const VOICE_WINDOW_SECONDS = 60 * 60;

// ---------------------------------------------------------------------------
// GET — Meta webhook verification handshake
// ---------------------------------------------------------------------------

/**
 * Meta sends a GET request to verify the webhook endpoint.
 * We must echo back hub.challenge when hub.verify_token matches our secret.
 */
export function GET(request: NextRequest): NextResponse {
  const { searchParams } = request.nextUrl;

  const mode = searchParams.get("hub.mode");
  const token = searchParams.get("hub.verify_token");
  const challenge = searchParams.get("hub.challenge");
  const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN;

  if (!verifyToken) {
    console.error("[WhatsApp webhook] WHATSAPP_VERIFY_TOKEN is not set.");
    return NextResponse.json(
      { error: "Webhook verification is not configured." },
      { status: 500 },
    );
  }

  if (mode === "subscribe" && token === verifyToken) {
    return new NextResponse(challenge, { status: 200 });
  }

  return NextResponse.json({ error: "Webhook verification failed." }, { status: 403 });
}

// ---------------------------------------------------------------------------
// POST — Incoming message events from Meta
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest): Promise<NextResponse> {
  const appSecret = process.env.WHATSAPP_APP_SECRET;
  if (!appSecret) {
    console.error("[WhatsApp webhook] WHATSAPP_APP_SECRET is not set.");
    return NextResponse.json(
      { error: "Webhook authentication is not configured." },
      { status: 503 },
    );
  }

  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_WEBHOOK_BODY_BYTES) {
    return NextResponse.json({ error: "Request is too large." }, { status: 413 });
  }

  let rawBodyBytes: Buffer;
  try {
    rawBodyBytes = Buffer.from(await request.arrayBuffer());
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  if (rawBodyBytes.byteLength > MAX_WEBHOOK_BODY_BYTES) {
    return NextResponse.json({ error: "Request is too large." }, { status: 413 });
  }

  if (
    !verifyWhatsAppWebhookSignature(
      rawBodyBytes,
      request.headers.get("x-hub-signature-256"),
      appSecret,
    )
  ) {
    return NextResponse.json({ error: "Invalid webhook signature." }, { status: 401 });
  }

  // ── Parse body ─────────────────────────────────────────────────────────

  let payload: unknown;

  try {
    payload = JSON.parse(rawBodyBytes.toString("utf8")) as unknown;
  } catch {
    // Malformed JSON — return 200 so Meta does not retry.
    return NextResponse.json({ success: true }, { status: 200 });
  }

  // ── Normalize ──────────────────────────────────────────────────────────

  const events = normalizeIncomingMessageWebhooks(payload);

  if (events.length === 0) {
    // Not a supported message event (e.g. status update, read receipt).
    // Return 200 to acknowledge receipt and prevent Meta retries.
    return NextResponse.json({ success: true }, { status: 200 });
  }

  // ── Process ────────────────────────────────────────────────────────────

  let retryRequested = false;
  for (const event of events) {
    const result = await runWithSystemSupabase(async () => {
      const preflightStartedAt = performance.now();
      const preflight = await prepareWhatsAppInbound({
        phoneNumberId: event.recipientPhoneNumberId,
        displayPhone: event.recipientDisplayPhone,
        whatsappMessageId: event.whatsappMessageId,
      });
      const preflightMs = elapsedMs(preflightStartedAt);
      if (preflight.error || !preflight.data) return { error: preflight.error };
      const destination = preflight.data.destination;
      logPerformance("whatsapp.pre_turn", {
        destination_mapped: Boolean(destination),
        duplicate: Boolean(preflight.data.existingMessage),
        round_trip_count: 1,
        total_ms: preflightMs,
      });
      logPerformance("whatsapp.endpoint_resolution", {
        outcome: destination ? "resolved" : "unmapped",
        shared_endpoint: destination ? destination.branchId === null : null,
        consolidated_preflight: true,
        network_total_ms: preflightMs,
        total_ms: preflight.data.timings.endpointResolutionMs,
      });
      logPerformance("whatsapp.idempotency_lookup", {
        duplicate: Boolean(preflight.data.existingMessage),
        consolidated_preflight: true,
        total_ms: preflight.data.timings.idempotencyMs,
      });
      if (!destination) {
        return { error: "Unmapped WhatsApp destination." };
      }

      // Check every supported type before consuming cost budget. A duplicate
      // webhook becomes an opportunity to recover its previously queued reply.
      if (preflight.data.existingMessage) {
        return {
          result: {
            customerMessage: preflight.data.existingMessage,
            aiMessage: null,
            action: "duplicate",
            error: null,
          },
        };
      }

      let suppressAI = false;
      let aiRateLimit: {
        customerBucket: string;
        customerLimit: number;
        gymBucket: string;
        gymLimit: number;
        windowSeconds: number;
      };
      try {
        aiRateLimit = {
          customerBucket: rateLimitBucket(
            "whatsapp-ai-customer",
            destination.gymId,
            event.customerPhone,
          ),
          customerLimit: AI_CUSTOMER_LIMIT,
          gymBucket: rateLimitBucket("whatsapp-ai-gym", destination.gymId),
          gymLimit: AI_GYM_LIMIT,
          windowSeconds: AI_WINDOW_SECONDS,
        };
      } catch {
        return { error: "Durable AI rate limiter is not configured." };
      }
      const consolidateAIRateLimit =
        event.messageType !== "audio" && destination.endpointId !== null;
      if (!consolidateAIRateLimit) {
        try {
          const rateLimitStartedAt = performance.now();
          const [customerBudget, gymBudget] = await Promise.all([
            consumeDurableRateLimit({
              bucket: aiRateLimit.customerBucket,
              limit: aiRateLimit.customerLimit,
              windowSeconds: aiRateLimit.windowSeconds,
            }),
            consumeDurableRateLimit({
              bucket: aiRateLimit.gymBucket,
              limit: aiRateLimit.gymLimit,
              windowSeconds: aiRateLimit.windowSeconds,
            }),
          ]);
          logPerformance("whatsapp.rate_limit", {
            scope: "ai",
            allowed: customerBudget.allowed && gymBudget.allowed,
            total_ms: elapsedMs(rateLimitStartedAt),
          });
          if (customerBudget.error || gymBudget.error) {
            return { error: "Durable AI rate limiter is unavailable." };
          }
          suppressAI = !customerBudget.allowed || !gymBudget.allowed;
        } catch {
          return { error: "Durable AI rate limiter is not configured." };
        }
      }

      let content = event.content;
      let safeFallbackReplyText: string | null = null;
      const metadata: Record<string, unknown> = {
        recipient_phone_number_id: event.recipientPhoneNumberId,
        recipient_display_phone: event.recipientDisplayPhone,
        timestamp: event.timestamp,
        ...event.metadata,
      };

      if (event.messageType === "audio") {
        try {
          const voiceRateLimitStartedAt = performance.now();
          const [customerVoiceBudget, gymVoiceBudget] = await Promise.all([
            consumeDurableRateLimit({
              bucket: rateLimitBucket(
                "whatsapp-voice-customer",
                destination.gymId,
                event.customerPhone,
              ),
              limit: VOICE_CUSTOMER_LIMIT,
              windowSeconds: VOICE_WINDOW_SECONDS,
            }),
            consumeDurableRateLimit({
              bucket: rateLimitBucket("whatsapp-voice-gym", destination.gymId),
              limit: VOICE_GYM_LIMIT,
              windowSeconds: VOICE_WINDOW_SECONDS,
            }),
          ]);
          logPerformance("whatsapp.rate_limit", {
            scope: "voice",
            allowed: customerVoiceBudget.allowed && gymVoiceBudget.allowed,
            total_ms: elapsedMs(voiceRateLimitStartedAt),
          });
          if (customerVoiceBudget.error || gymVoiceBudget.error) {
            return { error: "Durable transcription rate limiter is unavailable." };
          }
          suppressAI ||= !customerVoiceBudget.allowed || !gymVoiceBudget.allowed;
        } catch {
          return { error: "Durable transcription rate limiter is not configured." };
        }

        if (suppressAI) {
          content = "[Voice note received while automated processing was limited]";
          metadata.voice_transcription = { status: "rate_limited" };
        }
        const mediaId =
          typeof event.metadata.id === "string" ? event.metadata.id : null;
        const downloaded =
          !suppressAI && mediaId ? await downloadWhatsAppAudio(mediaId) : null;
        if (suppressAI) {
          // The inbound event is still persisted for staff visibility, but no
          // provider call or automatic outbound message is generated.
        } else if (!downloaded?.data) {
          content = "[Voice note could not be transcribed]";
          safeFallbackReplyText = downloaded?.limitExceeded
            ? "That voice note is a bit too long. Please send a shorter one or type your message."
            : "Sorry, I couldn't understand that voice note. Could you send it again or type your message?";
          metadata.voice_transcription = {
            status: downloaded?.limitExceeded ? "rejected_limit" : "failed",
            error: downloaded?.error ?? "WhatsApp audio media ID is missing.",
          };
        } else {
          const transcription = await transcribeWhatsAppVoiceNote(downloaded.data);
          if (!transcription.data) {
            content = "[Voice note could not be transcribed]";
            safeFallbackReplyText =
              "Sorry, I couldn't understand that voice note. Could you send it again or type your message?";
            metadata.voice_transcription = {
              status: "failed",
              error: transcription.error,
            };
          } else {
            content = transcription.data.transcript;
            metadata.voice_transcription = {
              status: "completed",
              model: transcription.data.model,
            };
          }
        }
      }

      const turnStartedAt = performance.now();
      const turnResult = await processIncomingConversationTurn({
        gymId: destination.gymId,
        endpointId: destination.endpointId,
        branchId: destination.branchId,
        customerPhone: event.customerPhone,
        customerName: event.customerName,
        source: "whatsapp",
        messageType: event.messageType,
        content,
        whatsappMessageId: event.whatsappMessageId,
        metadata,
        safeFallbackReplyText,
        suppressAI,
        aiRateLimit: consolidateAIRateLimit ? aiRateLimit : undefined,
      });
      logPerformance("whatsapp.turn_processing", {
        message_type: event.messageType,
        action: turnResult.action,
        total_ms: elapsedMs(turnStartedAt),
      });
      return {
        result: turnResult,
      };
    });

    if (!("result" in result) || !result.result) {
      console.error("[WhatsApp webhook] inbound processing failed", {
        messageId: event.whatsappMessageId,
        error: result.error,
      });
      continue;
    }
    const turn = result.result;
    if (turn.action === "duplicate") {
      if (turn.customerMessage) {
        await runWithSystemSupabase(() =>
          recoverWhatsAppDeliveries(10, turn.customerMessage!.conversation_id),
        );
        retryRequested ||= await runWithSystemSupabase(() =>
          hasRecoverableWhatsAppDeliveries(turn.customerMessage!.conversation_id),
        );
      }
      continue;
    }
    if (!turn.aiMessage) continue;
    if (!event.recipientPhoneNumberId) {
      console.error(
        "[WhatsApp webhook] reply not delivered: endpoint has no Meta phone_number_id",
        {
          messageId: event.whatsappMessageId,
        },
      );
      continue;
    }
    for (const message of turn.outboundMessages ?? [turn.aiMessage]) {
      const outcome = await runWithSystemSupabase(async () => {
        if (requiresLegacyDeliveryPreparation(turn.deliveryEndpointId ?? null)) {
          await prepareWhatsAppDelivery(message.id, event.recipientPhoneNumberId!);
        } else {
          logPerformance("whatsapp.delivery_prepare", {
            skipped_authoritative_endpoint: true,
            total_ms: 0,
          });
        }
        return deliverWhatsAppMessage(message.id, message);
      });
      if (outcome !== "sent") {
        console.error("[WhatsApp webhook] reply was queued but not delivered", {
          inboundMessageId: event.whatsappMessageId,
          messageId: message.id,
          outcome,
        });
      }
      retryRequested ||= outcome === "retryable_failure";
      if (outcome !== "sent") break;
    }
  }

  return retryRequested
    ? NextResponse.json(
        { error: "Outbound delivery is pending retry." },
        { status: 503 },
      )
    : NextResponse.json({ success: true }, { status: 200 });
}
