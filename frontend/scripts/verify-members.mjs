import assert from "node:assert/strict";
import { initializeMemberDatabase, migration35 } from "./fixtures/member-database.mjs";
import { dateForTimeZone } from "../src/lib/member-import.ts";
import {
  membershipEndDate,
  membershipStatus,
  selectMemberships,
} from "../src/lib/membership-lifecycle.ts";
import { normalizePhoneNumber } from "../src/lib/phone-number.ts";
import {
  verifyMemberServices,
  verifyMemberFormRetry,
} from "./fixtures/member-service-harness.mjs";

const { PGlite } = await import(
  process.env.PGLITE_MODULE ??
    new URL(
      "../.tmp-member-db/node_modules/@electric-sql/pglite/dist/index.js",
      import.meta.url,
    ).href
);
const db = new PGlite();
const q = (sql, args = []) => db.query(sql, args);
const row = async (sql, args = []) => (await q(sql, args)).rows[0];
const id = () => crypto.randomUUID();
const gym = id(),
  otherGym = id(),
  owner = id(),
  otherOwner = id();
const branch = id(),
  branch2 = id(),
  otherBranch = id(),
  pkg = id(),
  pkg2 = id(),
  otherPkg = id(),
  endpoint = id();
await initializeMemberDatabase(db);
await q("insert into auth.users values($1),($2)", [owner, otherOwner]);
await q("insert into gyms values($1,$2),($3,$4)", [gym, owner, otherGym, otherOwner]);
await q(
  "insert into branches(id,gym_id,country_code,timezone,branch_name) values($1,$2,'PK','Asia/Karachi','A'),($3,$2,'PK','Asia/Karachi','B'),($4,$5,'PK','Asia/Karachi','Other')",
  [branch, gym, branch2, otherBranch, otherGym],
);
for (const [p, b, g] of [
  [pkg, branch, gym],
  [pkg2, branch2, gym],
  [otherPkg, otherBranch, otherGym],
])
  await q(
    "insert into membership_packages(id,gym_id,branch_id,package_name,duration_months) values($1,$2,$3,'Monthly',1)",
    [p, g, b],
  );
await q(
  "insert into whatsapp_endpoints(id,gym_id,branch_id,phone_number_id) values($1,$2,$3,'original')",
  [endpoint, gym, branch],
);

// Backfill: compatible identities consolidate; conflicting and local identities remain reviewable.
const legacyA = id(),
  legacyB = id(),
  conflictA = id(),
  conflictB = id(),
  local = id();
for (const [c, n, p] of [
  [legacyA, "Same Person", "+923001112233"],
  [legacyB, "Same Person", "923001112233"],
  [conflictA, "Person One", "923002223344"],
  [conflictB, "Person Two", "923002223344"],
  [local, "Local Person", "03003334455"],
]) {
  await q(
    "insert into conversations(id,gym_id,branch_id,customer_name,customer_phone,source) values($1,$2,$3,$4,$5,'whatsapp')",
    [c, otherGym, otherBranch, n, p],
  );
  await q(
    "insert into memberships(gym_id,branch_id,conversation_id,membership_package_id,start_date,expiry_date) values($1,$2,$3,$4,'2025-01-01','2025-02-01')",
    [otherGym, otherBranch, c, otherPkg],
  );
}
await db.exec(await migration35());
assert.equal((await row("select count(*)::integer n from memberships")).n, 5);
assert.equal(
  (await row("select member_id from conversations where id=$1", [legacyA])).member_id,
  (await row("select member_id from conversations where id=$1", [legacyB])).member_id,
);
assert.equal(
  (await row("select count(*)::integer n from members where phone_e164 is null")).n,
  3,
);
assert.equal(
  (await row("select customer_phone from conversations where id=$1", [legacyB]))
    .customer_phone,
  "923001112233",
);

await q("select set_config('request.jwt.claim.sub',$1,false)", [owner]);
await db.exec("set role authenticated");
async function register({
  request = id(),
  b = branch,
  p = pkg,
  phone = "+923004445566",
  name = "Manual Member",
  start = "2026-01-01",
  end = null,
  source = "manual",
  existing = null,
  conversation = null,
} = {}) {
  return (
    await row(
      "select register_member_membership($1,$2,$3,$4,null,$5,$6,$7,$8,$9,$10) result",
      [request, b, name, phone, p, start, end, source, existing, conversation],
    )
  ).result;
}
const request = id();
const first = await register({ request });
assert.equal(first.member.source, "manual");
assert.equal(first.membership.conversation_id, null);
assert.equal((await register({ request })).membership.id, first.membership.id);
await assert.rejects(register({ request, name: "Changed" }), /different details/);
await assert.rejects(register({ start: "2026-03-01" }), /Confirm Add membership/);
const renewal = await register({ start: "2026-03-01", existing: first.member.id });
assert.equal(renewal.member.id, first.member.id);
await assert.rejects(
  register({ start: "2026-03-15", existing: first.member.id }),
  /overlaps/,
);
const transferred = await register({ b: branch2, p: pkg2, existing: first.member.id });
assert.equal(transferred.member.id, first.member.id);
assert.equal(
  (
    await row("select count(*)::integer n from memberships where member_id=$1", [
      first.member.id,
    ])
  ).n,
  3,
);
await assert.rejects(register({ p: pkg2, phone: "+923005556677" }), /Package/);
await assert.rejects(register({ b: otherBranch, p: otherPkg }), /access denied/);
await assert.rejects(register({ end: "2025-12-01" }), /Expiry/);
await assert.rejects(register({ phone: "03004445566" }), /normalized phone/);
assert.equal(normalizePhoneNumber("03004445566", "PK").e164, first.member.phone_e164);
const importPeriod = await register({
  phone: first.member.phone_e164,
  start: "2026-05-01",
  source: "import",
});
assert.equal(importPeriod.member.id, first.member.id);
assert.equal(importPeriod.member.source, "manual");
await assert.rejects(
  register({
    phone: first.member.phone_e164,
    name: "Different Person",
    start: "2026-07-01",
    source: "import",
  }),
  /different name/,
);
assert.equal(
  (await row("select count(*)::integer n from conversations where gym_id=$1", [gym])).n,
  0,
);
await db.exec("reset role");

// Later authoritative WhatsApp linking preserves control and does not create a period.
const convo = id();
await q(
  "insert into conversations(id,gym_id,branch_id,whatsapp_endpoint_id,customer_name,customer_phone,status,ai_enabled,control_version) values($1,$2,$3,$4,'WhatsApp Name','923004445566','human',false,7)",
  [convo, gym, branch, endpoint],
);
const linked = await row("select * from conversations where id=$1", [convo]);
assert.equal(linked.member_id, first.member.id);
assert.equal(linked.status, "human");
assert.equal(linked.ai_enabled, false);
assert.equal(linked.control_version, 7);
const ambiguous = id();
await q(
  "insert into conversations(id,gym_id,branch_id,customer_phone) values($1,$2,$3,'923002223344')",
  [ambiguous, otherGym, otherBranch],
);
assert.equal(
  (await row("select member_id from conversations where id=$1", [ambiguous])).member_id,
  null,
);
await q("select set_config('request.jwt.claim.sub',$1,false)", [otherOwner]);
await db.exec("set role authenticated");
await assert.rejects(register({ existing: first.member.id }), /access denied/);
assert.equal(
  (await row("select count(*)::integer n from members where gym_id=$1", [gym])).n,
  0,
);
await db.exec("reset role");

const lead = id();
await q(
  "insert into conversations(id,gym_id,branch_id,whatsapp_endpoint_id,customer_phone,customer_name) values($1,$2,$3,$4,'923006667788','Lead')",
  [lead, gym, branch, endpoint],
);
await q(
  "insert into messages(conversation_id,sender_type,content,metadata) values($1,'ai','Welcome','{\"control_version\":0}')",
  [lead],
);
await q("select set_config('request.jwt.claim.sub',$1,false)", [owner]);
await db.exec("set role authenticated");
const converted = await register({
  phone: "+923006667788",
  name: "Lead",
  source: "lead_conversion",
  conversation: lead,
});
assert.equal(converted.member.source, "lead_conversion");
assert.equal(
  (await row("select lead_stage from conversations where id=$1", [lead])).lead_stage,
  "member",
);
assert.equal(
  (await row("select customer_phone from conversations where id=$1", [lead]))
    .customer_phone,
  "923006667788",
);
await db.exec("reset role");

// Due without a channel; no fake inbound or message. Re-evaluate when a channel opens.
const config = id();
await q(
  "insert into automation_configs(id,gym_id,branch_id,automation_type) values($1,$2,$3,'membership_expiry_reminder')",
  [config, gym, branch],
);
await q("select * from claim_membership_automation($1,$2,'expiry-test-1')", [
  config,
  first.membership.id,
]);
const due = await row("select * from automation_executions where membership_id=$1", [
  first.membership.id,
]);
assert.equal(due.conversation_id, null);
assert.equal(due.status, "skipped");
assert.match(due.error_message, /Reminder is due/);
await q("update conversations set status='active' where id=$1", [convo]);
await q(
  "insert into messages(conversation_id,sender_type,content,whatsapp_message_id) values($1,'customer','Hello',$2)",
  [convo, id()],
);
const claimed = await row(
  "select * from claim_membership_automation($1,$2,'expiry-test-1')",
  [config, first.membership.id],
);
assert.equal(claimed.id, due.id);
assert.equal(claimed.conversation_id, convo);
await assert.rejects(
  q(
    "insert into messages(conversation_id,sender_type,content,metadata) values($1,'ai','Old worker reminder',$2)",
    [convo, { control_version: claimed.control_version, automation: true }],
  ),
  /requires event authority/,
);
const reminder = await row(
  "insert into messages(conversation_id,sender_type,content,metadata) values($1,'ai','Reminder',$2) returning *",
  [
    convo,
    {
      control_version: claimed.control_version,
      automation: true,
      outbound_delivery: "whatsapp_outbox",
      automation_execution_id: claimed.id,
      automation_claim_token: claimed.claim_token,
    },
  ],
);
assert.equal(
  (
    await row("select sent_message_id from automation_executions where id=$1", [
      claimed.id,
    ])
  ).sent_message_id,
  reminder.id,
);
await assert.rejects(
  q(
    "insert into messages(conversation_id,sender_type,content,metadata) values($1,'ai','Duplicate',$2)",
    [convo, reminder.metadata],
  ),
);
// Routing drift cannot move a branch-specific reminder to another branch.
await q("update conversations set branch_id=$2 where id=$1", [convo, branch2]);
await q(
  "update automation_executions set lease_expires_at=null,status='failed' where id=$1",
  [claimed.id],
);
assert.equal(
  (
    await q("select * from claim_membership_automation($1,$2,'expiry-test-1')", [
      config,
      first.membership.id,
    ])
  ).rows.length,
  0,
);
const driftDelivery = await row(
  "select * from claim_whatsapp_outbound_delivery($1,$2)",
  [reminder.id, convo],
);
assert.equal(
  (
    await row("select begin_whatsapp_outbound_send($1,$2) result", [
      driftDelivery.id,
      driftDelivery.claim_token,
    ])
  ).result,
  false,
);
assert.match(
  (
    await row("select last_error from whatsapp_outbound_deliveries where id=$1", [
      driftDelivery.id,
    ])
  ).last_error,
  /membership reminder conversation changed/,
);
await q("update conversations set branch_id=$2 where id=$1", [convo, branch]);
await q("update conversations set status='human' where id=$1", [convo]);
await q("update conversations set status='active' where id=$1", [convo]);
await q(
  "update automation_executions set lease_expires_at=null,status='failed' where id=$1",
  [claimed.id],
);
assert.equal(
  (
    await q("select * from claim_membership_automation($1,$2,'expiry-test-1')", [
      config,
      first.membership.id,
    ])
  ).rows.length,
  0,
);
await assert.rejects(
  q(
    "insert into messages(conversation_id,sender_type,content,metadata) values($1,'ai','Stale',$2)",
    [convo, { control_version: claimed.control_version, automation: true }],
  ),
);

// A window closing after generation cannot cross the final durable send boundary.
const fresh = await row(
  "select * from claim_membership_automation($1,$2,'expiry-test-2')",
  [config, first.membership.id],
);
const freshMessage = await row(
  "insert into messages(conversation_id,sender_type,content,metadata) values($1,'ai','Fresh reminder',$2) returning *",
  [
    convo,
    {
      control_version: fresh.control_version,
      automation: true,
      outbound_delivery: "whatsapp_outbox",
      automation_execution_id: fresh.id,
      automation_claim_token: fresh.claim_token,
    },
  ],
);
await q(
  "update messages set created_at=now()-interval '25 hours' where conversation_id=$1 and sender_type='customer'",
  [convo],
);
const outbound = await row("select * from claim_whatsapp_outbound_delivery($1,$2)", [
  freshMessage.id,
  convo,
]);
assert.equal(
  (
    await row("select begin_whatsapp_outbound_send($1,$2) result", [
      outbound.id,
      outbound.claim_token,
    ])
  ).result,
  false,
);
const blocked = await row("select * from whatsapp_outbound_deliveries where id=$1", [
  outbound.id,
]);
assert.equal(blocked.status, "failed");
assert.equal(blocked.retryable, false);
assert.match(blocked.last_error, /approved-template/);
await q("update conversations set status='closed' where id=$1", [convo]);
assert.equal(
  (
    await q("select * from claim_membership_automation($1,$2,'expiry-test-3')", [
      config,
      first.membership.id,
    ])
  ).rows.length,
  0,
);
await assert.rejects(
  q(
    "insert into messages(conversation_id,sender_type,content,metadata) values($1,'ai','Closed',$2)",
    [
      convo,
      {
        control_version: (
          await row("select control_version from conversations where id=$1", [convo])
        ).control_version,
        automation: true,
      },
    ],
  ),
);

// History persists when the conversation is deleted.
await q("delete from messages where conversation_id=$1", [lead]);
await q("delete from conversations where id=$1", [lead]);
assert.equal(
  (
    await row("select conversation_id from memberships where id=$1", [
      converted.membership.id,
    ])
  ).conversation_id,
  null,
);
assert.equal(
  (
    await row("select member_id from memberships where id=$1", [
      converted.membership.id,
    ])
  ).member_id,
  converted.member.id,
);

assert.equal(membershipEndDate("2024-01-31", 1), "2024-02-29");
const today = dateForTimeZone("Asia/Karachi", new Date("2026-10-02T20:00:00Z"));
assert.equal(today, "2026-10-03");
assert.equal(
  membershipStatus({ start_date: "2026-10-04", expiry_date: "2026-11-04" }, today),
  "Scheduled",
);
assert.equal(
  membershipStatus({ start_date: "2026-09-01", expiry_date: today }, today),
  "Active",
);
assert.equal(
  membershipStatus({ start_date: "2026-09-01", expiry_date: "2026-10-02" }, today),
  "Expired",
);
const periods = [
  {
    id: "current",
    member_id: "person",
    branch_id: "branch",
    start_date: "2026-09-01",
    expiry_date: "2026-10-30",
    created_at: "2026-01-01",
  },
  {
    id: "future",
    member_id: "person",
    branch_id: "branch",
    start_date: "2026-10-31",
    expiry_date: "2026-11-30",
    created_at: "2026-01-02",
  },
];
assert.equal(selectMemberships(periods, today)[0].id, "current");
await verifyMemberServices(db, { gym, owner, branch, pkg, endpoint });
await verifyMemberFormRetry();
console.log(
  "PASS: migration/backfill, registration, idempotency, phone identity, reuse, history, branch/tenant isolation, import, conversion, linking, lifecycle suppression, event-message binding, control epochs, deletion, branch-local status. PGlite is single-connection; real concurrency is a separate check.",
);
await db.close();
