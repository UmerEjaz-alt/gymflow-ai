import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const readSource = (relativePath) =>
  readFile(new URL(`../${relativePath}`, import.meta.url), "utf8");

const [migration, conversationTypes, conversationService, manager, whatsappMigration] =
  await Promise.all([
    readFile(
      new URL(
        "../../supabase/migrations/20250101000030_add_sms_identity_foundation.sql",
        import.meta.url,
      ),
      "utf8",
    ),
    readSource("src/types/conversation.ts"),
    readSource("src/services/conversation.server.ts"),
    readSource("src/services/conversation-manager.server.ts"),
    readFile(
      new URL(
        "../../supabase/migrations/20250101000014_create_whatsapp_endpoints.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  ]);

// A. Existing callers retain WhatsApp as the explicit default, and the exact
// WhatsApp endpoint query remains source-scoped.
assert.match(conversationService, /const source = identity\.source \?\? "whatsapp"/);
assert.match(
  conversationService,
  /if \(endpointId\)[\s\S]*\.eq\("source", source\)[\s\S]*\.eq\("whatsapp_endpoint_id", endpointId\)/,
);

// B-D. Both channels are valid, every non-RPC lookup is source-scoped, and
// endpoint-backed SMS has a dedicated authoritative lookup path.
assert.match(conversationTypes, /"whatsapp"\s*\|\s*"sms"/);
assert.match(
  conversationService,
  /if \(smsEndpointId\)[\s\S]*\.eq\("source", source\)[\s\S]*\.eq\("sms_endpoint_id", smsEndpointId\)/,
);
assert.match(
  conversationService,
  /\.eq\("customer_phone", phone\)[\s\S]*\.eq\("source", source\)/,
);
assert.match(manager, /\{ source, smsEndpointId \}/);
assert.match(manager, /sms_endpoint_id: smsEndpointId \?\? null/);

// E. The same customer can have one conversation per SMS destination. The
// null-endpoint index excludes both endpoint-backed channel types.
assert.match(
  migration,
  /create unique index conversations_gym_sms_endpoint_customer_phone_key[\s\S]*on public\.conversations\(gym_id, sms_endpoint_id, customer_phone\)[\s\S]*where sms_endpoint_id is not null/i,
);
assert.match(
  migration,
  /create unique index conversations_gym_null_endpoint_customer_phone_key[\s\S]*where whatsapp_endpoint_id is null and sms_endpoint_id is null/i,
);

// F-G. Endpoint and branch ownership are protected at the database boundary.
assert.match(
  migration,
  /where e\.id = new\.sms_endpoint_id[\s\S]*and e\.gym_id = new\.gym_id/i,
);
assert.match(
  migration,
  /where b\.id = new\.branch_id[\s\S]*and b\.gym_id = new\.gym_id/i,
);
assert.match(migration, /SMS endpoint gym_id cannot be changed/i);
assert.match(migration, /sms_endpoint_id requires source sms/i);
assert.match(migration, /cannot use both SMS and WhatsApp endpoints/i);
assert.match(
  migration,
  /constraint conversations_sms_endpoint_channel_check[\s\S]*source = 'sms'[\s\S]*whatsapp_endpoint_id is null/i,
);

// Endpoint routing needs one globally unambiguous destination number, while a
// provider-native identifier is unique only within its provider namespace.
assert.match(
  migration,
  /create unique index sms_endpoints_normalized_phone_unique[\s\S]*regexp_replace\(phone_number, '\\D', '', 'g'\)/i,
);
assert.match(
  migration,
  /create unique index sms_endpoints_provider_number_id_unique[\s\S]*\(provider, provider_number_id\)[\s\S]*where provider_number_id is not null/i,
);

// Owner-isolated RLS covers every operation and no credential field exists.
for (const operation of ["select", "insert", "update", "delete"]) {
  assert.match(migration, new RegExp(`sms_endpoints: gym owner can ${operation}`));
}
assert.doesNotMatch(migration, /access_token|auth_token|api_key|secret/i);

// H. The established WhatsApp endpoint identity is unchanged, and the SMS
// migration never drops or recreates it.
assert.match(
  whatsappMigration,
  /create unique index if not exists conversations_gym_endpoint_customer_phone_key[\s\S]*\(gym_id, whatsapp_endpoint_id, customer_phone\)/i,
);
assert.doesNotMatch(
  migration,
  /(?:drop|create)\s+(?:unique\s+)?index[^;]*conversations_gym_endpoint_customer_phone_key/i,
);
assert.doesNotMatch(migration, /alter table public\.whatsapp_endpoints/i);

console.log(
  "SMS endpoint ownership, uniqueness, RLS, and credential-isolation checks passed.",
);
console.log("Cross-channel and per-SMS-endpoint conversation identity checks passed.");
console.log("Source-safe WhatsApp/SMS lookup and creation contract checks passed.");
console.log("Existing WhatsApp endpoint identity remains unchanged.");
