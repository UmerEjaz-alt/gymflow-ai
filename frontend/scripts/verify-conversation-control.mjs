import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { verifyOwnerService } from "./fixtures/control-service-harness.mjs";
import {
  aiControlMatches,
  validateOwnerText,
} from "../src/lib/conversation-control.ts";

// Use an isolated PGlite runtime, never the application's database connection.
// Install it outside project dependencies: npm install --prefix .tmp-control-db --no-save --no-package-lock @electric-sql/pglite esbuild
const runtime =
  process.env.PGLITE_MODULE ??
  new URL(
    "../.tmp-control-db/node_modules/@electric-sql/pglite/dist/index.js",
    import.meta.url,
  ).href;
const { PGlite } = await import(runtime);
const db = new PGlite();
const source = (p) => readFile(new URL(p, import.meta.url), "utf8");
await db.exec(await source("./fixtures/conversation-control.sql"));
const baseline = await source(
  "../../supabase/migrations/20250101000027_add_delivery_claims_and_rate_limits.sql",
);
await db.exec(
  baseline.slice(
    0,
    baseline.indexOf("create table if not exists public.rate_limit_buckets"),
  ),
);
await db.exec(
  await source(
    "../../supabase/migrations/20250101000028_finalize_whatsapp_delivery_atomically.sql",
  ),
);
const atomic = await source(
  "../../supabase/migrations/20250101000029_reduce_whatsapp_network_waves.sql",
);
await db.exec(
  atomic.slice(
    atomic.indexOf("create or replace function public.persist_whatsapp_ai_text_reply"),
  ),
);
await db.exec(
  await source("../../supabase/migrations/20250101000034_add_conversation_control.sql"),
);

const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const gym = id(1),
  otherGym = id(2),
  owner = id(3),
  otherOwner = id(4),
  branch = id(5),
  otherBranch = id(6),
  endpoint = id(7);
const A = id(10),
  B = id(11),
  closed = id(12),
  simulator = id(13),
  expired = id(14),
  ambiguous = id(15);
const q = (sql, args = []) => db.query(sql, args);
const row = async (sql, args = []) => (await q(sql, args)).rows[0];
await q("insert into gyms values($1,$2),($3,$4)", [gym, owner, otherGym, otherOwner]);
await q("insert into branches values($1,$2),($3,$2)", [branch, gym, otherBranch]);
await q(
  "insert into whatsapp_endpoints(id,gym_id,branch_id,phone_number_id) values($1,$2,$3,'meta-original')",
  [endpoint, gym, branch],
);
for (const c of [A, B, closed, simulator, expired, ambiguous])
  await q(
    "insert into conversations(id,gym_id,branch_id,whatsapp_endpoint_id,customer_phone,status,source) values($1,$2,$3,$4,$5,$6,$7)",
    [
      c,
      gym,
      branch,
      c === ambiguous ? null : endpoint,
      `customer-${c}`,
      c === closed ? "closed" : "active",
      c === simulator ? "simulator" : "whatsapp",
    ],
  );
async function inbound(c, hours = 0, providerHours = hours) {
  return row(
    "insert into messages(conversation_id,sender_type,content,whatsapp_message_id,created_at,metadata) values($1,'customer','Hello',$2,now()-make_interval(hours=>$3),jsonb_build_object('timestamp',(extract(epoch from now()-make_interval(hours=>$4)))::bigint::text)) returning *",
    [c, crypto.randomUUID(), hours, providerHours],
  );
}
async function ai(c, version = 0, automation = false) {
  return row(
    "insert into messages(conversation_id,sender_type,content,metadata) values($1,'ai','AI reply',jsonb_build_object('outbound_delivery','whatsapp_outbox','control_version',$2::integer,'automation',$3::boolean)) returning *",
    [c, version, automation],
  );
}
async function withOwner(actor, fn) {
  await q("select set_config('request.jwt.claim.sub',$1,false)", [actor]);
  await db.exec("set role authenticated");
  try {
    return await fn();
  } finally {
    await db.exec("reset role");
  }
}
const control = (c, takeOver, b = branch, actor = owner) =>
  withOwner(
    actor,
    async () =>
      (
        await row("select set_owner_conversation_control($1,$2,$3,$4) as result", [
          c,
          gym,
          b,
          takeOver,
        ])
      ).result,
  );
const send = (c, version, key, text = "Owner reply", b = branch, actor = owner) =>
  withOwner(
    actor,
    async () =>
      (
        await row(
          "select persist_owner_whatsapp_message($1,$2,$3,$4,$5,$6) as result",
          [c, gym, b, version, text, key],
        )
      ).result,
  );
const claim = async (m) =>
  await row("select * from claim_whatsapp_outbound_delivery($1,null)", [m.id]);
const begin = async (d) =>
  (await row("select begin_whatsapp_outbound_send($1,$2) as ok", [d.id, d.claim_token]))
    .ok;
for (const c of [A, B, closed, simulator, ambiguous]) await inbound(c);
await inbound(expired, 0, 25); // Delayed ingestion must not extend the provider window.
const config = id(80);
const claimAutomation = async (c, key) =>
  (
    await q("select * from claim_automation_execution($1,$2,$3,$4,null,$5)", [
      gym,
      branch,
      config,
      c,
      key,
    ])
  ).rows;
const originalAutomation = (await claimAutomation(A, "original"))[0];
assert.equal(originalAutomation.control_version, 0);

const queuedA = await ai(A),
  normalB = await ai(B);
const processingA = await ai(A);
const oldClaim = await claim(processingA);
const failedA = await ai(A);
await q("update whatsapp_outbound_deliveries set status='failed' where message_id=$1", [
  failedA.id,
]);
const sendingA = await ai(A);
await q(
  "update whatsapp_outbound_deliveries set status='sending',retryable=false where message_id=$1",
  [sendingA.id],
);
const uncertainA = await ai(A);
await q(
  "update whatsapp_outbound_deliveries set status='uncertain',retryable=false where message_id=$1",
  [uncertainA.id],
);
const takeover = await control(A, true);
assert.equal(takeover.conversation.status, "human");
assert.equal(takeover.conversation.control_version, 1);
assert.equal(takeover.conversation.ai_enabled, true);
assert(takeover.notice);
assert.equal(await begin(oldClaim), false);
for (const m of [processingA, failedA]) {
  const d = await row(
    "select status,retryable from whatsapp_outbound_deliveries where message_id=$1",
    [m.id],
  );
  assert.equal(d.status, "failed");
  assert.equal(d.retryable, false);
}
assert.equal(
  (
    await row("select status from whatsapp_outbound_deliveries where message_id=$1", [
      queuedA.id,
    ])
  ).status,
  "failed",
);
assert.equal(
  (
    await row(
      "select retryable from whatsapp_outbound_deliveries where message_id=$1",
      [queuedA.id],
    )
  ).retryable,
  false,
);
for (const [m, status] of [
  [sendingA, "sending"],
  [uncertainA, "uncertain"],
])
  assert.equal(
    (
      await row("select status from whatsapp_outbound_deliveries where message_id=$1", [
        m.id,
      ])
    ).status,
    status,
  );
assert.equal(
  (await row("select control_version from conversations where id=$1", [B]))
    .control_version,
  0,
);
assert.equal(await begin(await claim(normalB)), true); // A takeover does not stop B.
await assert.rejects(() => ai(A, 0), /control changed/);
await assert.rejects(() => ai(A, 1, true), /control changed/);
const received = await inbound(A);
assert.equal(received.sender_type, "customer");
assert.equal((await claimAutomation(A, "human")).length, 0);
assert(!aiControlMatches(takeover.conversation, 1));
assert.equal((await control(A, true)).conversation.control_version, 1); // Duplicate takeover is idempotent.

const request = crypto.randomUUID();
const human = await send(A, 1, request);
assert.equal(human.sender_type, "human");
assert.equal(human.metadata.actor_user_id, owner);
assert.equal(human.metadata.control_version, 1);
assert.equal((await send(A, 1, request)).id, human.id);
const simultaneous = await withOwner(owner, async () =>
  Promise.all(
    [1, 2].map(() =>
      row(
        "select persist_owner_whatsapp_message($1,$2,$3,1,'Owner reply',$4) as result",
        [A, gym, branch, request],
      ),
    ),
  ),
);
assert(simultaneous.every((r) => r.result.id === human.id));
await assert.rejects(
  () =>
    q(
      "insert into messages(conversation_id,sender_type,content,client_request_id) values($1,'human','Duplicate',$2)",
      [A, request],
    ),
  /messages_owner_request_unique/,
);
await assert.rejects(() => send(A, 1, request, "different"), /different content/);
assert.equal(
  (
    await row(
      "select count(*)::integer as n from messages where client_request_id=$1",
      [request],
    )
  ).n,
  1,
);
const humanDelivery = await row(
  "select * from whatsapp_outbound_deliveries where message_id=$1",
  [human.id],
);
assert.equal(humanDelivery.phone_number_id, "meta-original");
assert.equal(humanDelivery.recipient_phone, `customer-${A}`);
await assert.rejects(() => control(A, false), /still being sent/);
// A possibly accepted earlier send must not be falsely cancelled or overtaken.
const deferred = await claim(human);
assert.equal(await begin(deferred), false);
await q("update whatsapp_outbound_deliveries set status='sent' where message_id=$1", [
  sendingA.id,
]);
await q(
  "update whatsapp_outbound_deliveries set next_attempt_at=now() where message_id=$1",
  [human.id],
);
const hclaim = await claim(human);
assert.equal(await begin(hclaim), true);
assert.equal(
  (
    await row(
      "select finalize_whatsapp_outbound_delivery($1,$2,'meta-human',now()) as ok",
      [hclaim.id, hclaim.claim_token],
    )
  ).ok,
  true,
);
assert.equal(
  (await row("select whatsapp_message_id from messages where id=$1", [human.id]))
    .whatsapp_message_id,
  "meta-human",
);
const before = (
  await row("select count(*)::integer as n from messages where conversation_id=$1", [A])
).n;
const returned = await control(A, false);
assert.equal(returned.conversation.control_version, 2);
assert.equal(returned.conversation.status, "active");
assert.equal((await send(A, 1, request)).id, human.id); // Lost-response retry still resolves after return.
await q(
  "update whatsapp_outbound_deliveries set status='pending',retryable=true,next_attempt_at=now() where message_id=$1",
  [queuedA.id],
);
assert.equal(await begin(await claim(queuedA)), false); // Even a forced retry cannot cross the old epoch boundary.
await q(
  "update automation_executions set status='failed',lease_expires_at=null where id=$1",
  [originalAutomation.id],
);
assert.equal((await claimAutomation(A, "original")).length, 0); // Failed-generation retry cannot adopt epoch 2.
assert.equal((await claimAutomation(A, "fresh"))[0].control_version, 2);
assert.equal(
  (
    await row("select count(*)::integer as n from messages where conversation_id=$1", [
      A,
    ])
  ).n,
  before,
); // No catch-up/replay.
await assert.rejects(() => ai(A, 0), /control changed/);
await assert.rejects(() => ai(A, 1), /control changed/);
await assert.rejects(() => send(A, 2, crypto.randomUUID()), /control changed/);
const future = await ai(A, 2);
assert.equal(await begin(await claim(future)), true);
await assert.rejects(() => ai(closed, 0, true), /control changed/);
assert.equal((await claimAutomation(closed, "closed")).length, 0);
await assert.rejects(() => control(closed, true), /cannot change control/);
await ai(simulator); // Existing simulator inserts still succeed and need no human action.
await assert.rejects(() => control(simulator, true), /cannot change control/);
await assert.rejects(() => control(B, true, branch, otherOwner), /outside/);
await assert.rejects(
  () => send(A, 2, crypto.randomUUID(), "unauthorized", branch, otherOwner),
  /outside/,
);
await assert.rejects(() => control(A, false, branch, otherOwner), /outside/);
await assert.rejects(() => control(B, true, otherBranch), /outside/);
await assert.rejects(
  () => send(A, 2, crypto.randomUUID(), "wrong branch", otherBranch),
  /outside/,
);
await control(expired, true);
await assert.rejects(() => send(expired, 1, crypto.randomUUID()), /24 hours/);
await control(ambiguous, true);
await assert.rejects(
  () => send(ambiguous, 1, crypto.randomUUID()),
  /original WhatsApp number/,
);
// Epoch/state fence also rolls back the original optimized atomic AI persistence RPC.
const current = await row("select * from conversations where id=$1", [A]);
await assert.rejects(
  () =>
    q(
      "select * from persist_whatsapp_ai_text_reply($1,$2,'{}',false,null,null,null,false,null,now(),'stale',jsonb_build_object('control_version',0,'outbound_delivery','whatsapp_outbox'))",
      [A, current.updated_at],
    ),
  /control changed/,
);
assert.equal(
  (await row("select count(*)::integer as n from messages where content='stale'")).n,
  0,
);
await assert.rejects(
  () => q("select update_ai_conversation_controlled($1,0,false,'{}')", [A]),
  /control changed/,
);
const bookingPayload = {
  gym_id: gym,
  branch_id: branch,
  conversation_id: A,
  customer_name: "Customer",
  booking_type: "gym_visit",
  scheduled_at: new Date(Date.now() + 86400000).toISOString(),
  duration_minutes: 30,
};
await assert.rejects(
  () =>
    q("select execute_controlled_booking_mutation($1,0,'create',null,$2::jsonb)", [
      A,
      JSON.stringify(bookingPayload),
    ]),
  /control changed/,
);
assert.equal((await row("select count(*)::integer as n from bookings")).n, 0);
const booking = (
  await row(
    "select execute_controlled_booking_mutation($1,2,'create',null,$2::jsonb) as b",
    [A, JSON.stringify(bookingPayload)],
  )
).b;
await control(A, true);
await assert.rejects(
  () =>
    q("select execute_controlled_booking_mutation($1,2,'cancel',$2,'{}')", [
      A,
      booking.id,
    ]),
  /control changed/,
);
await assert.rejects(
  () =>
    q("select execute_controlled_booking_mutation($1,2,'reschedule',$2,$3::jsonb)", [
      A,
      booking.id,
      JSON.stringify({ scheduled_at: new Date(Date.now() + 172800000).toISOString() }),
    ]),
  /control changed/,
);
assert.equal(
  (await row("select status from bookings where id=$1", [booking.id])).status,
  "upcoming",
);
assert.equal(validateOwnerText("  "), "Enter a message to send.");
assert(validateOwnerText("a".repeat(4097)));
assert.equal(validateOwnerText("Owner reply"), null);
const snapshotSource = await source("../src/services/conversation-control.server.ts");
assert.match(snapshotSource, /auth\.getUser\(\)/);
assert.match(snapshotSource, /conversationMatchesScope/);
const prompt = await source("../src/services/prompt-builder.server.ts");
assert.match(prompt, /senderType === "customer" \? "user" : "assistant"/);
console.log(
  "Single-connection PGlite migration and control tests passed (not real concurrent transactions): isolation, human/closed gates, stale epochs, atomic rollback, queue cancellation, external-send preservation, owner idempotency, auth/branch scope, service window, endpoint authority, booking fencing, simulator compatibility, and no catch-up.",
);
await q(
  "update whatsapp_outbound_deliveries set status='sent' where conversation_id=$1 and status='sending'",
  [A],
);
await verifyOwnerService(db, { gym, branch, owner, otherOwner, conversationId: A });
// A window/endpoint can disappear AFTER enqueueing; guard them at the actual send boundary too.
const delayed = id(90);
await q(
  "insert into conversations(id,gym_id,branch_id,whatsapp_endpoint_id,customer_phone) values($1,$2,$3,$4,'delayed-customer')",
  [delayed, gym, branch, endpoint],
);
await inbound(delayed);
await control(delayed, true);
const delayedHuman = await send(delayed, 1, crypto.randomUUID());
await q(
  "update messages set created_at=now()-interval '25 hours',metadata='{}' where conversation_id=$1 and sender_type='customer'",
  [delayed],
);
assert.equal(await begin(await claim(delayedHuman)), false);
assert.match(
  (
    await row(
      "select last_error from whatsapp_outbound_deliveries where message_id=$1",
      [delayedHuman.id],
    )
  ).last_error,
  /window expired/,
);
await inbound(delayed); // A new CUSTOMER message opens the window again; owner timestamps cannot.
const endpointGone = await send(delayed, 1, crypto.randomUUID());
await q("update whatsapp_endpoints set is_active=false where id=$1", [endpoint]);
assert.equal(await begin(await claim(endpointGone)), false);
assert.equal(
  (
    await row(
      "select retryable from whatsapp_outbound_deliveries where message_id=$1",
      [endpointGone.id],
    )
  ).retryable,
  false,
);
await q("update whatsapp_endpoints set is_active=true where id=$1", [endpoint]);
await control(delayed, false);
await q("update conversations set ai_enabled=false where id=$1", [delayed]);
await assert.rejects(() => ai(delayed, 3), /control changed/);
const explicitAutomation = await ai(delayed, 3, true);
assert.equal(explicitAutomation.metadata.automation, true);
assert.equal((await control(delayed, true)).conversation.ai_enabled, false);
const restored = await control(delayed, false);
assert.equal(restored.conversation.ai_enabled, false);
assert.equal(restored.conversation.status, "active");
await assert.rejects(() => ai(delayed, 5), /control changed/);
assert.equal(restored.conversation.control_version, 5);
await withOwner(owner, async () => {
  await assert.rejects(
    () => q("select set_owner_conversation_control($1,null,$2,true)", [A, branch]),
    /outside/,
  );
  await assert.rejects(
    () =>
      q("select persist_owner_whatsapp_message($1,$2,$3,null,'Null epoch',$4)", [
        A,
        gym,
        branch,
        crypto.randomUUID(),
      ]),
    /control changed/,
  );
  await assert.rejects(
    () =>
      q("select begin_whatsapp_outbound_send($1,$2)", [hclaim.id, hclaim.claim_token]),
    /permission denied/,
  );
  await assert.rejects(
    () =>
      q("select * from claim_automation_execution($1,$2,$3,$4,null,'bad')", [
        gym,
        branch,
        config,
        A,
      ]),
    /permission denied/,
  );
});
console.log(
  "Post-enqueue window/endpoint expiry, explicit automation ai_enabled semantics, null/stale ownership guards, duplicate request submissions, database uniqueness and service-role-only delivery checks passed.",
);
// Mixed deployments: legacy service workers keep epoch-zero authority only.
await q("select set_config('request.jwt.claim.sub','',false)");
const legacy = id(91);
await q(
  "insert into conversations(id,gym_id,branch_id,whatsapp_endpoint_id,customer_phone) values($1,$2,$3,$4,'legacy')",
  [legacy, gym, branch, endpoint],
);
await q(
  "insert into bookings(gym_id,conversation_id,customer_name,scheduled_at,duration_minutes,source) values($1,$2,'Legacy',now(),30,'whatsapp')",
  [gym, legacy],
);
await q("update conversations set customer_memory='{\"legacy\":true}' where id=$1", [
  legacy,
]);
const oldAtomicConversation = await row("select * from conversations where id=$1", [
  legacy,
]);
assert.equal(
  (
    await row(
      "select * from persist_whatsapp_ai_text_reply($1,$2,'{}',false,null,null,null,false,null,now(),'Legacy epoch zero','{\"outbound_delivery\":\"whatsapp_outbox\"}')",
      [legacy, oldAtomicConversation.updated_at],
    )
  ).outcome,
  "saved",
);
await control(legacy, true);
await control(legacy, false);
await q("select set_config('request.jwt.claim.sub','',false)");
await assert.rejects(
  () =>
    q(
      "insert into bookings(gym_id,conversation_id,customer_name,source) values($1,$2,'Stale','whatsapp')",
      [gym, legacy],
    ),
  /control changed/,
);
await assert.rejects(
  () => q("update bookings set status='cancelled' where conversation_id=$1", [legacy]),
  /control changed/,
);
await assert.rejects(
  () =>
    q("update conversations set customer_memory='{\"stale\":true}' where id=$1", [
      legacy,
    ]),
  /control changed/,
);
const fresh = await row("select * from conversations where id=$1", [legacy]);
const atomicReply = await row(
  "select * from persist_controlled_whatsapp_ai_text_reply($1,$2,'{}',true,'{\"fresh\":true}',null,null,false,null,now(),'Fresh epoch two',jsonb_build_object('control_version',2,'outbound_delivery','whatsapp_outbox'))",
  [legacy, fresh.updated_at],
);
assert.equal(atomicReply.outcome, "saved");
assert.equal(atomicReply.message_row.metadata.control_version, 2);
assert.equal(
  (await row("select current_setting('kroway.ai_control_version',true) as epoch"))
    .epoch,
  "",
);
await q("select execute_controlled_booking_mutation($1,2,'create',null,$2::jsonb)", [
  legacy,
  JSON.stringify({ ...bookingPayload, conversation_id: legacy }),
]);
// Manual authenticated calendar writes retain their established behavior.
await control(legacy, true);
await withOwner(owner, () =>
  q("update bookings set status='cancelled' where conversation_id=$1", [legacy]),
);
const legacyAutomation = id(92);
await q(
  "insert into conversations(id,gym_id,branch_id,whatsapp_endpoint_id,ai_enabled,customer_phone) values($1,$2,$3,$4,false,'legacy-automation')",
  [legacyAutomation, gym, branch, endpoint],
);
await q("select set_config('request.jwt.claim.sub','',false)");
await claimAutomation(legacyAutomation, "legacy-disabled");
const legacyMessage = await row(
  "insert into messages(conversation_id,sender_type,content,metadata) values($1,'ai','Legacy automation','{\"outbound_delivery\":\"whatsapp_outbox\"}') returning *",
  [legacyAutomation],
);
assert.equal(legacyMessage.metadata.automation, true);
await q("update messages set metadata=metadata-'automation' where id=$1", [
  legacyMessage.id,
]);
await q(
  "update automation_executions set sent_message_id=$1 where conversation_id=$2",
  [legacyMessage.id, legacyAutomation],
);
assert.equal(await begin(await claim(legacyMessage)), true);
await q(
  "update conversations set latest_understanding='{\"legacy_automation\":true}' where id=$1",
  [legacyAutomation],
);
console.log(
  "Legacy epoch-zero compatibility, stale raw business writes, additive atomic RPC, fresh controlled writes, marker restoration and authenticated manual booking checks passed.",
);
await db.close();
