import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  isPersistedMessageForClaim,
  requiresLegacyDeliveryPreparation,
} from "../src/lib/whatsapp-delivery-optimization.ts";

const readSource = (relativePath) =>
  readFile(new URL(`../${relativePath}`, import.meta.url), "utf8");

assert.equal(requiresLegacyDeliveryPreparation("endpoint-1"), false);
assert.equal(requiresLegacyDeliveryPreparation(null), true);

const claim = { message_id: "message-1", conversation_id: "conversation-1" };
const persistedMessage = {
  id: "message-1",
  conversation_id: "conversation-1",
  sender_type: "ai",
};
assert.equal(isPersistedMessageForClaim(claim, persistedMessage), true);
assert.equal(
  isPersistedMessageForClaim(claim, {
    ...persistedMessage,
    conversation_id: "another-conversation",
  }),
  false,
);
assert.equal(
  isPersistedMessageForClaim(claim, {
    ...persistedMessage,
    sender_type: "customer",
  }),
  false,
);

const [
  webhook,
  endpoint,
  manager,
  turn,
  outbox,
  knowledge,
  reply,
  deliveryMigration,
  latencyMigration,
] = await Promise.all([
  readSource("src/app/api/webhooks/whatsapp/route.ts"),
  readSource("src/services/whatsapp-endpoint.server.ts"),
  readSource("src/services/conversation-manager.server.ts"),
  readSource("src/services/conversation-turn.server.ts"),
  readSource("src/services/whatsapp-outbox.server.ts"),
  readSource("src/services/knowledge-layer.server.ts"),
  readSource("src/services/conversation-reply.server.ts"),
  readFile(
    new URL(
      "../../supabase/migrations/20250101000028_finalize_whatsapp_delivery_atomically.sql",
      import.meta.url,
    ),
    "utf8",
  ),
  readFile(
    new URL(
      "../../supabase/migrations/20250101000029_reduce_whatsapp_network_waves.sql",
      import.meta.url,
    ),
    "utf8",
  ),
]);

// Preparation is skipped only from the endpoint persisted on the authoritative
// conversation context. Legacy/null endpoints retain the repair update.
assert.match(turn, /deliveryEndpointId: context\.conversation\.whatsapp_endpoint_id/);
assert.match(
  webhook,
  /requiresLegacyDeliveryPreparation\(turn\.deliveryEndpointId \?\? null\)/,
);
assert.match(webhook, /await prepareWhatsAppDelivery/);

// Immediate delivery receives the exact row returned by the durable insert.
// Recovery and automation callers still omit it and therefore reload storage.
assert.match(webhook, /deliverWhatsAppMessage\(message\.id, message\)/);
assert.match(outbox, /isPersistedMessageForClaim\(delivery, persistedMessage\)/);
assert.match(outbox, /if \(!data\)[\s\S]*\.from\("messages"\)/);

// The sending boundary remains before Meta, and accepted delivery uses one
// atomic RPC rather than a separate message mirror update.
assert.ok(
  outbox.indexOf("beginDeliverySend(delivery)") < outbox.indexOf("await send()"),
);
assert.match(outbox, /finalize_whatsapp_outbound_delivery/);
assert.doesNotMatch(outbox, /updateMessage\(message\.id/);
assert.match(outbox, /accepted send could not be finalized/);
assert.match(outbox, /return "uncertain"/);

// Stale tokens or non-sending rows cannot finalize. The message mirror occurs
// in the same transaction and the RPC is service-role-only.
assert.match(deliveryMigration, /and status = 'sending'/i);
assert.match(deliveryMigration, /and claim_token = p_claim_token/i);
assert.match(deliveryMigration, /returning message_id, conversation_id/i);
assert.match(
  deliveryMigration,
  /update public\.messages[\s\S]*whatsapp_message_id = p_meta_message_id[\s\S]*delivered_at = p_sent_at/i,
);
assert.match(
  deliveryMigration,
  /raise exception 'Outbound message mirror is unavailable\.'/i,
);
assert.match(
  deliveryMigration,
  /revoke all on function public\.finalize_whatsapp_outbound_delivery[\s\S]*from public, anon, authenticated/i,
);
assert.match(
  deliveryMigration,
  /grant execute on function public\.finalize_whatsapp_outbound_delivery[\s\S]*to service_role/i,
);

// Established-branch reads may start early, but are consumed only when branch
// resolution confirms the same authoritative branch.
assert.ok(
  knowledge.indexOf("const earlyPrimaryReads") <
    knowledge.indexOf("await branchResolutionPromise"),
);
assert.match(
  knowledge,
  /establishedBranchId !== null && branchId === establishedBranchId/,
);
assert.match(knowledge, /fetchActivePackages\(gymId, rb\.id, "cross_branch"\)/);
assert.match(knowledge, /fetchActiveOffersForKnowledge/);

// Endpoint resolution and the first duplicate lookup share one remote call.
// Hashed rate-limit keys stay application-owned, while established ingestion
// consumes them transactionally with the second duplicate boundary.
assert.match(endpoint, /prepare_whatsapp_inbound/);
assert.match(webhook, /const preflight = await prepareWhatsAppInbound/);
assert.doesNotMatch(webhook, /await resolveWhatsAppEndpoint/);
assert.match(webhook, /aiRateLimit: consolidateAIRateLimit \? aiRateLimit : undefined/);
assert.match(
  webhook,
  /event\.messageType !== "audio" && destination\.endpointId !== null/,
);
assert.match(manager, /ingest_established_whatsapp_message/);
assert.match(manager, /consolidated_ingestion: true/);
assert.match(
  manager,
  /New endpoint conversations retain the existing creation\/fallback path/,
);
assert.match(manager, /getConversationByPhone/);
assert.match(manager, /createConversation\(\{/);
assert.match(turn, /event\.aiRateLimit/);
assert.match(turn, /if \(context\.duplicateInbound\)/);
assert.match(latencyMigration, /where e\.phone_number_id = p_phone_number_id/i);
assert.match(latencyMigration, /if v_endpoint\.is_active then/i);
assert.match(latencyMigration, /public\.prepare_whatsapp_inbound/i);
assert.match(latencyMigration, /public\.consume_rate_limit\(/i);
assert.match(
  latencyMigration,
  /where e\.id = p_endpoint_id[\s\S]*and e\.gym_id = p_gym_id[\s\S]*and e\.is_active = true/i,
);
assert.match(
  latencyMigration,
  /on conflict \(whatsapp_message_id\)[\s\S]*where whatsapp_message_id is not null[\s\S]*do nothing/i,
);
assert.match(
  latencyMigration,
  /order by m\.created_at desc, m\.id desc[\s\S]*limit v_limit/i,
);
assert.match(
  latencyMigration,
  /when c\.branch_id is null and v_endpoint\.branch_id is not null[\s\S]*else c\.branch_id/i,
);
assert.match(
  latencyMigration,
  /from public, anon, authenticated[\s\S]*to service_role/i,
);

// One-text WhatsApp persistence keeps the mandatory fresh read, then uses an
// optimistic concurrency token for one atomic update + durable message insert.
// Multi-message/media replies retain the existing ordered path.
assert.ok(reply.indexOf("getConversation(conversationId)") >= 0);
assert.match(reply, /persist_whatsapp_ai_text_reply/);
assert.match(reply, /p_expected_updated_at: conversationResult\.data\.updated_at/);
assert.match(
  reply,
  /atomicWhatsAppTextPersistence &&[\s\S]*sequence\.length === 1 &&[\s\S]*sequence\[0\]\?\.type === "text"/,
);
assert.ok(reply.indexOf("updateConversation(") < reply.indexOf("createMessage({"));
assert.match(latencyMigration, /for update/i);
assert.match(latencyMigration, /updated_at is distinct from p_expected_updated_at/i);
assert.match(
  latencyMigration,
  /b\.id = p_branch_id and b\.gym_id = v_conversation\.gym_id/i,
);
assert.match(
  latencyMigration,
  /update public\.conversations[\s\S]*insert into public\.messages/i,
);
assert.doesNotMatch(
  latencyMigration.slice(latencyMigration.indexOf("persist_whatsapp_ai_text_reply")),
  /set status\s*=/i,
);

console.log("Authoritative preparation-skip and durable message-reuse checks passed.");
console.log("Atomic sent finalization and stale-claim protections passed.");
console.log("Established-branch knowledge overlap checks passed.");
console.log("Preflight and transactional ingestion wave checks passed.");
console.log("Optimistic atomic text persistence and media fallback checks passed.");
