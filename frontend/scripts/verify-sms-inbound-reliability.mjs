import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const readSource = (relativePath) =>
  readFile(new URL(`../${relativePath}`, import.meta.url), "utf8");

const [
  migration,
  phaseTwoMigration,
  route,
  processing,
  turn,
  reply,
  bookingExecutor,
  bookingService,
  bookingMigration,
  maintenanceRoute,
  scheduler,
  whatsappWebhook,
  whatsappOutbox,
] = await Promise.all([
  readFile(
    new URL(
      "../../supabase/migrations/20250101000032_add_durable_sms_inbound_processing.sql",
      import.meta.url,
    ),
    "utf8",
  ),
  readFile(
    new URL(
      "../../supabase/migrations/20250101000031_add_inbound_sms_processing.sql",
      import.meta.url,
    ),
    "utf8",
  ),
  readSource("src/app/api/webhooks/sms/route.ts"),
  readSource("src/services/sms-inbound-processing.server.ts"),
  readSource("src/services/conversation-turn.server.ts"),
  readSource("src/services/conversation-reply.server.ts"),
  readSource("src/services/ai-booking-executor.server.ts"),
  readSource("src/services/booking.server.ts"),
  readFile(
    new URL(
      "../../supabase/migrations/20250101000021_create_booking_action_executions.sql",
      import.meta.url,
    ),
    "utf8",
  ),
  readSource("src/app/api/automations/run/route.ts"),
  readSource("src/lib/automation-scheduler.server.ts"),
  readSource("src/app/api/webhooks/whatsapp/route.ts"),
  readSource("src/services/whatsapp-outbox.server.ts"),
]);

// 1-2. A new canonical message and its unique work item are inserted by the
// same ingest_sms_message transaction; duplicate paths return before either is
// inserted again.
assert.match(migration, /create table public\.sms_inbound_processing/);
assert.match(migration, /message_id uuid not null unique references public\.messages/);
assert.ok(
  migration.lastIndexOf("insert into public.messages") <
    migration.lastIndexOf("insert into public.sms_inbound_processing"),
);
assert.ok(
  migration.lastIndexOf("insert into public.sms_inbound_processing") <
    migration.lastIndexOf("return query select 'inserted'"),
);
assert.match(
  migration,
  /if found then[\s\S]*return query select 'duplicate'[\s\S]*return;[\s\S]*insert into public\.messages/,
);

// 3-6. Completed work is reconciled before claim; atomic locking permits one
// owner, protects a valid lease, and recovers an expired lease.
assert.match(
  migration,
  /r\.sms_inbound_reply_to_message_id = p\.message_id[\s\S]*set status = 'completed'/,
);
assert.match(migration, /for update skip locked/);
assert.match(migration, /status = 'processing'[\s\S]*lease_expires_at > now\(\)/);
assert.match(
  migration,
  /p\.status = 'processing'[\s\S]*p\.lease_expires_at is not null[\s\S]*p\.lease_expires_at <= now\(\)/,
);
assert.match(migration, /claim_token = v_token/);
assert.match(migration, /attempt_count = p\.attempt_count \+ 1/);

// 7-11. Failures release ownership, use bounded exponential backoff, retain
// the original rate decision, and become terminal after five attempts.
assert.match(migration, /max_attempts integer not null default 5/);
assert.match(
  migration,
  /when v_processing\.attempt_count >= v_processing\.max_attempts then 'dead'/,
);
assert.match(
  migration,
  /status = 'dead'[\s\S]*lease expired after the maximum attempt count[\s\S]*attempt_count >= p\.max_attempts/,
);
assert.match(migration, /least\(3600, 30 \* power\(2,/);
assert.match(migration, /set status = v_status,[\s\S]*claim_token = null/);
assert.match(
  migration,
  /customer_rate_limit_allowed boolean[\s\S]*gym_rate_limit_allowed boolean/,
);
assert.match(
  migration,
  /Rate limits are consumed once[\s\S]*canonical inbound message[\s\S]*consume_rate_limit/,
);
assert.doesNotMatch(
  processing,
  /consumeDurableRateLimit|rateLimitBucket|consume_rate_limit/,
);

// 12-14. Recovery is attached to the existing authenticated maintenance path,
// bounded, and the duplicate webhook attempts the same message's due job.
assert.match(maintenanceRoute, /recoverSmsInboundProcessing\(5\)/);
assert.match(scheduler, /recoverSmsInboundProcessing\(5\)/);
assert.match(processing, /Math\.max\(1, Math\.min\(25, Math\.floor\(limit\)\)\)/);
assert.match(
  route,
  /processSmsInboundWork\(ingestion\.data!\.latestCustomerMessage\.id\)/,
);
assert.match(route, /return twiml\(\);/);

// 15-18. Non-AI states become terminal/auditable and mutable controls are
// checked again after a delayed claim.
for (const reason of [
  "human_takeover",
  "conversation_closed",
  "ai_disabled",
  "rate_limited",
]) {
  assert.match(migration + processing, new RegExp(reason));
}
assert.match(migration, /case when v_should_process then 'pending' else 'skipped' end/);
assert.match(processing, /claim\.conversation\.status !== "active"/);
assert.match(processing, /!claim\.conversation\.ai_enabled/);

// 19. Every retry uses the canonical inbound message ID. The existing booking
// ledger's unique source_message_id remains the durable action boundary.
assert.match(processing, /latestCustomerMessage: claim\.message/);
assert.match(turn, /sourceMessageId: context\.latestCustomerMessage\.id/);
assert.match(bookingExecutor, /sourceMessageId/);
assert.match(bookingService, /source_message_id: params\.sourceMessageId/);
assert.match(bookingMigration, /unique \(source_message_id\)/);

// 20. The first AI row uniquely anchors the logical reply. A saved reply left
// before job completion is reconciled instead of generated again.
assert.match(
  migration,
  /create unique index messages_sms_inbound_reply_unique[\s\S]*sms_inbound_reply_to_message_id/,
);
assert.match(
  migration,
  /inbound\.id = new\.sms_inbound_reply_to_message_id[\s\S]*inbound\.conversation_id = new\.conversation_id[\s\S]*inbound\.sender_type = 'customer'/,
);
assert.match(reply, /sms_inbound_reply_to_message_id: smsInboundReplyToMessageId/);
assert.match(
  turn,
  /event\.source === "sms" \? context\.latestCustomerMessage\.id : null/,
);
assert.match(migration, /response_message_id = r\.id[\s\S]*status = 'completed'/);

// 21-22. Durable inbound completion remains independent of outbound delivery,
// and SMS replies cannot opt into the WhatsApp outbox. Frozen WhatsApp
// components retain their established APIs.
assert.doesNotMatch(
  route,
  /sendWhatsApp|deliverWhatsApp|sendSms|sendSMS|twilio\.messages|sms_outbox|sms-outbox/,
);
assert.ok(
  processing.indexOf("await finishClaim") <
    processing.indexOf("await deliverSmsMessage"),
);
assert.match(
  turn,
  /\(event\.source \?\? "whatsapp"\) === "whatsapp" && Boolean\(event\.whatsappMessageId\)/,
);
assert.match(whatsappWebhook, /deliverWhatsAppMessage/);
assert.match(whatsappOutbox, /claim_whatsapp_outbound_delivery/);
assert.doesNotMatch(migration, /whatsapp_outbound_deliveries/);
assert.doesNotMatch(phaseTwoMigration, /sms_inbound_processing/);

console.log("Atomic SMS message/work creation and terminal skip checks passed.");
console.log(
  "Claim token, lease, expiry recovery, backoff, and dead-state checks passed.",
);
console.log("Stable booking identity and unique logical AI reply checks passed.");
console.log(
  "Bounded maintenance recovery and duplicate webhook recovery checks passed.",
);
console.log("Inbound completion remains durable and independent of delivery retries.");
console.log("No WhatsApp outbox coupling was introduced for SMS.");
