import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  getCanonicalTwilioSmsWebhookUrl,
  validateTwilioFormWebhook,
} from "../src/lib/twilio-webhook-auth.server.ts";
import { normalizeTwilioInboundSms } from "../src/services/sms-normalizer.ts";

const readSource = (relativePath) =>
  readFile(new URL(`../${relativePath}`, import.meta.url), "utf8");

const [
  route,
  manager,
  turn,
  booking,
  prompt,
  endpointService,
  migration,
  outbox,
  bookingList,
  bookingDetail,
  processing,
] = await Promise.all([
  readSource("src/app/api/webhooks/sms/route.ts"),
  readSource("src/services/conversation-manager.server.ts"),
  readSource("src/services/conversation-turn.server.ts"),
  readSource("src/services/ai-booking-executor.server.ts"),
  readSource("src/services/prompt-builder.server.ts"),
  readSource("src/services/sms-endpoint.server.ts"),
  readFile(
    new URL(
      "../../supabase/migrations/20250101000031_add_inbound_sms_processing.sql",
      import.meta.url,
    ),
    "utf8",
  ),
  readSource("src/services/whatsapp-outbox.server.ts"),
  readSource("src/features/bookings/components/today-view.tsx"),
  readSource("src/features/bookings/components/booking-detail-sheet.tsx"),
  readSource("src/services/sms-inbound-processing.server.ts"),
]);

// Twilio's published form-signature example: exact URL + sorted fields,
// HMAC-SHA1, Base64. Missing/invalid signatures fail closed.
const officialExample = new URLSearchParams({
  CallSid: "CA1234567890ABCDE",
  Caller: "+14158675310",
  Digits: "1234",
  From: "+14158675310",
  To: "+18005551212",
});
assert.equal(
  validateTwilioFormWebhook({
    authToken: "12345",
    signature: "L/OH5YylLD5NRKLltdqwSvS0BnU=",
    canonicalUrl: "https://example.com/myapp.php?foo=1&bar=2",
    form: officialExample,
  }),
  true,
);
assert.equal(
  validateTwilioFormWebhook({
    authToken: "12345",
    signature: null,
    canonicalUrl: "https://example.com/myapp.php?foo=1&bar=2",
    form: officialExample,
  }),
  false,
);
assert.equal(
  validateTwilioFormWebhook({
    authToken: "12345",
    signature: "AAAAAAAAAAAAAAAAAAAAAAAAAAA=",
    canonicalUrl: "https://example.com/myapp.php?foo=1&bar=2",
    form: officialExample,
  }),
  false,
);

const priorCanonicalUrl = process.env.TWILIO_SMS_WEBHOOK_URL;
const priorNodeEnv = process.env.NODE_ENV;
process.env.TWILIO_SMS_WEBHOOK_URL = "https://app.example/api/webhooks/sms?tenant=a";
assert.equal(
  getCanonicalTwilioSmsWebhookUrl(),
  "https://app.example/api/webhooks/sms?tenant=a",
);
process.env.TWILIO_SMS_WEBHOOK_URL = "https://user:secret@app.example/hook";
assert.equal(getCanonicalTwilioSmsWebhookUrl(), null);
if (priorCanonicalUrl === undefined) delete process.env.TWILIO_SMS_WEBHOOK_URL;
else process.env.TWILIO_SMS_WEBHOOK_URL = priorCanonicalUrl;
if (priorNodeEnv === undefined) delete process.env.NODE_ENV;
else process.env.NODE_ENV = priorNodeEnv;

// The provider edge emits normalized Kroway names and handles text only.
const sid = `SM${"a".repeat(32)}`;
const normalized = normalizeTwilioInboundSms(
  new URLSearchParams({
    MessageSid: sid,
    From: "+12025550101",
    To: "+12025550102",
    Body: "Hello",
    NumMedia: "0",
  }),
);
assert.deepEqual(normalized, {
  kind: "text",
  event: {
    provider: "twilio",
    providerMessageId: sid,
    customerPhone: "+12025550101",
    destinationPhone: "+12025550102",
    body: "Hello",
    customerName: null,
  },
});
assert.deepEqual(
  normalizeTwilioInboundSms(
    new URLSearchParams({
      MessageSid: sid,
      From: "+12025550101",
      To: "+12025550102",
      Body: "",
      NumMedia: "1",
    }),
  ),
  { kind: "unsupported_media" },
);

// Route security and provider-safe routing contract.
assert.match(route, /MAX_WEBHOOK_BODY_BYTES = 64 \* 1024/);
assert.match(route, /x-twilio-signature/i);
assert.match(route, /validateTwilioFormWebhook/);
assert.ok(
  route.indexOf("validateTwilioFormWebhook") < route.indexOf("resolveSmsEndpoint"),
);
assert.match(route, /Unknown SMS destination/);
assert.match(route, /SMS destination is inactive/);
assert.match(route, /SMS provider mismatch/);
assert.match(endpointService, /\.rpc\("resolve_sms_endpoint"/);
assert.doesNotMatch(
  endpointService,
  /whatsapp_endpoints|branches\.whatsapp|gyms\.whatsapp/,
);

// Dedicated/shared branch routing and endpoint ownership stay database-owned.
assert.match(
  migration,
  /select e\.id, e\.gym_id, e\.branch_id, e\.provider, e\.is_active/,
);
assert.match(
  migration,
  /where e\.id = p_sms_endpoint_id[\s\S]*and e\.gym_id = p_gym_id[\s\S]*and e\.provider = p_provider[\s\S]*and e\.is_active = true/,
);
assert.match(migration, /v_endpoint\.branch_id/);

// Sequential and concurrent duplicates share one provider-scoped authority.
assert.match(
  migration,
  /create unique index messages_sms_provider_message_id_unique[\s\S]*\(sms_provider, sms_message_id\)/,
);
assert.match(
  migration,
  /not \(whatsapp_message_id is not null and sms_message_id is not null\)[\s\S]*sms_message_id is null or sender_type = 'customer'/,
);
assert.match(
  migration,
  /on conflict \(sms_provider, sms_message_id\)[\s\S]*do nothing[\s\S]*if v_message\.id is null[\s\S]*'duplicate'/,
);
assert.match(manager, /source === "sms"[\s\S]*ingestSmsMessage\(event, now\)/);
assert.match(manager, /duplicateInbound[\s\S]*shouldCallAI:[\s\S]*!duplicateInbound/);
assert.match(manager, /smsProvider[\s\S]*smsMessageId/);

// Per-customer and per-gym SMS budgets have namespaces distinct from WhatsApp.
assert.match(route, /"sms-ai-customer"/);
assert.match(route, /"sms-ai-gym"/);
assert.doesNotMatch(route, /"whatsapp-ai-customer"|"whatsapp-ai-gym"/);
assert.match(
  migration,
  /Only the transaction that inserted the inbound message consumes budget/,
);

// SMS uses the shared turn and persists replies without selecting WhatsApp
// delivery; the established WhatsApp predicate remains explicit and intact.
assert.match(
  route,
  /processSmsInboundWork\(ingestion\.data!\.latestCustomerMessage\.id\)/,
);
assert.match(processing, /processIncomingConversationTurn\(/);
assert.match(route, /source: "sms"/);
assert.doesNotMatch(route, /deliverWhatsAppMessage|sendWhatsApp|sms-outbox|sms_outbox/);
assert.match(
  turn,
  /const queueWhatsAppDelivery =\s*\(event\.source \?\? "whatsapp"\) === "whatsapp" && Boolean\(event\.whatsappMessageId\)/,
);
assert.match(
  turn,
  /saveAIReply\([\s\S]*queueWhatsAppDelivery,[\s\S]*queueWhatsAppDelivery/,
);
assert.match(outbox, /deliverWhatsAppMessage/);

// Human/closed/disabled semantics remain the shared conversation semantics.
assert.match(
  manager,
  /shouldCallAI:[\s\S]*!duplicateInbound[\s\S]*!effectiveSuppressAI[\s\S]*conversation\.ai_enabled[\s\S]*conversation\.status === "active"/,
);
assert.match(manager, /humanTakeover: conversation\.status === "human"/);

// SMS source is retained through prompt style and booking attribution.
assert.match(prompt, /source === "sms" \? "SMS" : "WhatsApp"/);
assert.match(prompt, /context\.conversation\.source/);
assert.match(booking, /conversation\.source === "sms" \? "sms" : "whatsapp"/);
assert.match(migration, /source in \('manual', 'whatsapp', 'sms'\)/);
assert.match(bookingList, /booking\.source === "sms"/);
assert.match(bookingDetail, /booking\.source === "sms"/);

console.log("Twilio signature validation and text-only normalization checks passed.");
console.log("SMS endpoint, branch, provider, and body-limit contracts passed.");
console.log("Sequential/concurrent SMS idempotency and rate-limit contracts passed.");
console.log(
  "Shared AI pipeline, durable reply handoff, and booking attribution checks passed.",
);
console.log("Established WhatsApp delivery selection remains explicit.");
