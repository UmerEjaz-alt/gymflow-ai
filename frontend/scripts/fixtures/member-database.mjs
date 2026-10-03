import { readFile } from "node:fs/promises";

export const source = (p) => readFile(new URL(p, import.meta.url), "utf8");
export async function initializeMemberDatabase(db) {
  const exec = (sql) => (db.exec ? db.exec(sql) : db.query(sql));
  const fixture = (await source("./conversation-control.sql")).replace(
    /create role (anon|authenticated|service_role)([^;]*);/g,
    (_, role, options) =>
      `do $roles$ begin if not exists(select 1 from pg_roles where rolname = '${role}') then execute 'create role ${role}${options}'; end if; end; $roles$;`,
  );
  await exec(fixture);
  await exec(await source("./member-schema.sql"));
  const base = await source(
    "../../../supabase/migrations/20250101000027_add_delivery_claims_and_rate_limits.sql",
  );
  await exec(
    base.slice(0, base.indexOf("create table if not exists public.rate_limit_buckets")),
  );
  await exec(
    await source(
      "../../../supabase/migrations/20250101000028_finalize_whatsapp_delivery_atomically.sql",
    ),
  );
  const atomic = await source(
    "../../../supabase/migrations/20250101000029_reduce_whatsapp_network_waves.sql",
  );
  await exec(
    atomic.slice(
      atomic.indexOf(
        "create or replace function public.persist_whatsapp_ai_text_reply",
      ),
    ),
  );
  await exec(
    await source(
      "../../../supabase/migrations/20250101000034_add_conversation_control.sql",
    ),
  );
}
export const migration35 = () =>
  source("../../../supabase/migrations/20250101000035_add_canonical_members.sql");
