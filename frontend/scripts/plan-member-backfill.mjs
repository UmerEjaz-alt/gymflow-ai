import { readFile, writeFile } from "node:fs/promises";
import { normalizePhoneNumber } from "../src/lib/phone-number.ts";
import { normalizeImportName } from "../src/lib/member-import.ts";

// Reads a reviewed JSON export only. No database connection or env loading.
// Writes a report and guarded SQL for an operator to inspect; never applies it.
const [inputPath, outputPrefix] = process.argv.slice(2);
if (!inputPath || !outputPrefix)
  throw new Error(
    "Usage: node scripts/plan-member-backfill.mjs export.json output-prefix",
  );
const rows = JSON.parse(await readFile(inputPath, "utf8"));
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const literal = (value) => "'" + String(value).replaceAll("'", "''") + "'";
const groups = new Map(),
  unresolved = [],
  conflicts = [];
const seen = new Set();
for (const item of rows) {
  if (!uuid.test(item.id) || !uuid.test(item.gym_id) || seen.has(item.id))
    throw new Error("Invalid/duplicate member ID in export.");
  seen.add(item.id);
  const raw = item.phone_e164 || item.raw_phone || "";
  const input =
    item.conversation_source === "whatsapp" && /^\d+$/.test(raw) ? `+${raw}` : raw;
  const normalized = normalizePhoneNumber(input, item.country_code);
  if (!normalized.e164 || !item.name || item.name === "Unknown member") {
    unresolved.push({
      ...item,
      reason: normalized.error ?? "Member name needs review.",
    });
    continue;
  }
  const key = `${item.gym_id}:${normalized.e164}`;
  groups.set(key, [
    ...(groups.get(key) ?? []),
    { ...item, normalized_phone: normalized.e164 },
  ]);
}
const plans = [],
  statements = [
    "-- REVIEW before applying to staging. This file is never auto-executed.",
    "begin;",
  ];
for (const group of groups.values()) {
  if (new Set(group.map((item) => normalizeImportName(item.name))).size !== 1) {
    conflicts.push({
      phone: group[0].normalized_phone,
      members: group,
      reason: "Conflicting names for the same normalized gym phone. No merge planned.",
    });
    continue;
  }
  const ordered = [...group].sort(
    (a, b) =>
      Number(Boolean(b.phone_e164)) - Number(Boolean(a.phone_e164)) ||
      String(a.created_at).localeCompare(String(b.created_at)) ||
      a.id.localeCompare(b.id),
  );
  const canonical = ordered[0],
    duplicates = ordered.slice(1);
  if (duplicates.length === 0 && canonical.phone_e164 === canonical.normalized_phone)
    continue;
  const ids = ordered.map((item) => `${literal(item.id)}::uuid`).join(",");
  const source =
    canonical.source === "legacy" && ordered.some((item) => item.source === "import")
      ? "import"
      : canonical.source;
  plans.push({
    canonical_id: canonical.id,
    phone: canonical.normalized_phone,
    merged_ids: duplicates.map((item) => item.id),
  });
  statements.push(`do $review$ begin
  -- Conversation -> gym locking matches registration and old conversion writers.
  perform id from public.conversations where member_id = any(array[${ids}]) order by id for update;
  perform pg_advisory_xact_lock(hashtextextended('member-gym:' || ${literal(canonical.gym_id)}, 0));
  if (select count(*) from public.members where id = any(array[${ids}]) and gym_id = ${literal(canonical.gym_id)}::uuid) <> ${ordered.length} then raise exception 'Backfill snapshot changed; regenerate report.'; end if;
  ${ordered.map((item) => `if not exists(select 1 from public.members where id = ${literal(item.id)}::uuid and name = ${literal(item.name)} and source = ${literal(item.source)} and phone_e164 is not distinct from ${item.phone_e164 ? literal(item.phone_e164) : "null"}${!item.phone_e164 ? ` and identity_metadata->>'raw_phone' is not distinct from ${item.raw_phone ? literal(item.raw_phone) : "null"}` : ""}${item.updated_at ? ` and updated_at = ${literal(item.updated_at)}::timestamptz` : ""}) then raise exception 'Backfill identity changed; regenerate report.'; end if;`).join("\n  ")}
  update public.members set phone_e164 = ${literal(canonical.normalized_phone)}, source = ${literal(source)},
    identity_metadata = identity_metadata || jsonb_build_object('identity_review_required', false,
      'normalized_backfill_at', now(), 'merged_legacy_records', ${literal(JSON.stringify(duplicates))}::jsonb)
    where id = ${literal(canonical.id)}::uuid;
  update public.conversations set member_id = ${literal(canonical.id)}::uuid where member_id = any(array[${ids}]);
  update public.memberships set member_id = ${literal(canonical.id)}::uuid where member_id = any(array[${ids}]);
  ${duplicates.length ? `delete from public.members where id = any(array[${duplicates.map((item) => `${literal(item.id)}::uuid`).join(",")}]);` : ""}
end; $review$;`);
}
statements.push("commit;");
await writeFile(
  `${outputPrefix}.json`,
  JSON.stringify({ plans, unresolved, conflicts }, null, 2),
);
await writeFile(`${outputPrefix}.sql`, statements.join("\n\n"));
console.log(
  `Read-only planning complete: ${plans.length} compatible plans, ${unresolved.length} unresolved identities, ${conflicts.length} conflicting groups. No database was connected or modified.`,
);
