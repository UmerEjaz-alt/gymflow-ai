import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Actual registration/import/conversion services, with SQL-backed Supabase adapter. */
export async function verifyMemberServices(db, fixture) {
  const { build } = await import(
    process.env.ESBUILD_MODULE ??
      new URL("../../.tmp-member-db/node_modules/esbuild/lib/main.js", import.meta.url)
        .href
  );
  const { gym, owner, branch, pkg, endpoint } = fixture;
  const q = (s, a = []) => db.query(s, a);
  await q("select set_config('request.jwt.claim.sub',$1,false)", [owner]);
  await db.exec("set role authenticated");
  const calls = [];
  const client = {
    async rpc(name, args) {
      calls.push(name);
      assert.equal(name, "register_member_membership");
      const keys = [
        "p_request_id",
        "p_branch_id",
        "p_name",
        "p_phone_e164",
        "p_email",
        "p_package_id",
        "p_start_date",
        "p_expiry_date",
        "p_source",
        "p_existing_member_id",
        "p_conversation_id",
      ];
      try {
        const result = await q(
          `select register_member_membership(${keys.map((_, i) => "$" + (i + 1)).join(",")}) result`,
          keys.map((k) => args[k]),
        );
        return { data: result.rows[0].result, error: null };
      } catch (error) {
        return { data: null, error: { message: error.message } };
      }
    },
    from(table) {
      assert(
        [
          "members",
          "memberships",
          "branches",
          "conversations",
          "membership_packages",
          "messages",
        ].includes(table),
      );
      const filters = [],
        values = [];
      let one = false,
        order = "",
        countOnly = false;
      const identifier = (k) => {
        if (k.startsWith("conversations.")) {
          assert(table === "messages" && /^[a-z_]+$/.test(k.slice(14)));
          return `c.${k.slice(14)}`;
        }
        assert(/^[a-z_]+$/.test(k));
        return `t.${k}`;
      };
      const query = {
        select(_columns, options) {
          countOnly = Boolean(options?.head);
          return query;
        },
        in(k, list) {
          values.push(list);
          filters.push(`${identifier(k)}=any($${values.length})`);
          return query;
        },
        eq(k, v) {
          values.push(v);
          filters.push(`${identifier(k)}=$${values.length}`);
          return query;
        },
        order(k, options) {
          order = ` order by ${identifier(k)} ${options?.ascending === false ? "desc" : "asc"}`;
          return query;
        },
        maybeSingle() {
          one = true;
          return query;
        },
        single() {
          one = true;
          return query;
        },
        then(resolve, reject) {
          const join =
            table === "memberships"
              ? " left join members person on person.id=t.member_id left join conversations c on c.id=t.conversation_id left join membership_packages p on p.id=t.membership_package_id"
              : table === "messages"
                ? " join conversations c on c.id=t.conversation_id"
                : "";
          const columns =
            table === "memberships"
              ? "t.*,to_jsonb(person) member,to_jsonb(c) conversation,to_jsonb(p) membership_package"
              : "t.*";
          return q(
            `select ${countOnly ? "count(*)::int n" : columns} from ${table} t${join}${filters.length ? " where " + filters.join(" and ") : ""}${order}`,
            values,
          )
            .then(
              (result) => ({
                data: one ? (result.rows[0] ?? null) : result.rows,
                count: countOnly ? result.rows[0].n : null,
                error: null,
              }),
              (error) => ({ data: null, error: { message: error.message } }),
            )
            .then(resolve, reject);
        },
      };
      return query;
    },
  };
  globalThis.__memberServiceFixture = { client };
  const root = fileURLToPath(new URL("../../", import.meta.url));
  const compiled = await build({
    entryPoints: [path.join(root, "src/services/membership.server.ts")],
    bundle: true,
    write: false,
    platform: "node",
    format: "esm",
    plugins: [
      {
        name: "isolated-member-service",
        setup(b) {
          b.onResolve(
            {
              filter:
                /^(@\/lib\/supabase\/server|@\/services\/conversation-history.server)$/,
            },
            (args) => ({ path: args.path, namespace: "fixture" }),
          );
          b.onLoad({ filter: /.*/, namespace: "fixture" }, (args) => ({
            contents: args.path.includes("supabase")
              ? "export const createServerSupabaseClient=async()=>globalThis.__memberServiceFixture.client;"
              : "export const getActiveScopeConversationHistory=async()=>({data:[],error:null});",
          }));
        },
      },
    ],
  });
  try {
    const service = await import(
      "data:text/javascript;base64," +
        Buffer.from(compiled.outputFiles[0].text).toString("base64")
    );
    const authorizedBranch = {
      id: branch,
      gym_id: gym,
      country_code: "PK",
      timezone: "Asia/Karachi",
    };
    const input = {
      requestId: crypto.randomUUID(),
      branchId: branch,
      name: "Service Member",
      phone: "03008889999",
      packageId: pkg,
      startDate: "2026-01-01",
    };
    const created = await service.registerMember(input, authorizedBranch);
    assert.equal(created.error, null);
    assert.equal(created.data.member.phone_e164, "+923008889999");
    assert.equal(
      (await service.registerMember(input, authorizedBranch)).data.membership.id,
      created.data.membership.id,
    );
    assert.match(
      (
        await service.registerMember(
          { ...input, requestId: crypto.randomUUID(), startDate: "2026-03-01" },
          authorizedBranch,
        )
      ).error,
      /Confirm Add membership/,
    );
    const reused = await service.registerMember(
      {
        ...input,
        requestId: crypto.randomUUID(),
        startDate: "2026-03-01",
        existingMemberId: created.data.member.id,
        name: "Ignored rename",
      },
      authorizedBranch,
    );
    assert.equal(reused.data.member.name, "Service Member");
    assert.match(
      (await service.registerMember({ ...input, phone: "invalid" }, authorizedBranch))
        .error,
      /phone|number/i,
    );
    assert.match(
      (
        await service.registerMember(
          { ...input, branchId: crypto.randomUUID() },
          authorizedBranch,
        )
      ).error,
      /branch changed/i,
    );
    const rows = ["2026-05-01", "2026-07-01"].map((startDate, i) => ({
      rowNumber: i + 2,
      requestId: crypto.randomUUID(),
      name: "Service Member",
      phone: "03008889999",
      packageName: "Monthly",
      startDate,
    }));
    const before = (
      await q("select count(*)::int n from conversations where gym_id=$1", [gym])
    ).rows[0].n;
    const imported = await service.importMembersToBranch(gym, authorizedBranch, rows);
    assert.equal(imported.error, null);
    assert.equal(imported.data.imported_count, 2);
    assert.equal(imported.data.failed_count, 0);
    const replay = await service.importMembersToBranch(gym, authorizedBranch, rows);
    assert.equal(replay.data.imported_count, 2);
    assert.equal(
      (await q("select count(*)::int n from conversations where gym_id=$1", [gym]))
        .rows[0].n,
      before,
    );
    assert.equal(
      (
        await q("select count(*)::int n from memberships where member_id=$1", [
          created.data.member.id,
        ])
      ).rows[0].n,
      4,
    );
    await db.exec("reset role");
    const c = crypto.randomUUID();
    await q(
      "insert into conversations(id,gym_id,branch_id,whatsapp_endpoint_id,customer_phone,customer_name) values($1,$2,$3,$4,'923009998888','Service Lead')",
      [c, gym, branch, endpoint],
    );
    await db.exec("set role authenticated");
    const conversion = await service.convertConversationToMember({
      conversationId: c,
      membershipPackageId: pkg,
      customerName: "Service Lead",
      customerPhone: "923009998888",
      startDate: "2026-01-01",
      requestId: crypto.randomUUID(),
    });
    assert.equal(conversion.error, null);
    assert.equal(
      (await q("select customer_phone from conversations where id=$1", [c])).rows[0]
        .customer_phone,
      "923009998888",
    );
    assert(calls.every((name) => name === "register_member_membership"));
    const analyticsBuild = await build({
      entryPoints: [path.join(root, "src/services/analytics.server.ts")],
      bundle: true,
      write: false,
      platform: "node",
      format: "esm",
      plugins: [
        {
          name: "isolated-member-analytics",
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
    const analytics = await import(
      "data:text/javascript;base64," +
        Buffer.from(analyticsBuild.outputFiles[0].text).toString("base64")
    );
    const metrics = await analytics.getDashboardMetrics(gym);
    assert.equal(metrics.error, null);
    assert.equal(
      metrics.data.members,
      (await q("select count(*)::int n from members where gym_id=$1", [gym])).rows[0].n,
    );
    const branchMetrics = await analytics.getDashboardMetrics(gym, branch);
    assert.equal(branchMetrics.error, null);
    assert.equal(
      branchMetrics.data.members,
      (
        await q(
          "select count(distinct member_id)::int n from memberships where gym_id=$1 and branch_id=$2",
          [gym, branch],
        )
      ).rows[0].n,
    );
    // A later AI exchange with an offline-created person must not create AI acquisition credit.
    await db.exec("reset role");
    const later = crypto.randomUUID();
    await q(
      "insert into conversations(id,gym_id,branch_id,whatsapp_endpoint_id,customer_phone,ai_lead_at,lead_stage) values($1,$2,$3,$4,'923008889999',now(),'member')",
      [later, gym, branch, endpoint],
    );
    await q(
      "insert into messages(conversation_id,sender_type,content,metadata) values($1,'ai','Welcome',jsonb_build_object('control_version',0))",
      [later],
    );
    await db.exec("set role authenticated");
    const linkedMetrics = await analytics.getDashboardMetrics(gym);
    assert.equal(linkedMetrics.error, null);
    assert.equal(linkedMetrics.data.members, metrics.data.members);
    assert.equal(linkedMetrics.data.becameMembers, metrics.data.becameMembers);
    console.log(
      "PASS: actual server registration, normalization, profile preservation, import reuse/retry without synthetic conversations, conversion, canonical RPC convergence, member analytics and no false offline acquisition credit.",
    );
  } finally {
    delete globalThis.__memberServiceFixture;
    await db.exec("reset role");
  }
}

/** Exercise the actual form handler after commit + connection interruption. */
export async function verifyMemberFormRetry() {
  const { build } = await import(
    process.env.ESBUILD_MODULE ??
      new URL("../../.tmp-member-db/node_modules/esbuild/lib/main.js", import.meta.url)
        .href
  );
  const hooks = [],
    context = { cursor: 0, hooks };
  globalThis.__memberFormFixture = context;
  const root = fileURLToPath(new URL("../../", import.meta.url));
  const compiled = await build({
    entryPoints: [path.join(root, "src/features/operations/add-member-dialog.tsx")],
    bundle: true,
    write: false,
    platform: "node",
    format: "esm",
    jsx: "automatic",
    plugins: [
      {
        name: "isolated-member-form",
        setup(b) {
          b.onResolve(
            {
              filter: /^(react(?:\/jsx-runtime)?|lucide-react|@\/components\/ui\/.*)$/,
            },
            (args) => ({ path: args.path, namespace: "form" }),
          );
          b.onLoad({ filter: /.*/, namespace: "form" }, (args) => ({
            contents:
              args.path === "react"
                ? `
          export const useEffect=()=>{};
          export function useState(initial){const c=globalThis.__memberFormFixture,i=c.cursor++;if(!c.hooks[i])c.hooks[i]={value:initial};return[c.hooks[i].value,v=>{c.hooks[i].value=typeof v==='function'?v(c.hooks[i].value):v}];}
          export function useRef(initial){const c=globalThis.__memberFormFixture,i=c.cursor++;return c.hooks[i]??(c.hooks[i]={current:initial});}`
                : args.path === "react/jsx-runtime"
                  ? "export const jsx=(type,props)=>({type,props}); export const jsxs=jsx; export const Fragment='fragment';"
                  : "export const Button='button', Dialog='dialog', Input='input', Select='select', LoaderCircle='loader', Plus='plus';",
          }));
        },
      },
    ],
  });
  const originalFormData = globalThis.FormData;
  try {
    const { AddMemberDialog } = await import(
      "data:text/javascript;base64," +
        Buffer.from(compiled.outputFiles[0].text).toString("base64")
    );
    const submitted = [],
      person = { id: "member", name: "Retry Member", phone_e164: "+923001234567" };
    let committed = false,
      lookups = 0;
    const props = {
      branchId: "branch",
      branchName: "Branch",
      today: "2026-10-04",
      packages: [],
      onCreated: () => {},
      onFindMember: async () => {
        lookups++;
        return { data: committed ? person : null, error: null };
      },
      onRegister: async (input) => {
        submitted.push(input);
        if (!committed) {
          committed = true;
          throw new Error("Connection lost after commit");
        }
        return {
          data: { member: person, membership: { id: "period" }, replayed: true },
          error: null,
        };
      },
    };
    const render = () => {
      context.cursor = 0;
      return AddMemberDialog(props);
    };
    const find = (node, type) => {
      if (!node) return null;
      if (node.type === type) return node;
      for (const child of [node.props?.children].flat(Infinity)) {
        const found = find(child, type);
        if (found) return found;
      }
      return null;
    };
    find(render(), "button").props.onClick();
    globalThis.FormData = class {
      get(k) {
        return { name: "Retry Member", phone: "+923001234567", email: "" }[k] ?? null;
      }
    };
    await find(render(), "form").props.onSubmit({
      preventDefault() {},
      currentTarget: {},
    });
    await find(render(), "form").props.onSubmit({
      preventDefault() {},
      currentTarget: {},
    });
    assert.equal(submitted.length, 2);
    assert.deepEqual(submitted[1], submitted[0]);
    assert.equal(
      lookups,
      1,
      "Retry must not change identity confirmation after commit",
    );
    console.log(
      "PASS: actual Add Member handler replays identical payload/request ID after commit + connection interruption.",
    );
  } finally {
    globalThis.FormData = originalFormData;
    delete globalThis.__memberFormFixture;
  }
}
