import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dateForTimeZone } from "../../src/lib/member-import.ts";

/** SQL-backed loader + real prompt builder; no live model/provider calls. */
export async function verifyMemberContext(db, fixture, client) {
  const { build } = await import(
    new URL("../../.tmp-member-db/node_modules/esbuild/lib/main.js", import.meta.url)
      .href
  );
  const compiled = await build({
    stdin: {
      contents:
        'export {loadMemberContext} from "@/services/member-context.server"; export {buildPrompt} from "@/services/prompt-builder.server";',
      resolveDir: fileURLToPath(new URL("../../", import.meta.url)),
      loader: "ts",
    },
    bundle: true,
    write: false,
    platform: "node",
    format: "esm",
    plugins: [
      {
        name: "member-context-db",
        setup(b) {
          b.onResolve({ filter: /^@\/lib\/supabase\/server$/ }, (args) => ({
            path: args.path,
            namespace: "fixture",
          }));
          b.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({
            contents:
              "export const createServerSupabaseClient=async()=>globalThis.__memberServiceFixture.client;",
          }));
        },
      },
    ],
  });
  const { loadMemberContext, buildPrompt } = await import(
    "data:text/javascript;base64," +
      Buffer.from(compiled.outputFiles[0].text).toString("base64")
  );
  const q = (sql, args = []) => db.query(sql, args);
  const { gym, branch, pkg } = fixture;
  const b = (await q("select * from branches where id=$1", [branch])).rows[0];
  const today = dateForTimeZone(b.timezone);
  const knowledge = {
    gym: { gym_name: "Test Gym" },
    branch: b,
    isMultiBranch: false,
    allBranches: null,
    packages: null,
    trainers: null,
    facilities: null,
    media: null,
    offers: null,
    needs: {},
    turn: {
      isTemporaryBranch: false,
      facts: { packages: [], trainers: [], facilities: [], media: [], offers: [] },
    },
  };
  const turn = (conversation) => ({
    conversation,
    latestMessages: [],
    latestCustomerMessage: {
      id: "question",
      content: "What date does my membership expire?",
      message_type: "text",
    },
  });
  const lead = { gym_id: gym, branch_id: branch, source: "whatsapp", member_id: null };
  assert.equal(await loadMemberContext(lead, b), null);
  const plain = buildPrompt(turn(lead), knowledge).knowledgeSummary.content;
  assert(!plain.includes("Canonical Member Context"));
  for (const [source, transport] of [
    ["manual", "whatsapp"],
    ["import", "whatsapp"],
    ["lead_conversion", "simulator"],
  ]) {
    const phone = `+92300${String(Math.floor(Math.random() * 10000000)).padStart(7, "0")}`;
    let conversationId = crypto.randomUUID();
    if (source === "lead_conversion") {
      await db.exec("reset role");
      await q(
        "insert into conversations(id,gym_id,branch_id,source,customer_phone) values($1,$2,$3,'simulator',$4)",
        [conversationId, gym, branch, phone.slice(1)],
      );
      await db.exec("set role authenticated");
    }
    const registered = await client.rpc("register_member_membership", {
      p_request_id: crypto.randomUUID(),
      p_branch_id: branch,
      p_name: "Context Member",
      p_phone_e164: phone,
      p_email: null,
      p_package_id: pkg,
      p_start_date: today,
      p_expiry_date: "2099-12-31",
      p_source: source,
      p_existing_member_id: null,
      p_conversation_id: source === "lead_conversion" ? conversationId : null,
    });
    assert.equal(registered.error, null);
    if (transport === "whatsapp") {
      await db.exec("reset role");
      await q(
        "insert into conversations(id,gym_id,branch_id,source,customer_phone) values($1,$2,$3,'whatsapp',$4)",
        [conversationId, gym, branch, phone.slice(1)],
      );
      await db.exec("set role authenticated");
    }
    const c = (await q("select * from conversations where id=$1", [conversationId]))
      .rows[0];
    assert.equal(c.member_id, registered.data.member.id);
    let member = await loadMemberContext(c, b);
    assert.equal(member.membership.status, "active");
    assert.equal(member.membership.expiryDate, "2099-12-31");
    const prompt = buildPrompt(turn(c), { ...knowledge, memberContext: member })
      .knowledgeSummary.content;
    assert.match(prompt, /existingMember":true/);
    assert.match(prompt, /2099-12-31/);
    assert.match(prompt, /Use these canonical dates\/status/);
    assert(!JSON.stringify(member).includes(c.member_id));
    assert(!JSON.stringify(member).includes(phone));
    assert.deepEqual(await loadMemberContext(c, { ...b, timezone: null }), {
      name: "Context Member",
    });
    // Legacy data may contain overlapping active periods: omit rather than guess.
    await db.exec("reset role");
    const ambiguous = crypto.randomUUID();
    await q(
      "insert into memberships(id,gym_id,branch_id,member_id,membership_package_id,start_date,expiry_date) values($1,$2,$3,$4,$5,$6,'2099-12-31')",
      [ambiguous, gym, branch, c.member_id, pkg, today],
    );
    await db.exec("set role authenticated");
    assert.deepEqual(await loadMemberContext(c, b), { name: "Context Member" });
    await db.exec("reset role");
    await q("delete from memberships where id=$1", [ambiguous]);
    await q(
      "update memberships set start_date=$1::date-1,expiry_date=$1::date where id=$2",
      [today, registered.data.membership.id],
    );
    await db.exec("set role authenticated");
    assert.equal(
      (await loadMemberContext(c, b)).membership.status,
      "active",
      "Expiry is inclusive in branch-local dates",
    );
    // Read failures suppress private context without blocking normal AI handling.
    try {
      globalThis.__memberServiceFixture.client = {
        ...client,
        from(table) {
          if (table !== "memberships") return client.from(table);
          const failed = {
            then(resolve) {
              return Promise.resolve({
                data: null,
                error: { message: "unavailable" },
              }).then(resolve);
            },
          };
          for (const method of [
            "select",
            "eq",
            "lte",
            "gte",
            "gt",
            "lt",
            "order",
            "limit",
          ])
            failed[method] = () => failed;
          return failed;
        },
      };
      assert.deepEqual(await loadMemberContext(c, b), { name: "Context Member" });
    } finally {
      globalThis.__memberServiceFixture.client = client;
    }
    assert.deepEqual(await loadMemberContext({ ...c, branch_id: null }, b), {
      name: "Context Member",
    });
    assert.deepEqual(
      await loadMemberContext({ ...c, branch_id: crypto.randomUUID() }, b),
      { name: "Context Member" },
    );
    assert.equal(
      await loadMemberContext({ ...c, gym_id: crypto.randomUUID() }, b),
      null,
    );
    const another = (
      await q("select * from branches where gym_id=$1 and id<>$2 limit 1", [
        gym,
        branch,
      ])
    ).rows[0];
    assert.deepEqual(
      await loadMemberContext({ ...c, branch_id: another.id }, another),
      { name: "Context Member" },
    );
    await db.exec("reset role");
    await q(
      "update memberships set start_date='2020-01-01',expiry_date='2020-02-01' where id=$1",
      [registered.data.membership.id],
    );
    await db.exec("set role authenticated");
    member = await loadMemberContext(c, b);
    assert.equal(member.membership.status, "expired");
    assert.equal(member.membership.expiryDate, "2020-02-01");
    assert.match(
      buildPrompt(turn(c), { ...knowledge, memberContext: member }).knowledgeSummary
        .content,
      /expired/,
    );
    await db.exec("reset role");
    await q(
      "update memberships set start_date='2099-01-01',expiry_date='2099-02-01' where id=$1",
      [registered.data.membership.id],
    );
    await db.exec("set role authenticated");
    assert.equal((await loadMemberContext(c, b)).membership.status, "scheduled");
  }
  console.log(
    "PASS: real canonical manual/import WhatsApp linking and simulator conversion feed active/expired/scheduled member prompts; exact expiry, gym/branch/unassigned isolation, unchanged lead prompt, no private identifiers.",
  );
}
