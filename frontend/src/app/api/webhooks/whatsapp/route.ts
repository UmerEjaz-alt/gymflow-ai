import { type NextRequest, NextResponse } from "next/server";

import { processIncomingConversationTurn } from "@/services/conversation-turn.server";
import { resolveWhatsAppEndpoint } from "@/services/whatsapp-endpoint.server";
import { runWithSystemSupabase } from "@/lib/supabase/request-context";
import { normalizeIncomingMessageWebhooks } from "@/services/whatsapp-normalizer";
import {
  getMessageByWhatsAppMessageId,
  updateMessage,
} from "@/services/message.server";
import {
  downloadWhatsAppAudio,
  sendWhatsAppImage,
  sendWhatsAppText,
} from "@/services/whatsapp-cloud-api.server";
import { transcribeWhatsAppVoiceNote } from "@/services/gemini-transcription.server";

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
  // ── Parse body ─────────────────────────────────────────────────────────

  let payload: unknown;

  try {
    payload = await request.json();
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

  for (const event of events) {
    const result = await runWithSystemSupabase(async () => {
      const destination = await resolveWhatsAppEndpoint(
        event.recipientPhoneNumberId,
        event.recipientDisplayPhone,
      );
      if (destination.error) return { error: destination.error };
      if (!destination.data) {
        return { error: "Unmapped WhatsApp destination." };
      }

      // Avoid downloading/transcribing the same Meta voice note when Meta
      // retries a webhook already persisted by this process or another worker.
      if (event.messageType === "audio") {
        const existing = await getMessageByWhatsAppMessageId(event.whatsappMessageId);
        if (existing.error) return { error: existing.error };
        if (existing.data) {
          return {
            result: {
              customerMessage: existing.data,
              aiMessage: null,
              action: "duplicate",
              error: null,
            },
          };
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
        const mediaId =
          typeof event.metadata.id === "string" ? event.metadata.id : null;
        const downloaded = mediaId ? await downloadWhatsAppAudio(mediaId) : null;
        if (!downloaded?.data) {
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

      return {
        result: await processIncomingConversationTurn({
          gymId: destination.data.gymId,
          endpointId: destination.data.endpointId,
          branchId: destination.data.branchId,
          customerPhone: event.customerPhone,
          customerName: event.customerName,
          source: "whatsapp",
          messageType: event.messageType,
          content,
          whatsappMessageId: event.whatsappMessageId,
          metadata,
          safeFallbackReplyText,
        }),
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
    if (turn.action === "duplicate" || !turn.aiMessage) continue;
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
      const imageUrl =
        typeof message.metadata?.media_url === "string"
          ? message.metadata.media_url
          : null;
      const delivery =
        message.message_type === "image" && imageUrl
          ? await sendWhatsAppImage({
              phoneNumberId: event.recipientPhoneNumberId,
              to: event.customerPhone,
              imageUrl,
              caption: message.content,
            })
          : message.message_type === "text"
            ? await sendWhatsAppText({
                phoneNumberId: event.recipientPhoneNumberId,
                to: event.customerPhone,
                body: message.content,
              })
            : null;
      if (!delivery) continue;
      if (delivery.error) {
        console.error("[WhatsApp webhook] reply delivery failed", {
          inboundMessageId: event.whatsappMessageId,
          messageId: message.id,
          error: delivery.error,
        });
        continue;
      }
      const saved = await runWithSystemSupabase(() =>
        updateMessage(message.id, {
          whatsapp_message_id: delivery.data!.whatsappMessageId,
          delivered_at: new Date().toISOString(),
        }),
      );
      if (saved.error)
        console.error(
          "[WhatsApp webhook] reply delivered but delivery ID was not persisted",
          { inboundMessageId: event.whatsappMessageId, messageId: message.id },
        );
    }
  }

  return NextResponse.json({ success: true }, { status: 200 });
}
