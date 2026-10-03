import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";

// Actual, unedited migrations 0-35; only Supabase-owned auth/storage scaffolding
// is substituted. Never reads application env files or connects to a database.
const runtime = new URL(
  "../.tmp-member-db/node_modules/@electric-sql/pglite/dist/",
  import.meta.url,
);
const { PGlite } = await import(new URL("index.js", runtime).href);
const { btree_gist } = await import(new URL("contrib/btree_gist.js", runtime).href);
const db = new PGlite({ extensions: { btree_gist } });
const q = (sql, args = []) => db.query(sql, args);
const row = async (sql, args = []) => (await q(sql, args)).rows[0];
await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
  create schema auth;create table auth.users(id uuid primary key);
  create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
  grant usage on schema public,auth to authenticated,service_role,anon;
  alter default privileges in schema public grant all on tables to authenticated,service_role;
  create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
  create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);
  alter table storage.objects enable row level security;
  create function storage.foldername(text) returns text[] language sql immutable as $$select string_to_array($1,'/')$$;`);
const directory = new URL("../../supabase/migrations/", import.meta.url);
const files = (await readdir(directory)).filter((n) => n.endsWith(".sql")).sort();
const owner = crypto.randomUUID();
let gym, branch;
for (const file of files.filter((n) => n < "20250101000035")) {
  try {
    await db.exec(await readFile(new URL(file, directory), "utf8"));
  } catch (error) {
    throw new Error(`Actual migration ${file}: ${error.message}`, { cause: error });
  }
  if (file.startsWith("20250101000015")) {
    await q("insert into auth.users values($1)", [owner]);
    gym = (
      await row(
        "insert into gyms(owner_user_id,gym_name) values($1,'Migration Test Gym') returning id",
        [owner],
      )
    ).id;
    branch = (await row("select id from branches where gym_id=$1", [gym])).id;
  }
}
await q("update branches set country_code='PK',timezone='Asia/Karachi' where id=$1", [
  branch,
]);
const pkg = (
  await row(
    "insert into membership_packages(gym_id,branch_id,package_name,price,duration_months) values($1,$2,'Monthly',100,1) returning id",
    [gym, branch],
  )
).id;
await q("select set_config('request.jwt.claim.sub',$1,false)", [owner]);
await db.exec("set role authenticated");
const legacy = (
  await row(
    "select (import_member_to_branch($1,'Historical Import','+923001234567',$2,'2026-01-01',null)).id id",
    [branch, pkg],
  )
).id;
const oldConversation = (
  await row("select conversation_id from memberships where id=$1", [legacy])
).conversation_id;
await db.exec("reset role");
await db.exec(
  await readFile(
    new URL("20250101000035_add_canonical_members.sql", directory),
    "utf8",
  ),
);
assert.equal(
  (await row("select source from conversations where id=$1", [oldConversation])).source,
  "import",
);
const historical = await row("select * from memberships where id=$1", [legacy]);
assert(historical.member_id);
assert.equal(
  (await row("select source from members where id=$1", [historical.member_id])).source,
  "import",
);
await db.exec("set role authenticated");
const before = (await row("select count(*)::int n from conversations")).n;
await q(
  "select import_member_to_branch($1,'Offline Import','+923002345678',$2,'2026-01-01',null)",
  [branch, pkg],
);
assert.equal((await row("select count(*)::int n from conversations")).n, before);
const conversation = await row(
  "insert into conversations(gym_id,branch_id,customer_name,customer_phone,source) values($1,$2,'Lead','923003456789','whatsapp') returning *",
  [gym, branch],
);
const converted = (
  await row(
    "select (convert_conversation_to_member($1,$2,'Lead','+923003456789','2026-01-01')).id id",
    [conversation.id, pkg],
  )
).id;
const replay = (
  await row(
    "select (convert_conversation_to_member($1,$2,'Lead','+923003456789','2026-01-01')).id id",
    [conversation.id, pkg],
  )
).id;
assert.equal(converted, replay);
assert.equal(
  (await row("select customer_phone from conversations where id=$1", [conversation.id]))
    .customer_phone,
  "923003456789",
);
await db.exec("reset role");
// Live routing can change later; period provenance must not depend on that branch.
const branch2 = (
  await row(
    "insert into branches(gym_id,branch_name,timezone) values($1,'Second','Asia/Karachi') returning id",
    [gym],
  )
).id;
await q("update conversations set branch_id=$1 where id=$2", [
  branch2,
  conversation.id,
]);
await q("update memberships set updated_at=now() where id=$1", [converted]);
await q("delete from conversations where id=$1", [conversation.id]);
assert.equal(
  (await row("select conversation_id from memberships where id=$1", [converted]))
    .conversation_id,
  null,
);
assert.equal(
  (await row("select count(*)::int n from members where gym_id=$1", [gym])).n,
  3,
);
// Audit real FK catalog after the complete migration chain. These are the
// relationships PostgREST discovers, not just those in the reduced fixture.
const relationships = async (source, target) =>
  (
    await q(
      "select conname,pg_get_constraintdef(oid) definition from pg_constraint where contype='f' and conrelid=$1::regclass and confrelid=$2::regclass order by conname",
      [`public.${source}`, `public.${target}`],
    )
  ).rows;
const branches = await relationships("memberships", "branches");
assert.deepEqual(
  branches.map((fk) => fk.conname),
  ["memberships_branch_gym_fk", "memberships_branch_id_fkey"],
);
assert.match(
  branches[0].definition,
  /FOREIGN KEY \(branch_id, gym_id\) REFERENCES branches\(id, gym_id\)/,
);
for (const [source, target, name] of [
  ["memberships", "members", "memberships_member_gym_fk"],
  ["conversations", "members", "conversations_member_gym_fk"],
  ["memberships", "membership_packages", "memberships_membership_package_id_fkey"],
])
  assert.deepEqual(
    (await relationships(source, target)).map((fk) => fk.conname),
    [name],
  );
console.log(
  "PASS: actual FK catalog confirms both membership/branch paths and the single member/package relationships; compound branch authority retained.",
);
console.log(
  "PASS: all actual migrations 0-35 apply; actual legacy import backfill, retained synthetic history, old RPC signatures, offline imports, conversion retry, original transport phones, branch-drift history and conversation deletion checked. Supabase auth/storage infrastructure is mocked; this is single-connection PGlite.",
);
await db.close();
