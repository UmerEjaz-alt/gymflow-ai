import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import pg from "pg";

// NEVER loads application env files. Requires a dedicated, empty, disposable
// local PostgreSQL cluster/database, not production or an existing staging DB.
const connectionString = process.env.CONTROL_TEST_DATABASE_URL;
if (!connectionString || process.env.CONTROL_TEST_ALLOW_DISPOSABLE_DATABASE !== "1") {
  console.error(
    "NOT RUN: set CONTROL_TEST_DATABASE_URL and CONTROL_TEST_ALLOW_DISPOSABLE_DATABASE=1 for an empty local kroway_control_test_* database.",
  );
  process.exit(2);
}
const url = new URL(connectionString);
assert(
  ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname),
  "Only local disposable PostgreSQL is allowed.",
);
assert(
  /^\/kroway_control_test_[a-z0-9_]+$/.test(url.pathname),
  "Disposable database name required.",
);
const clients = Array.from(
  { length: 4 },
  () => new pg.Client({ connectionString, connectionTimeoutMillis: 5000 }),
);
const [admin, left, right, observer] = clients;
const source = (p) => readFile(new URL(p, import.meta.url), "utf8");
const row = async (client, sql, args = []) => (await client.query(sql, args)).rows[0];
const gym = crypto.randomUUID(),
  owner = crypto.randomUUID(),
  branch = crypto.randomUUID(),
  endpoint = crypto.randomUUID();
const settle = (promise) =>
  promise.then(
    (value) => ({ value }),
    (error) => ({ error }),
  );
async function ownerContext(client) {
  await client.query("select set_config('request.jwt.claim.sub',$1,false)", [owner]);
  await client.query("set role authenticated");
}
async function systemContext(client) {
  await client.query("reset role");
  await client.query("select set_config('request.jwt.claim.sub','',false)");
}
const control = (client, id, takeOver) =>
  row(client, "select set_owner_conversation_control($1,$2,$3,$4) as result", [
    id,
    gym,
    branch,
    takeOver,
  ]);
async function conversation() {
  const id = crypto.randomUUID();
  await admin.query(
    "insert into conversations(id,gym_id,branch_id,whatsapp_endpoint_id,customer_phone) values($1,$2,$3,$4,'test-customer')",
    [id, gym, branch, endpoint],
  );
  await admin.query(
    "insert into messages(conversation_id,sender_type,content,whatsapp_message_id) values($1,'customer','Hello',$2)",
    [id, crypto.randomUUID()],
  );
  return id;
}
async function begin(client) {
  await client.query("begin");
}
async function commit(client) {
  await client.query("commit");
}
// Prove the second transaction is actually waiting for the first connection's
// row lock; a fixed sleep is never used as evidence of concurrency.
async function blocked(client) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const activity = await row(
      observer,
      "select wait_event_type,pg_blocking_pids(pid) as blockers from pg_stat_activity where pid=$1",
      [client.processID],
    );
    if (activity?.wait_event_type === "Lock" && activity.blockers.length) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(
    "Expected overlapping transaction did not block on a PostgreSQL lock.",
  );
}
const staleReply = (client, id) =>
  row(
    client,
    "insert into messages(conversation_id,sender_type,content,metadata) values($1,'ai','stale','{\"control_version\":0,\"outbound_delivery\":\"whatsapp_outbox\"}') returning *",
    [id],
  );
function stopped(result) {
  assert.match(result.error?.message ?? "", /control changed/i);
}

try {
  await Promise.all(clients.map((client) => client.connect()));
  assert.equal(
    (await row(admin, "select rolsuper from pg_roles where rolname=current_user"))
      .rolsuper,
    true,
    "Disposable cluster administrator required.",
  );
  assert.equal(
    (
      await row(
        admin,
        "select count(*)::integer as n from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','auth')",
      )
    ).n,
    0,
    "Refusing a non-empty database.",
  );
  assert.equal(
    (
      await row(
        admin,
        "select count(*)::integer as n from pg_roles where rolname in ('anon','authenticated','service_role')",
      )
    ).n,
    0,
    "Use a dedicated disposable cluster; existing Supabase roles are not modified.",
  );
  await admin.query("begin");
  await admin.query(await source("./fixtures/conversation-control.sql"));
  const baseline = await source(
    "../../supabase/migrations/20250101000027_add_delivery_claims_and_rate_limits.sql",
  );
  await admin.query(
    baseline.slice(
      0,
      baseline.indexOf("create table if not exists public.rate_limit_buckets"),
    ),
  );
  await admin.query(
    await source(
      "../../supabase/migrations/20250101000028_finalize_whatsapp_delivery_atomically.sql",
    ),
  );
  const atomic = await source(
    "../../supabase/migrations/20250101000029_reduce_whatsapp_network_waves.sql",
  );
  await admin.query(
    atomic.slice(
      atomic.indexOf(
        "create or replace function public.persist_whatsapp_ai_text_reply",
      ),
    ),
  );
  await admin.query(
    await source(
      "../../supabase/migrations/20250101000034_add_conversation_control.sql",
    ),
  );
  await commit(admin);
  for (const client of clients)
    await client.query("set statement_timeout='10s'; set lock_timeout='8s'");
  await admin.query("insert into gyms values($1,$2)", [gym, owner]);
  await admin.query("insert into branches values($1,$2)", [branch, gym]);
  await admin.query(
    "insert into whatsapp_endpoints(id,gym_id,branch_id,phone_number_id) values($1,$2,$3,'mock-meta')",
    [endpoint, gym, branch],
  );

  // 1. Generation captured epoch zero, then takeover locks/commits first.
  for (const returnToAI of [false, true]) {
    const id = await conversation();
    await ownerContext(left);
    await systemContext(right);
    await begin(left);
    await control(left, id, true);
    if (returnToAI) await control(left, id, false);
    const attempt = settle(staleReply(right, id));
    await blocked(right);
    await commit(left);
    stopped(await attempt);
    const c = await row(admin, "select * from conversations where id=$1", [id]);
    assert.equal(c.status, returnToAI ? "active" : "human");
    assert.equal(c.control_version, returnToAI ? 2 : 1);
    assert.equal(
      (
        await row(
          admin,
          "select count(*)::integer as n from messages where conversation_id=$1 and sender_type='ai'",
          [id],
        )
      ).n,
      0,
    );
  }
  console.log(
    "PASS: overlapping stale reply inserts, including active -> human -> active.",
  );

  // 2. Create/reschedule/cancel in both linearizations, new and legacy worker.
  for (const action of ["create", "reschedule", "cancel"])
    for (const legacy of [false, true])
      for (const takeoverFirst of [false, true]) {
        const id = await conversation();
        const original = new Date(Date.now() + 86400000).toISOString();
        const scheduled = new Date(Date.now() + 172800000).toISOString();
        const booking =
          action === "create"
            ? null
            : await row(
                admin,
                "insert into bookings(gym_id,conversation_id,customer_name,source,scheduled_at,duration_minutes) values($1,$2,'Test','whatsapp',$3,30) returning *",
                [gym, id, original],
              );
        const payload = {
          gym_id: gym,
          branch_id: branch,
          conversation_id: id,
          customer_name: "Test",
          booking_type: "gym_visit",
          scheduled_at: scheduled,
          duration_minutes: 30,
          source: "whatsapp",
        };
        await ownerContext(left);
        await systemContext(right);
        const book = () => {
          if (!legacy)
            return row(
              right,
              "select execute_controlled_booking_mutation($1,0,$2,$3,$4::jsonb) as result",
              [id, action, booking?.id ?? null, JSON.stringify(payload)],
            );
          if (action === "create")
            return row(
              right,
              "insert into bookings(gym_id,conversation_id,customer_name,source) values($1,$2,'Test','whatsapp') returning *",
              [gym, id],
            );
          if (action === "cancel")
            return row(
              right,
              "update bookings set status='cancelled' where id=$1 returning *",
              [booking.id],
            );
          return row(
            right,
            "update bookings set scheduled_at=$2 where id=$1 returning *",
            [booking.id, scheduled],
          );
        };
        if (takeoverFirst) {
          await begin(left);
          await control(left, id, true);
          const pending = settle(book());
          await blocked(right);
          await commit(left);
          stopped(await pending);
        } else {
          await begin(right);
          await book();
          const pending = settle(control(left, id, true));
          await blocked(left);
          await commit(right);
          assert(!(await pending).error);
        }
        if (action === "create")
          assert.equal(
            (
              await row(
                admin,
                "select count(*)::integer as n from bookings where conversation_id=$1",
                [id],
              )
            ).n,
            takeoverFirst ? 0 : 1,
          );
        else {
          const after = await row(admin, "select * from bookings where id=$1", [
            booking.id,
          ]);
          if (action === "cancel")
            assert.equal(after.status, takeoverFirst ? "upcoming" : "cancelled");
          else
            assert.equal(
              after.scheduled_at.toISOString(),
              takeoverFirst ? original : scheduled,
            );
        }
      }
  console.log(
    "PASS: controlled and legacy create/reschedule/cancel versus takeover in both linearizations.",
  );

  // 3. Takeover before begin-send cancels; begin-send first is conservatively
  // already-sending and must never be recalled or falsely marked cancelled.
  for (const takeoverFirst of [false, true]) {
    const id = await conversation();
    await systemContext(right);
    await ownerContext(left);
    const message = await row(
      right,
      "insert into messages(conversation_id,sender_type,content,metadata) values($1,'ai','queued','{\"control_version\":0,\"outbound_delivery\":\"whatsapp_outbox\"}') returning *",
      [id],
    );
    const delivery = await row(
      right,
      "select * from claim_whatsapp_outbound_delivery($1,$2)",
      [message.id, id],
    );
    const send = () =>
      row(right, "select begin_whatsapp_outbound_send($1,$2) as started", [
        delivery.id,
        delivery.claim_token,
      ]);
    if (takeoverFirst) {
      await begin(left);
      await control(left, id, true);
      const pending = settle(send());
      await blocked(right);
      await commit(left);
      assert.equal((await pending).value.started, false);
    } else {
      await begin(right);
      assert.equal((await send()).started, true);
      const pending = settle(control(left, id, true));
      await blocked(left);
      await commit(right);
      assert(!(await pending).error);
    }
    const after = await row(
      admin,
      "select * from whatsapp_outbound_deliveries where id=$1",
      [delivery.id],
    );
    assert.equal(after.status, takeoverFirst ? "failed" : "sending");
    if (takeoverFirst) assert.equal(after.retryable, false);
  }
  console.log(
    "PASS: queued send/takeover race and preservation of the crossed send boundary.",
  );

  // 4. Both owner requests overlap; conversation lock + unique index allow one
  // message and one outbox entry, and return the same persisted message twice.
  {
    const id = await conversation(),
      key = crypto.randomUUID();
    await ownerContext(left);
    await ownerContext(right);
    await control(left, id, true);
    const send = (client) =>
      row(
        client,
        "select persist_owner_whatsapp_message($1,$2,$3,1,'Owner reply',$4) as result",
        [id, gym, branch, key],
      );
    await begin(left);
    const first = await send(left);
    const pending = settle(send(right));
    await blocked(right);
    await commit(left);
    assert.equal((await pending).value.result.id, first.result.id);
    assert.equal(
      (
        await row(
          admin,
          "select count(*)::integer as n from messages where conversation_id=$1 and client_request_id=$2",
          [id, key],
        )
      ).n,
      1,
    );
    assert.equal(
      (
        await row(
          admin,
          "select count(*)::integer as n from whatsapp_outbound_deliveries where message_id=$1",
          [first.result.id],
        )
      ).n,
      1,
    );
  }
  console.log(
    "PASS: real overlapping same-clientRequestId owner requests persist/enqueue exactly once.",
  );

  // 5. Competing ownership changes serialize; no lost epoch increment or
  // accidental ai_enabled changes. Exercise both possible lock winners.
  for (const returnFirst of [false, true]) {
    const id = await conversation();
    await admin.query("update conversations set ai_enabled=false where id=$1", [id]);
    await ownerContext(left);
    await ownerContext(right);
    await control(left, id, true);
    await begin(left);
    await control(left, id, !returnFirst);
    const pending = settle(control(right, id, returnFirst));
    await blocked(right);
    await commit(left);
    assert(!(await pending).error);
    const c = await row(admin, "select * from conversations where id=$1", [id]);
    assert.equal(c.status, returnFirst ? "human" : "active");
    assert.equal(c.control_version, returnFirst ? 4 : 3);
    assert.equal(c.ai_enabled, false);
  }
  console.log(
    "PASS: concurrent Take Over/Return to AI serialize and preserve ai_enabled.",
  );
  console.log(
    "Real PostgreSQL concurrency suite passed. No Meta transport was invoked. Disposable fixture remains for inspection.",
  );
} finally {
  await Promise.allSettled(
    clients.map(async (client) => {
      await client.query("rollback").catch(() => {});
      await client.end();
    }),
  );
}
