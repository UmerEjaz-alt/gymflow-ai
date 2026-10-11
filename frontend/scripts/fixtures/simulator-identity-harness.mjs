import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

export async function verifySimulatorIdentity(db, fixture, conversionService) {
  const { build } = await import(
    new URL("../../.tmp-member-db/node_modules/esbuild/lib/main.js", import.meta.url)
      .href
  );
  const { gym, branch, pkg, owner } = fixture;
  const q = (sql, args = []) => db.query(sql, args);
  let actor = owner,
    race = false;
  const identifier = (s) => {
    assert(/^[a-z_]+$/.test(s));
    return s;
  };
  const client = {
    auth: { getUser: async () => ({ data: { user: actor ? { id: actor } : null } }) },
    from(table) {
      identifier(table);
      const filters = [],
        values = [];
      let mode = "select",
        payload,
        one = false;
      const query = {
        select() {
          return query;
        },
        eq(k, v) {
          values.push(v);
          filters.push(`${identifier(k)}=$${values.length}`);
          return query;
        },
        is(k, v) {
          assert.equal(v, null);
          filters.push(`${identifier(k)} is null`);
          return query;
        },
        insert(p) {
          mode = "insert";
          payload = p;
          return query;
        },
        update(p) {
          mode = "update";
          payload = p;
          return query;
        },
        single() {
          one = true;
          return query;
        },
        maybeSingle() {
          one = true;
          return query;
        },
      async then(resolve) {
          try {
            if (mode === "update" && race) return resolve({ data: null, error: null });
            let sql = `select * from ${table}${filters.length ? " where " + filters.join(" and ") : ""}`;
            if (mode !== "select") {
              const keys = Object.keys(payload).map(identifier),
                args = keys.map((k) => payload[k]);
              if (mode === "insert")
                sql = `insert into ${table}(${keys.join(",")}) values(${keys.map((_, i) => "$" + (i + 1)).join(",")}) returning *`;
              else {
                const offset = values.length;
                sql = `update ${table} set ${keys.map((k, i) => `${k}=$${offset + i + 1}`).join(",")} where ${filters.join(" and ")} returning *`;
              }
              if (mode === "insert") values.splice(0, values.length, ...args);
              else values.push(...args);
            }
            const r = await q(sql, values);
            return resolve({ data: one ? (r.rows[0] ?? null) : r.rows, error: null });
          } catch (error) {
            return resolve({
              data: null,
              error: { message: error.message, code: error.code },
            });
          }
        },
      };
      return query;
    },
  };
  const compiled = await build({
    stdin: {
      contents:
        'export {createConversation} from "@/services/conversation.server"; export {repairSimulatorPhone} from "@/services/simulator-identity.server";',
      resolveDir: fileURLToPath(new URL("../../", import.meta.url)),
      loader: "ts",
    },
    bundle: true,
    write: false,
    platform: "node",
    format: "esm",
    plugins: [
      {
        name: "simulator-db",
        setup(b) {
          b.onResolve({ filter: /^@\/lib\/supabase\/server$/ }, (args) => ({
            path: args.path,
            namespace: "fixture",
          }));
          b.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({
            contents:
              "export const createServerSupabaseClient=async()=>globalThis.__simulatorIdentityClient;",
          }));
        },
      },
    ],
  });
  globalThis.__simulatorIdentityClient = client;
  const { createConversation, repairSimulatorPhone } = await import(
    "data:text/javascript;base64," +
      Buffer.from(compiled.outputFiles[0].text).toString("base64")
  );
  const create = (phone) =>
    createConversation({
      gym_id: gym,
      branch_id: branch,
      source: "simulator",
      customer_phone: phone,
    });
  try {
    assert.equal((await create("+923001234560")).data.customer_phone, "+923001234560");
    assert.equal((await create("03001234561")).data.customer_phone, "+923001234561");
    await db.exec("reset role");
    await q("update branches set country_code=null where id=$1", [branch]);
    await db.exec("set role authenticated");
    const count = (await q("select count(*)::int n from conversations")).rows[0].n;
    assert.match((await create("03001234562")).error, /configure this branch/);
    assert.equal(
      (await q("select count(*)::int n from conversations")).rows[0].n,
      count,
    );
    assert.equal((await create("+923001234562")).data.customer_phone, "+923001234562");
    const id = crypto.randomUUID();
    await db.exec("reset role");
    await q(
      "insert into conversations(id,gym_id,branch_id,source,customer_phone,status,ai_enabled,control_version) values($1,$2,$3,'simulator','03001234563','human',false,7)",
      [id, gym, branch],
    );
    await q(
      "insert into messages(conversation_id,sender_type,content) values($1,'customer','Preserve me')",
      [id],
    );
    await db.exec("set role authenticated");
    assert.match(
      (await repairSimulatorPhone(id, "03001234563")).error,
      /configure this branch/,
    );
    actor = null;
    assert.match((await repairSimulatorPhone(id, "+923001234563")).error, /Sign in/);
    actor = crypto.randomUUID();
    assert.match(
      (await repairSimulatorPhone(id, "+923001234563")).error,
      /access denied/,
    );
    actor = owner;
    race = true;
    assert.match((await repairSimulatorPhone(id, "+923001234563")).error, /changed/);
    race = false;
    assert.equal(
      (await repairSimulatorPhone(id, "+923001234563")).phone,
      "+923001234563",
    );
    let saved = (await q("select * from conversations where id=$1", [id])).rows[0];
    assert.equal(saved.status, "human");
    assert.equal(saved.ai_enabled, false);
    assert.equal(saved.control_version, 7);
    assert.equal(saved.member_id, null);
    assert.equal(
      (await q("select content from messages where conversation_id=$1", [id])).rows[0]
        .content,
      "Preserve me",
    );
    const payload = {
      conversationId: id,
      membershipPackageId: pkg,
      customerName: "Repaired Simulator",
      customerPhone: "+923001234563",
      startDate: "2026-01-01",
      requestId: crypto.randomUUID(),
    };
    assert.equal(
      (await conversionService.convertConversationToMember(payload)).error,
      null,
    );
    assert.match(
      (
        await conversionService.convertConversationToMember({
          ...payload,
          customerPhone: "+923001234564",
        })
      ).error,
      /Phone must match/,
    );
    saved = (await q("select * from conversations where id=$1", [id])).rows[0];
    assert(saved.member_id);
    assert.equal(saved.control_version, 7);
    await db.exec("reset role");
    await q("update conversations set customer_phone='03001234563' where id=$1", [id]);
    await db.exec("set role authenticated");
    assert.match(
      (await repairSimulatorPhone(id, "+923001234564")).error,
      /linked member/,
    );
    assert.equal(
      (await repairSimulatorPhone(id, "+923001234563")).phone,
      "+923001234563",
    );
    assert.equal(
      (await q("select member_id from conversations where id=$1", [id])).rows[0]
        .member_id,
      saved.member_id,
    );
    const wa = await createConversation({
      gym_id: gym,
      branch_id: branch,
      source: "whatsapp",
      customer_phone: "923001234565",
    });
    assert.equal(wa.data.customer_phone, "923001234565");
    assert.match(
      (await repairSimulatorPhone(wa.data.id, "+923001234565")).error,
      /Simulator conversation not found/,
    );
    assert.equal(
      (await q("select customer_phone from conversations where id=$1", [wa.data.id]))
        .rows[0].customer_phone,
      "923001234565",
    );
    console.log(
      "PASS: simulator E.164/local creation, null-country rejection, owner-only repair, concurrency guard, linked-member protection, messages/control preservation, corrected conversion, mismatch rejection and unchanged WhatsApp identifiers.",
    );
  } finally {
    delete globalThis.__simulatorIdentityClient;
    await db.exec("reset role");
    await q("update branches set country_code='PK' where id=$1", [branch]);
    await db.exec("set role authenticated");
  }
}
