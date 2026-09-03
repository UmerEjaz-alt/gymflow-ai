import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { failureDeliveryPatch } from "../src/services/whatsapp-delivery-policy.ts";

const fixedNow = Date.parse("2026-09-03T00:00:00.000Z");
const retryable = failureDeliveryPatch(
  {
    data: null,
    error: "Meta temporarily unavailable.",
    retryable: true,
    deliveryMayHaveSucceeded: false,
  },
  1,
  fixedNow,
);
assert.equal(retryable.status, "failed");
assert.equal(retryable.retryable, true);
assert.equal(retryable.outcome, "retryable_failure");

const ambiguous = failureDeliveryPatch(
  {
    data: null,
    error: "Connection ended after request write.",
    retryable: false,
    deliveryMayHaveSucceeded: true,
  },
  1,
  fixedNow,
);
assert.equal(ambiguous.status, "uncertain");
assert.equal(ambiguous.retryable, false);
assert.equal(ambiguous.outcome, "uncertain");

const migration = await readFile(
  new URL(
    "../../supabase/migrations/20250101000027_add_delivery_claims_and_rate_limits.sql",
    import.meta.url,
  ),
  "utf8",
);
assert.match(migration, /for update skip locked/i);
assert.match(migration, /d\.status = 'processing' and d\.lease_expires_at <= now\(\)/i);
assert.match(migration, /set status = 'sending'/i);
assert.match(migration, /where status = 'sending'[\s\S]*lease_expires_at <= now\(\)/i);
assert.match(migration, /set status = 'uncertain', retryable = false/i);
assert.match(migration, /begin_whatsapp_outbound_send/i);
assert.match(
  migration,
  /metadata->>'outbound_delivery' is distinct from 'whatsapp_outbox'/i,
);
assert.match(
  migration,
  /on conflict \(automation_config_id, conversation_id, trigger_key\) do update/i,
);
assert.match(migration, /automation_executions\.lease_expires_at <= now\(\)/i);
assert.match(migration, /primary key \(bucket_key, window_started_at\)/i);
assert.match(migration, /request_count = rate_limit_buckets\.request_count \+ 1/i);
assert.match(migration, /not exists \(select 1 from endpoint_matches\)/i);
assert.match(migration, /where e\.is_active = true/i);

const automationRunner = await readFile(
  new URL("../src/services/automation-runner.server.ts", import.meta.url),
  "utf8",
);
assert.match(automationRunner, /claim\.data\.sent_message_id/);
assert.match(
  automationRunner,
  /deliverWhatsAppMessage\(claim\.data\.sent_message_id\)/,
);
assert.match(automationRunner, /null,\s*null,\s*true,\s*\)/);
assert.match(automationRunner, /status: delivery === "sent" \? "sent" : "failed"/);

const endpointResolver = await readFile(
  new URL("../src/services/whatsapp-endpoint.server.ts", import.meta.url),
  "utf8",
);
const resolverBoundary = endpointResolver.slice(
  endpointResolver.indexOf("export async function resolveWhatsAppEndpoint"),
  endpointResolver.indexOf("export async function getWhatsAppEndpoints"),
);
assert.doesNotMatch(resolverBoundary, /\.from\("branches"\)/);
assert.match(resolverBoundary, /WhatsApp endpoint resolution failed/);

const webhook = await readFile(
  new URL("../src/app/api/webhooks/whatsapp/route.ts", import.meta.url),
  "utf8",
);
assert.match(webhook, /recoverWhatsAppDeliveries/);
assert.match(webhook, /hasRecoverableWhatsAppDeliveries/);
assert.match(webhook, /suppressAI/);
assert.doesNotMatch(webhook, /sendWhatsAppText/);

const conversationTurn = await readFile(
  new URL("../src/services/conversation-turn.server.ts", import.meta.url),
  "utf8",
);
const fallbackAiGuard = conversationTurn.indexOf("if (!context.shouldCallAI)");
const generalAiGuard = conversationTurn.indexOf(
  "if (!context.shouldCallAI)",
  fallbackAiGuard + 1,
);
assert.ok(generalAiGuard > 0);
assert.ok(generalAiGuard < conversationTurn.indexOf("generateValidatedReply(context)"));

console.log("Outbound retry/ambiguity policy checks passed.");
console.log("Atomic automation/rate-limit SQL contract checks passed.");
console.log("Disabled-endpoint fail-closed contract checks passed.");
console.log("Webhook recovery and cost-control integration checks passed.");
