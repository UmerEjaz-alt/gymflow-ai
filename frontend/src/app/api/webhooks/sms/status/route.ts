import { type NextRequest, NextResponse } from "next/server";

import {
  buildTwilioSmsStatusCallbackUrl,
  validateTwilioFormWebhook,
} from "@/lib/twilio-webhook-auth.server";
import { runWithSystemSupabase } from "@/lib/supabase/request-context";
import { applyTwilioSmsDeliveryStatus } from "@/services/sms-outbound.server";
import { normalizeTwilioSmsStatus } from "@/services/sms-status-normalizer";

export const runtime = "nodejs";

const MAX_STATUS_BODY_BYTES = 32 * 1024;

export async function POST(request: NextRequest): Promise<NextResponse> {
  const deliveryId = request.nextUrl.searchParams.get("deliveryId") ?? "";
  const canonicalUrl = buildTwilioSmsStatusCallbackUrl(deliveryId);
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!authToken || !canonicalUrl) {
    console.error("[SMS status] Twilio callback authentication is not configured.");
    return NextResponse.json(
      { error: "Callback authentication is not configured." },
      { status: 503 },
    );
  }

  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_STATUS_BODY_BYTES) {
    return NextResponse.json({ error: "Request is too large." }, { status: 413 });
  }
  if (
    !request.headers
      .get("content-type")
      ?.toLowerCase()
      .startsWith("application/x-www-form-urlencoded")
  ) {
    return NextResponse.json({ error: "Unsupported content type." }, { status: 415 });
  }

  let rawBody: string;
  try {
    const bytes = Buffer.from(await request.arrayBuffer());
    if (bytes.byteLength > MAX_STATUS_BODY_BYTES) {
      return NextResponse.json({ error: "Request is too large." }, { status: 413 });
    }
    rawBody = bytes.toString("utf8");
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const form = new URLSearchParams(rawBody);
  if (
    !validateTwilioFormWebhook({
      authToken,
      signature: request.headers.get("x-twilio-signature"),
      canonicalUrl,
      form,
    })
  ) {
    return NextResponse.json({ error: "Invalid callback signature." }, { status: 401 });
  }

  const normalized = normalizeTwilioSmsStatus(form);
  if (normalized.kind === "invalid") {
    return NextResponse.json({ error: normalized.error }, { status: 400 });
  }

  try {
    const outcome = await runWithSystemSupabase(() =>
      applyTwilioSmsDeliveryStatus({
        deliveryId,
        providerMessageId: normalized.event.providerMessageId,
        providerStatus: normalized.event.providerStatus,
        errorCode: normalized.event.errorCode,
        providerSegmentCount: normalized.event.providerSegmentCount,
      }),
    );
    if (outcome === "not_found") {
      return NextResponse.json({ error: "Delivery was not found." }, { status: 404 });
    }
    if (
      outcome === "provider_mismatch" ||
      outcome === "provider_message_mismatch" ||
      outcome === "invalid_state"
    ) {
      return NextResponse.json(
        { error: "Callback correlation failed." },
        { status: 409 },
      );
    }
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    console.error("[SMS status] durable status update failed", {
      deliveryId,
      error: error instanceof Error ? error.message : "Unknown status error.",
    });
    return NextResponse.json({ error: "Status update failed." }, { status: 503 });
  }
}
