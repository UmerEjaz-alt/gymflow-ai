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

const [webhook, turn, outbox, knowledge, reply, migration] = await Promise.all([
  readSource("src/app/api/webhooks/whatsapp/route.ts"),
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
assert.match(migration, /and status = 'sending'/i);
assert.match(migration, /and claim_token = p_claim_token/i);
assert.match(migration, /returning message_id, conversation_id/i);
assert.match(
  migration,
  /update public\.messages[\s\S]*whatsapp_message_id = p_meta_message_id[\s\S]*delivered_at = p_sent_at/i,
);
assert.match(migration, /raise exception 'Outbound message mirror is unavailable\.'/i);
assert.match(
  migration,
  /revoke all on function public\.finalize_whatsapp_outbound_delivery[\s\S]*from public, anon, authenticated/i,
);
assert.match(
  migration,
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

// Reply persistence intentionally retains its fresh conversation read and
// ordered update-before-insert behavior.
assert.ok(reply.indexOf("getConversation(conversationId)") >= 0);
assert.ok(reply.indexOf("updateConversation(") < reply.indexOf("createMessage({"));

console.log("Authoritative preparation-skip and durable message-reuse checks passed.");
console.log("Atomic sent finalization and stale-claim protections passed.");
console.log("Established-branch knowledge overlap checks passed.");
console.log("Fresh reply-state and ordered persistence checks passed.");
