import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Exercise actual server actions + durable delivery with real SQL and a mocked Meta transport. */
export async function verifyOwnerService(db, fixture) {
  const { build } = await import(
    process.env.ESBUILD_MODULE ??
      new URL("../../.tmp-control-db/node_modules/esbuild/lib/main.js", import.meta.url)
        .href
  );
  const root = fileURLToPath(new URL("../../", import.meta.url));
  const { gym, branch, owner, otherOwner, conversationId } = fixture;
  const state = { actor: owner, branch, system: false, calls: [], failure: null };
  const execute = async (sql, values) => {
    if (state.system) {
      await db.query("select set_config('request.jwt.claim.sub','',false)");
      return db.query(sql, values);
    }
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      state.actor,
    ]);
    await db.exec("set role authenticated");
    try {
      return await db.query(sql, values);
    } finally {
      await db.exec("reset role");
    }
  };
  const rpcArguments = {
    persist_owner_whatsapp_message: [
      "p_conversation_id",
      "p_gym_id",
      "p_branch_id",
      "p_expected_control_version",
      "p_text",
      "p_client_request_id",
    ],
    set_owner_conversation_control: [
      "p_conversation_id",
      "p_gym_id",
      "p_branch_id",
      "p_take_over",
    ],
    whatsapp_customer_window_open: ["p_conversation_id"],
    claim_whatsapp_outbound_delivery: ["p_message_id", "p_conversation_id"],
    begin_whatsapp_outbound_send: ["p_delivery_id", "p_claim_token"],
    finalize_whatsapp_outbound_delivery: [
      "p_delivery_id",
      "p_claim_token",
      "p_meta_message_id",
      "p_sent_at",
    ],
  };
  const client = {
    auth: {
      getUser: async () => ({
        data: { user: state.actor ? { id: state.actor } : null },
      }),
    },
    async rpc(name, args) {
      try {
        const names = rpcArguments[name];
        assert(names, `Unexpected RPC: ${name}`);
        const values = names.map((k) => args[k]);
        const set = name === "claim_whatsapp_outbound_delivery";
        const result = await execute(
          `select ${set ? "*" : `${name}(${names.map((_, i) => "$" + (i + 1)).join(",")}) as result`} ${set ? `from ${name}(${names.map((_, i) => "$" + (i + 1)).join(",")})` : ""}`,
          values,
        );
        return { data: set ? result.rows : result.rows[0]?.result, error: null };
      } catch (error) {
        return { data: null, error: { message: error.message } };
      }
    },
    from(table) {
      assert(
        [
          "messages",
          "conversations",
          "whatsapp_endpoints",
          "whatsapp_outbound_deliveries",
        ].includes(table),
      );
      const filters = [],
        values = [];
      let patch = null,
        one = false;
      const add = (value) => {
        values.push(value);
        return "$" + values.length;
      };
      const query = {
        select() {
          return query;
        },
        eq(k, v) {
          filters.push(`${k} = ${add(v)}`);
          return query;
        },
        in(k, v) {
          filters.push(`${k} = any(${add(v)})`);
          return query;
        },
        not(k) {
          filters.push(`${k} is not null`);
          return query;
        },
        update(p) {
          patch = p;
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
        async then(resolve, reject) {
          try {
            const assignments = patch
              ? Object.entries(patch).map(([k, v]) => `${k} = ${add(v)}`)
              : [];
            const result = await execute(
              `${patch ? `update ${table} set ${assignments.join(",")}` : `select * from ${table}`} ${filters.length ? "where " + filters.join(" and ") : ""} ${patch ? "returning *" : ""}`,
              values,
            );
            resolve({
              data: one ? (result.rows[0] ?? null) : result.rows,
              error: null,
            });
          } catch (error) {
            if (reject) reject(error);
            else throw error;
          }
        },
      };
      return query;
    },
  };
  const mock = {
    createServerSupabaseClient: async () => client,
    async runWithSystemSupabase(fn) {
      state.system = true;
      try {
        return await fn();
      } finally {
        state.system = false;
      }
    },
    resolveActiveBranch: async () => ({
      error: null,
      gym: { id: gym },
      isUnassigned: false,
      branch: { id: state.branch },
    }),
    getConversation: async (id) => ({
      data:
        (await execute("select * from conversations where id=$1", [id])).rows[0] ??
        null,
      error: null,
    }),
    listRecentMessages: async (id) => ({
      data: (
        await execute(
          "select * from messages where conversation_id=$1 order by created_at desc limit 100",
          [id],
        )
      ).rows.reverse(),
      error: null,
    }),
    async sendWhatsAppText(input) {
      assert(state.system);
      state.calls.push(input);
      return (
        state.failure ?? {
          data: { whatsappMessageId: "mock-meta-" + state.calls.length },
          error: null,
        }
      );
    },
    async sendWhatsAppImage() {
      throw Error("Owner path must be text-only");
    },
    elapsedMs: () => 0,
    logPerformance: () => {},
  };
  globalThis.__ownerControlMock = mock;
  const mocks = {
    "@/lib/supabase/server": ["createServerSupabaseClient"],
    "@/lib/supabase/request-context": ["runWithSystemSupabase"],
    "@/lib/active-branch.server": ["resolveActiveBranch"],
    "@/services/conversation.server": ["getConversation"],
    "@/services/message.server": ["listRecentMessages"],
    "@/services/whatsapp-cloud-api.server": ["sendWhatsAppText", "sendWhatsAppImage"],
    "@/lib/performance-log.server": ["elapsedMs", "logPerformance"],
    "server-only": [],
  };
  const compiled = await build({
    entryPoints: [path.join(root, "src/services/conversation-control.server.ts")],
    bundle: true,
    write: false,
    platform: "node",
    format: "esm",
    plugins: [
      {
        name: "isolated-services",
        setup(b) {
          b.onResolve({ filter: /.*/ }, (args) =>
            Object.hasOwn(mocks, args.path)
              ? { path: args.path, namespace: "fixture" }
              : null,
          );
          b.onLoad({ filter: /.*/, namespace: "fixture" }, (args) => ({
            contents: mocks[args.path]
              .map(
                (name) => `export const ${name}=globalThis.__ownerControlMock.${name};`,
              )
              .join("\n"),
            loader: "js",
          }));
          b.onResolve({ filter: /^@\// }, (args) => {
            const base = path.join(root, "src", args.path.slice(2));
            return { path: [base + ".ts", base + ".tsx"].find((f) => existsSync(f)) };
          });
        },
      },
    ],
  });
  const service = await import(
    "data:text/javascript;base64," +
      Buffer.from(compiled.outputFiles[0].text).toString("base64")
  );
  const key = crypto.randomUUID();
  const sent = await service.sendOwnerWhatsAppMessage(
    conversationId,
    "Actual owner service reply",
    key,
  );
  assert.equal(sent.error, undefined);
  assert.equal(sent.message.sender_type, "human");
  assert.equal(sent.message.owner_delivery_state, "sent");
  assert.equal(state.calls.length, 1);
  assert.equal(state.calls[0].phoneNumberId, "meta-original");
  assert.equal(state.calls[0].to, `customer-${conversationId}`);
  assert.equal(state.calls[0].body, "Actual owner service reply");
  const duplicate = await service.sendOwnerWhatsAppMessage(
    conversationId,
    "Actual owner service reply",
    key,
  );
  assert.equal(duplicate.message.id, sent.message.id);
  assert.equal(state.calls.length, 1);
  const snapshot = await service.getInboxThreadSnapshot(conversationId);
  assert.equal(snapshot.data.ownerSendAllowed, true);
  assert(
    snapshot.data.messages.some(
      (m) => m.id === sent.message.id && m.owner_delivery_state === "sent",
    ),
  );
  state.failure = {
    data: null,
    error: "Rejected by Meta",
    retryable: false,
    deliveryMayHaveSucceeded: false,
  };
  const failed = await service.sendOwnerWhatsAppMessage(
    conversationId,
    "Provider rejection",
    crypto.randomUUID(),
  );
  assert.equal(failed.message.owner_delivery_state, "failed");
  assert.match(failed.notice, /could not be sent/);
  state.failure = {
    data: null,
    error: "Connection lost after write",
    retryable: false,
    deliveryMayHaveSucceeded: true,
  };
  const uncertainKey = crypto.randomUUID();
  const uncertain = await service.sendOwnerWhatsAppMessage(
    conversationId,
    "Possibly sent",
    uncertainKey,
  );
  assert.equal(uncertain.message.owner_delivery_state, "unconfirmed");
  assert.match(uncertain.notice, /may have been sent/);
  const attempts = state.calls.length;
  await service.sendOwnerWhatsAppMessage(conversationId, "Possibly sent", uncertainKey);
  assert.equal(state.calls.length, attempts); // Ambiguous external send is never retried.
  state.actor = otherOwner;
  assert.match(
    (
      await service.sendOwnerWhatsAppMessage(
        conversationId,
        "Unauthorized",
        crypto.randomUUID(),
      )
    ).error,
    /outside/,
  );
  assert.match(
    (await service.setOwnerConversationControl(conversationId, false)).error,
    /outside/,
  );
  state.actor = null;
  assert.match(
    (
      await service.sendOwnerWhatsAppMessage(
        conversationId,
        "Signed out",
        crypto.randomUUID(),
      )
    ).error,
    /Sign in/,
  );
  state.actor = owner;
  state.branch = crypto.randomUUID();
  assert.match(
    (await service.setOwnerConversationControl(conversationId, false)).error,
    /outside/,
  );
  assert.equal(state.calls.length, attempts);
  delete globalThis.__ownerControlMock;
  console.log(
    "Actual owner service + existing WhatsApp outbox tests passed: database-authoritative destination, Meta acceptance/rejection/ambiguity, no duplicate send on retries, scoped auth and delivery projection.",
  );
}
