import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";

import {
  buildTwilioSmsStatusCallbackUrl,
  validateTwilioFormWebhook,
} from "../src/lib/twilio-webhook-auth.server.ts";
import { estimateSmsSegments } from "../src/services/sms-segments.ts";
import { normalizeTwilioSmsStatus } from "../src/services/sms-status-normalizer.ts";

const readSource = (relativePath) =>
  readFile(new URL(`../${relativePath}`, import.meta.url), "utf8");

const [
  migration,
  reply,
  outbound,
  transport,
  statusRoute,
  processing,
  maintenance,
  scheduler,
] = await Promise.all([
  readFile(
    new URL(
      "../../supabase/migrations/20250101000033_add_durable_sms_outbound_delivery.sql",
      import.meta.url,
    ),
    "utf8",
  ),
  readSource("src/services/conversation-reply.server.ts"),
  readSource("src/services/sms-outbound.server.ts"),
  readSource("src/services/twilio-sms.server.ts"),
  readSource("src/app/api/webhooks/sms/status/route.ts"),
  readSource("src/services/sms-inbound-processing.server.ts"),
  readSource("src/app/api/automations/run/route.ts"),
  readSource("src/lib/automation-scheduler.server.ts"),
]);

// Queue identity is source/endpoint/anchor authoritative and message_id is the
// database uniqueness boundary. The trigger shares the message transaction.
assert.match(migration, /create table public\.sms_outbound_deliveries/);
assert.match(migration, /message_id uuid not null unique references public\.messages/);
assert.match(migration, /c\.source = 'sms'/);
assert.match(migration, /c\.sms_endpoint_id = new\.sms_endpoint_id/);
assert.match(migration, /m\.sms_inbound_reply_to_message_id is not null/);
assert.match(
  migration,
  /create trigger messages_queue_sms_outbound[\s\S]*after insert on public\.messages/,
);
assert.match(migration, /on conflict \(message_id\) do nothing/);
assert.doesNotMatch(migration, /whatsapp_outbound_deliveries/);

// SMS persistence deterministically creates one text message and makes omitted
// media auditable without opting into WhatsApp delivery.
assert.match(reply, /if \(smsInboundReplyToMessageId\)/);
assert.match(reply, /textParts\.join\("\\n\\n"\)/);
assert.match(reply, /sms_unsupported_media_count: unsupportedMediaCount/);
assert.match(reply, /queues_sms_delivery: true/);

// Atomic claims, non-stealable active leases, recoverable pre-send claims, and
// quarantine after the external side-effect boundary.
assert.match(migration, /for update skip locked/);
assert.match(migration, /claim_token = v_token/);
assert.match(migration, /status = 'processing'[\s\S]*lease_expires_at <= now\(\)/);
assert.match(migration, /set status = 'uncertain'[\s\S]*where d\.status = 'sending'/);
assert.match(migration, /begin_sms_outbound_send/);
assert.match(migration, /claim_token = p_claim_token[\s\S]*lease_expires_at > now\(\)/);
assert.match(migration, /max_attempts integer not null default 5/);

// Retry policy: definitive 429/5xx responses back off; 4xx is permanent;
// timeout/network ambiguity is quarantined and never automatically reclaimed.
assert.match(transport, /response\.status === 429 \|\| response\.status >= 500/);
assert.match(transport, /kind: "ambiguous"/);
assert.match(migration, /least\(3600, 30 \* power\(2,/);
assert.match(outbound, /result\.retryable \? "retryable" : "permanent"/);
assert.match(outbound, /failSmsDelivery\(claim, "uncertain", result\.error\)/);

// Twilio uses the endpoint's authoritative sender and the conversation's
// persisted destination. API acceptance stores a SID but is not delivery.
assert.match(outbound, /from: endpoint\.phone_number/);
assert.match(outbound, /to: delivery\.destination_phone/);
assert.match(
  transport,
  /Accounts\/\$\{encodeURIComponent\(input\.config\.accountSid\)\}\/Messages\.json/,
);
assert.match(transport, /StatusCallback: input\.statusCallback/);
assert.match(migration, /provider_message_id = p_provider_message_id/);
assert.match(migration, /when v_target = 'delivered'/);

// Canonical callback URL is configured, not proxy-derived, and deliveryId is
// signature-bound. Missing/invalid signatures are rejected before mutation.
const oldCallbackUrl = process.env.TWILIO_SMS_STATUS_CALLBACK_URL;
const oldNodeEnv = process.env.NODE_ENV;
process.env.TWILIO_SMS_STATUS_CALLBACK_URL =
  "https://app.example/api/webhooks/sms/status";
const deliveryId = "11111111-1111-4111-8111-111111111111";
const callbackUrl = buildTwilioSmsStatusCallbackUrl(deliveryId);
assert.equal(
  callbackUrl,
  `https://app.example/api/webhooks/sms/status?deliveryId=${deliveryId}`,
);
const statusForm = new URLSearchParams({
  MessageSid: `SM${"a".repeat(32)}`,
  MessageStatus: "delivered",
  ErrorCode: "",
});
let signed = callbackUrl;
for (const [name, value] of [...statusForm.entries()].sort(([a], [b]) =>
  a.localeCompare(b),
)) {
  signed += name + value;
}
const signature = createHmac("sha1", "test-token").update(signed).digest("base64");
assert.equal(
  validateTwilioFormWebhook({
    authToken: "test-token",
    signature,
    canonicalUrl: callbackUrl,
    form: statusForm,
  }),
  true,
);
assert.equal(
  validateTwilioFormWebhook({
    authToken: "test-token",
    signature: null,
    canonicalUrl: callbackUrl,
    form: statusForm,
  }),
  false,
);
assert.equal(
  validateTwilioFormWebhook({
    authToken: "test-token",
    signature: "AAAAAAAAAAAAAAAAAAAAAAAAAAA=",
    canonicalUrl: callbackUrl,
    form: statusForm,
  }),
  false,
);
assert.match(statusRoute, /MAX_STATUS_BODY_BYTES = 32 \* 1024/);
assert.match(statusRoute, /validateTwilioFormWebhook/);
assert.ok(
  statusRoute.indexOf("validateTwilioFormWebhook") <
    statusRoute.indexOf("applyTwilioSmsDeliveryStatus"),
);
assert.doesNotMatch(statusRoute, /x-forwarded|request\.headers\.get\("host"\)/i);
if (oldCallbackUrl === undefined) delete process.env.TWILIO_SMS_STATUS_CALLBACK_URL;
else process.env.TWILIO_SMS_STATUS_CALLBACK_URL = oldCallbackUrl;
if (oldNodeEnv === undefined) delete process.env.NODE_ENV;
else process.env.NODE_ENV = oldNodeEnv;

// Status parsing, idempotent terminal updates, and race-safe deliveryId + SID
// correlation are explicit.
assert.deepEqual(normalizeTwilioSmsStatus(statusForm), {
  kind: "status",
  event: {
    provider: "twilio",
    providerMessageId: `SM${"a".repeat(32)}`,
    providerStatus: "delivered",
    errorCode: null,
    providerSegmentCount: null,
  },
});
assert.match(migration, /p_delivery_id uuid/);
assert.match(migration, /provider_message_id <> p_provider_message_id/);
assert.match(migration, /return 'duplicate_terminal'/);
assert.match(
  migration,
  /v_delivery\.status in \('delivered', 'failed', 'undelivered'\)/,
);
assert.match(migration, /set delivered_at = coalesce\(delivered_at, now\(\)\)/);

// Segment estimates cover GSM-7 extensions and UCS-2 concatenation without
// truncating. The service rejects over-limit content rather than clipping it.
assert.deepEqual(estimateSmsSegments("a".repeat(160)), {
  encoding: "gsm7",
  characterUnits: 160,
  segmentCount: 1,
});
assert.equal(estimateSmsSegments("a".repeat(161)).segmentCount, 2);
assert.equal(estimateSmsSegments("€".repeat(80)).segmentCount, 1);
assert.equal(estimateSmsSegments("€".repeat(81)).segmentCount, 2);
assert.deepEqual(estimateSmsSegments("漢".repeat(71)), {
  encoding: "ucs2",
  characterUnits: 71,
  segmentCount: 2,
});
assert.match(outbound, /Array\.from\(message\.content\)\.length > 1600/);
assert.match(outbound, /Twilio outbound SMS configuration is missing or invalid/);

// Immediate attempt is post-completion and recovery is bounded/isolated on
// both existing maintenance entry points.
assert.ok(
  processing.indexOf("await finishClaim") <
    processing.indexOf("await deliverSmsMessage"),
);
assert.match(outbound, /Math\.max\(1, Math\.min\(25, Math\.floor\(limit\)\)\)/);
assert.match(maintenance, /recoverSmsOutboundDeliveries\(10\)/);
assert.match(scheduler, /recoverSmsOutboundDeliveries\(10\)/);
assert.match(maintenance, /SMS outbound recovery failed/);
assert.match(scheduler, /SMS outbound recovery failed/);
assert.doesNotMatch(
  migration + outbound + transport + statusRoute,
  /automation_configs|MediaUrl|A2P|marketing_consent|opt_out|STOP \/ START \/ HELP/i,
);

console.log("SMS queue identity, atomic claim, and send-boundary checks passed.");
console.log("Twilio transport, retry, ambiguity, and callback checks passed.");
console.log("Status ordering, early-callback correlation, and segment checks passed.");
console.log("Immediate delivery and bounded maintenance recovery checks passed.");
