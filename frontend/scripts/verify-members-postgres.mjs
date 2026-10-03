import assert from "node:assert/strict";
import pg from "pg";
import { initializeMemberDatabase, migration35 } from "./fixtures/member-database.mjs";

// No application env files, staging/prod URLs or existing databases are read.
const connectionString = process.env.MEMBER_TEST_DATABASE_URL;
if (!connectionString || process.env.MEMBER_TEST_ALLOW_DISPOSABLE_DATABASE !== "1") {
  console.error(
    "NOT RUN: requires MEMBER_TEST_DATABASE_URL and MEMBER_TEST_ALLOW_DISPOSABLE_DATABASE=1 for an empty local kroway_member_test_* database.",
  );
  process.exit(2);
}
const url = new URL(connectionString);
assert(
  ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname),
  "Only a local PostgreSQL target is allowed.",
);
assert(
  /^\/kroway_member_test_[a-z0-9_]+$/.test(url.pathname),
  "Disposable database name required.",
);
const clients = Array.from(
  { length: 4 },
  () => new pg.Client({ connectionString, connectionTimeoutMillis: 5000 }),
);
const [admin, left, right, observer] = clients;
const id = () => crypto.randomUUID();
const gym = id(),
  owner = id(),
  branch = id(),
  pkg = id(),
  endpoint = id();
const row = async (c, s, a = []) => (await c.query(s, a)).rows[0];
const settle = (p) =>
  p.then(
    (value) => ({ value }),
    (error) => ({ error }),
  );
async function blocked(client) {
  const pid = (await row(client, "select pg_backend_pid() pid")).pid;
  return async () => {
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      const state = await row(
        observer,
        "select wait_event_type from pg_stat_activity where pid=$1",
        [pid],
      );
      if (state?.wait_event_type === "Lock") return;
      await new Promise((r) => setTimeout(r, 25));
    }
    throw new Error("Expected a real PostgreSQL lock wait, but none was observed.");
  };
}
async function register(client, request, phone, existing = null, start = "2026-01-01") {
  return row(
    client,
    "select register_member_membership($1,$2,'Concurrency Member',$3,null,$4,$5,null,'manual',$6,null) result",
    [request, branch, phone, pkg, start, existing],
  );
}
async function ownerContext(client) {
  await client.query("select set_config('request.jwt.claim.sub',$1,false)", [owner]);
  await client.query("set role authenticated");
}
async function conversation() {
  const c = id();
  await admin.query(
    "insert into conversations(id,gym_id,branch_id,whatsapp_endpoint_id,customer_phone) values($1,$2,$3,$4,'923007778899')",
    [c, gym, branch, endpoint],
  );
  await admin.query(
    "insert into messages(conversation_id,sender_type,content,whatsapp_message_id) values($1,'customer','Hello',$2)",
    [c, id()],
  );
  return c;
}
async function control(client, c, takeover) {
  return row(client, "select set_owner_conversation_control($1,$2,$3,$4) result", [
    c,
    gym,
    branch,
    takeover,
  ]);
}
const ai = (client, c, version) =>
  row(
    client,
    "insert into messages(conversation_id,sender_type,content,metadata) values($1,'ai','Reply',jsonb_build_object('control_version',$2::integer,'outbound_delivery','whatsapp_outbox')) returning id",
    [c, version],
  );
try {
  await Promise.all(clients.map((c) => c.connect()));
  assert.equal(
    (
      await row(
        admin,
        "select count(*)::int n from pg_tables where schemaname in ('public','auth')",
      )
    ).n,
    0,
    "Refusing a nonempty database.",
  );
  await initializeMemberDatabase(admin);
  await admin.query(await migration35());
  await admin.query("insert into auth.users values($1)", [owner]);
  await admin.query("insert into gyms values($1,$2)", [gym, owner]);
  await admin.query(
    "insert into branches(id,gym_id,country_code,timezone) values($1,$2,'PK','Asia/Karachi')",
    [branch, gym],
  );
  await admin.query(
    "insert into membership_packages(id,gym_id,branch_id,package_name,duration_months) values($1,$2,$3,'Monthly',1)",
    [pkg, gym, branch],
  );
  await admin.query(
    "insert into whatsapp_endpoints(id,gym_id,branch_id,phone_number_id) values($1,$2,$3,'original')",
    [endpoint, gym, branch],
  );
  await ownerContext(left);
  await ownerContext(right);
  const waitRight = await blocked(right);
  const request = id();
  await left.query("begin");
  const first = (await register(left, request, "+923001234567")).result;
  const same = settle(register(right, request, "+923001234567"));
  await waitRight();
  await left.query("commit");
  const sameResult = await same;
  assert.ifError(sameResult.error);
  assert.equal(sameResult.value.result.membership.id, first.membership.id);
  // Different requests for overlapping periods serialize on the same gym lock.
  await left.query("begin");
  await register(left, id(), "+923001234567", first.member.id, "2026-03-01");
  const overlap = settle(
    register(right, id(), "+923001234567", first.member.id, "2026-03-15"),
  );
  await waitRight();
  await left.query("commit");
  assert.match((await overlap).error.message, /overlaps/);
  // Old AI work is rejected after active -> human -> active, even when active again.
  const c = await conversation();
  await control(left, c, true);
  await control(left, c, false);
  await assert.rejects(ai(admin, c, 0), /control changed/);
  // Persistence already holding the conversation lock linearizes before takeover.
  const race = await conversation();
  await left.query("reset role");
  await left.query("begin");
  await ai(left, race, 0);
  const takeover = settle(control(right, race, true));
  await waitRight();
  await left.query("commit");
  assert.ifError((await takeover).error);
  const delivery = await row(
    admin,
    "select status,retryable from whatsapp_outbound_deliveries where conversation_id=$1",
    [race],
  );
  assert.equal(delivery.status, "failed");
  assert.equal(delivery.retryable, false);
  // Takeover wins before queued send boundary: old claims cannot become sending.
  const queued = await conversation();
  const message = await ai(admin, queued, 0);
  const claim = await row(
    admin,
    "select * from claim_whatsapp_outbound_delivery($1,$2)",
    [message.id, queued],
  );
  await ownerContext(left);
  await left.query("begin");
  await control(left, queued, true);
  await right.query("reset role");
  const send = settle(
    row(right, "select begin_whatsapp_outbound_send($1,$2) result", [
      claim.id,
      claim.claim_token,
    ]),
  );
  await waitRight();
  await left.query("commit");
  assert.equal((await send).value.result, false);
  // Send boundary wins first: takeover never falsely recalls an external send.
  const sending = await conversation();
  const sendingMessage = await ai(admin, sending, 0);
  const sendingClaim = await row(
    admin,
    "select * from claim_whatsapp_outbound_delivery($1,$2)",
    [sendingMessage.id, sending],
  );
  await left.query("reset role");
  await left.query("begin");
  assert.equal(
    (
      await row(left, "select begin_whatsapp_outbound_send($1,$2) result", [
        sendingClaim.id,
        sendingClaim.claim_token,
      ])
    ).result,
    true,
  );
  await ownerContext(right);
  const conservative = settle(control(right, sending, true));
  await waitRight();
  await left.query("commit");
  assert.ifError((await conservative).error);
  assert.equal(
    (
      await row(admin, "select status from whatsapp_outbound_deliveries where id=$1", [
        sendingClaim.id,
      ])
    ).status,
    "sending",
  );
  // Takeover and Return-to-AI serialize; preserve ai_enabled and increment twice.
  const toggle = await conversation();
  await admin.query("update conversations set ai_enabled=false where id=$1", [toggle]);
  await ownerContext(left);
  await left.query("begin");
  await control(left, toggle, true);
  const returned = settle(control(right, toggle, false));
  await waitRight();
  await left.query("commit");
  assert.ifError((await returned).error);
  const final = await row(
    admin,
    "select status,ai_enabled,control_version from conversations where id=$1",
    [toggle],
  );
  assert.equal(final.status, "active");
  assert.equal(final.ai_enabled, false);
  assert.equal(final.control_version, 3);
  // Booking mutation cannot cross takeover lock/version boundary.
  const booking = await conversation();
  await left.query("begin");
  await control(left, booking, true);
  await right.query("reset role");
  const action = settle(
    row(
      right,
      "select execute_controlled_booking_mutation($1,0,'create',null,$2) result",
      [
        booking,
        {
          gym_id: gym,
          branch_id: branch,
          customer_name: "Customer",
          customer_phone: "923007778899",
          booking_type: "trial",
          scheduled_at: "2027-01-01T12:00:00Z",
          duration_minutes: 30,
        },
      ],
    ),
  );
  await waitRight();
  await left.query("commit");
  assert.match((await action).error.message, /control changed/);
  console.log(
    "PASS: observed real PostgreSQL lock waits for request idempotency, overlap, AI persistence/takeover, queued send/takeover, external-send conservation, concurrent ownership changes and booking/takeover.",
  );
} finally {
  await Promise.allSettled(clients.map((c) => c.query("rollback")));
  await Promise.allSettled(clients.map((c) => c.end()));
}
