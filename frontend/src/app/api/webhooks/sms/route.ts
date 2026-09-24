import { type NextRequest, NextResponse } from "next/server";

import {
  getCanonicalTwilioSmsWebhookUrl,
  validateTwilioFormWebhook,
} from "@/lib/twilio-webhook-auth.server";
import { runWithSystemSupabase } from "@/lib/supabase/request-context";
import { rateLimitBucket } from "@/services/durable-rate-limit.server";
import { handleIncomingMessage } from "@/services/conversation-manager.server";
import { resolveSmsEndpoint } from "@/services/sms-endpoint.server";
import { normalizeTwilioInboundSms } from "@/services/sms-normalizer";
import { processSmsInboundWork } from "@/services/sms-inbound-processing.server";

export const runtime = "nodejs";

const MAX_WEBHOOK_BODY_BYTES = 64 * 1024;
const AI_CUSTOMER_LIMIT = 30;
const AI_GYM_LIMIT = 300;
const AI_WINDOW_SECONDS = 10 * 60;

function twiml(status = 200): NextResponse {
  return new NextResponse("<?xml version=\"1.0\" encoding=\"UTF-8\"?><Response></Response>", {
    status,
    headers: { "content-type": "text/xml; charset=utf-8" },
  });
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const canonicalUrl = getCanonicalTwilioSmsWebhookUrl();
  if (!authToken || !canonicalUrl) {
    console.error("[SMS webhook] Twilio authentication is not configured.");
    return NextResponse.json(
      { error: "Webhook authentication is not configured." },
      { status: 503 },
    );
  }

  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_WEBHOOK_BODY_BYTES) {
    return NextResponse.json({ error: "Request is too large." }, { status: 413 });
  }
  if (!request.headers.get("content-type")?.toLowerCase().startsWith(
    "application/x-www-form-urlencoded",
  )) {
    return NextResponse.json({ error: "Unsupported content type." }, { status: 415 });
  }

  let rawBody: string;
  try {
    const bytes = Buffer.from(await request.arrayBuffer());
    if (bytes.byteLength > MAX_WEBHOOK_BODY_BYTES) {
      return NextResponse.json({ error: "Request is too large." }, { status: 413 });
    }
    rawBody = bytes.toString("utf8");
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  // Form decoding is required to reproduce Twilio's signature input. No
  // routing, persistence, logging of PII, or other trusted processing occurs
  // before this check succeeds.
  const form = new URLSearchParams(rawBody);
  if (
    !validateTwilioFormWebhook({
      authToken,
      signature: request.headers.get("x-twilio-signature"),
      canonicalUrl,
      form,
    })
  ) {
    return NextResponse.json({ error: "Invalid webhook signature." }, { status: 401 });
  }

  const normalized = normalizeTwilioInboundSms(form);
  if (normalized.kind === "unsupported_media") {
    // MMS is intentionally deferred. Acknowledge it without creating an empty
    // customer turn or causing an endless provider retry loop.
    return twiml();
  }
  if (normalized.kind === "invalid") {
    return NextResponse.json({ error: normalized.error }, { status: 400 });
  }

  const endpoint = await resolveSmsEndpoint(normalized.event.destinationPhone);
  if (endpoint.error) {
    return NextResponse.json({ error: endpoint.error }, { status: 503 });
  }
  if (!endpoint.data) {
    return NextResponse.json({ error: "Unknown SMS destination." }, { status: 404 });
  }
  if (!endpoint.data.isActive) {
    return NextResponse.json({ error: "SMS destination is inactive." }, { status: 403 });
  }
  if (endpoint.data.provider !== normalized.event.provider) {
    return NextResponse.json({ error: "SMS provider mismatch." }, { status: 403 });
  }

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
        "sms-ai-customer",
        endpoint.data.gymId,
        normalized.event.customerPhone,
      ),
      customerLimit: AI_CUSTOMER_LIMIT,
      gymBucket: rateLimitBucket("sms-ai-gym", endpoint.data.gymId),
      gymLimit: AI_GYM_LIMIT,
      windowSeconds: AI_WINDOW_SECONDS,
    };
  } catch {
    return NextResponse.json(
      { error: "Durable AI rate limiter is not configured." },
      { status: 503 },
    );
  }

  const ingestion = await runWithSystemSupabase(() =>
    handleIncomingMessage({
      gymId: endpoint.data!.gymId,
      smsEndpointId: endpoint.data!.endpointId,
      branchId: endpoint.data!.branchId,
      customerPhone: normalized.event.customerPhone,
      customerName: normalized.event.customerName,
      source: "sms",
      messageType: "text",
      content: normalized.event.body,
      smsProvider: normalized.event.provider,
      smsMessageId: normalized.event.providerMessageId,
      metadata: {},
      aiRateLimit,
    }),
  );

  if (ingestion.error || !ingestion.data) {
    console.error("[SMS webhook] inbound persistence failed", {
      provider: normalized.event.provider,
      error: ingestion.error,
    });
    return NextResponse.json({ error: "Inbound SMS processing failed." }, { status: 503 });
  }

  // Best-effort immediate processing keeps current latency behavior. Once the
  // atomic ingest succeeds, Twilio is acknowledged even if AI fails: the
  // durable job is failed/backed off and the maintenance runner can recover it.
  try {
    const outcome = await runWithSystemSupabase(() =>
      processSmsInboundWork(ingestion.data!.latestCustomerMessage.id),
    );
    if (outcome === "failed" || outcome === "dead") {
      console.error("[SMS webhook] durable AI processing did not complete", {
        provider: normalized.event.provider,
        outcome,
      });
    }
  } catch (error) {
    console.error("[SMS webhook] durable AI processing attempt failed", {
      provider: normalized.event.provider,
      error: error instanceof Error ? error.message : "Unknown processing error.",
    });
  }

  // The inbound message and its processing state are durable. There is still
  // no SMS outbox, provider send, or synthetic delivery status.
  return twiml();
}
