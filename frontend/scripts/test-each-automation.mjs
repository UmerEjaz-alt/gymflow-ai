/**
 * Tests each automation type in isolation to verify correctness.
 * Enables one type at a time, clears executions, runs, inspects the message.
 *
 * Usage: node scripts/test-each-automation.mjs
 *
 * Because this uses the real Groq API it adds a 15-second pause between
 * each type to stay well inside free-tier TPM limits.
 */

import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function loadEnv() {
  const raw = fs.readFileSync(path.join(__dirname, "..", ".env.local"), "utf8");
  return Object.fromEntries(
    raw.split("\n")
      .filter((l) => l.trim() && !l.startsWith("#"))
      .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
  );
}

const env = loadEnv();
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const APP_URL = env.APP_URL ?? "http://localhost:3000";
const SECRET  = env.AUTOMATION_RUNNER_SECRET;
const today   = new Date().toISOString().slice(0, 10);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getGymId() {
  const { data } = await sb.from("gyms").select("id").limit(1).maybeSingle();
  return data?.id;
}

async function disableAll(gymId) {
  await sb.from("automation_configs").update({ enabled: false }).eq("gym_id", gymId);
}

async function enableOnly(gymId, type, overrides = {}) {
  const defaults = {
    membership_expiry_reminder:  { delay_days: 1  },
    expired_membership_follow_up: { delay_days: 0 },
    member_check_in:             { delay_days: 30 },
    lead_follow_up:              { delay_days: 0  },
  };
  await sb.from("automation_configs").upsert(
    {
      gym_id: gymId,
      automation_type: type,
      enabled: true,
      auto_send: true,
      max_follow_ups: 2,
      quiet_hours_start: null,
      quiet_hours_end: null,
      delay_days: defaults[type].delay_days,
      ...overrides,
    },
    { onConflict: "gym_id,automation_type" },
  );
}

async function clearExecutions(gymId) {
  const { count } = await sb.from("automation_executions").delete({ count: "exact" }).eq("gym_id", gymId);
  return count ?? 0;
}

async function run(gymId) {
  const res = await fetch(`${APP_URL}/api/automations/run`, {
    method: "POST",
    headers: { Authorization: `Bearer ${SECRET}`, "Content-Type": "application/json" },
    body: JSON.stringify({ gymId }),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

async function run2(gymId) {
  // Second run to check duplicate prevention
  const res = await fetch(`${APP_URL}/api/automations/run`, {
    method: "POST",
    headers: { Authorization: `Bearer ${SECRET}`, "Content-Type": "application/json" },
    body: JSON.stringify({ gymId }),
  });
  return res.json().catch(() => ({}));
}

async function latestSentMessage(gymId, triggerPrefix) {
  const { data: execs } = await sb
    .from("automation_executions")
    .select("trigger_key, status, error_message, sent_message_id, conversation_id")
    .eq("gym_id", gymId)
    .like("trigger_key", `${triggerPrefix}%`)
    .order("created_at", { ascending: false })
    .limit(5);

  const results = [];
  for (const exec of execs ?? []) {
    let content = null;
    if (exec.sent_message_id) {
      const { data: msg } = await sb.from("messages").select("content, sender_type").eq("id", exec.sent_message_id).maybeSingle();
      content = msg?.content ?? null;
    }
    results.push({ ...exec, content });
  }
  return results;
}

function assess(type, text) {
  if (!text || text.trim().length < 10) return "FAIL: message empty or too short";
  const lower = text.toLowerCase();
  const pkgCount = (lower.match(/\bpackage\b/g) ?? []).length;
  const dumpsPackages = pkgCount >= 3 || (lower.includes("here are") && lower.includes("package"));
  if (dumpsPackages) return `FAIL: generic package dump (package mentioned ${pkgCount}x)`;
  if (type === "membership_expiry_reminder" && !/expir|renew|ending|end(s)? soon|upcoming|reminder/.test(lower))
    return "WARN: missing expiry/renewal language";
  if (type === "expired_membership_follow_up" && !/expir|renew|check.?in|follow/.test(lower))
    return "WARN: missing expiry/renewal language";
  if (type === "member_check_in" && !/check.?in|how.*going|how.*finding|getting on|settling|how.*been|hope.*enjoy/.test(lower))
    return "WARN: missing check-in tone";
  if (type === "lead_follow_up" && dumpsPackages)
    return "FAIL: lead follow-up dumped packages";
  return "OK";
}

// ─── Test runner ──────────────────────────────────────────────────────────────

const gymId = await getGymId();
if (!gymId) { console.error("No gym found"); process.exit(1); }
console.log(`Gym: ${gymId}   Today: ${today}\n`);

// Show current data
const { data: memberships } = await sb.from("memberships")
  .select("id, conversation_id, start_date, expiry_date, package:membership_packages(package_name)")
  .eq("gym_id", gymId);
console.log("Memberships:");
memberships?.forEach((m) => console.log(`  ${m.id.slice(0,8)} ${m.start_date}→${m.expiry_date}  ${m.package?.package_name}  conv:${m.conversation_id.slice(0,8)}`));

const { data: leads } = await sb.from("conversations")
  .select("id, customer_name, lead_stage")
  .eq("gym_id", gymId)
  .not("lead_stage", "in", '("member","lost")')
  .order("last_message_at", { ascending: false })
  .limit(3); // only first 3 for display
console.log(`\nLead conversations (top 3 of many): ${leads?.map((c) => `${c.id.slice(0,8)} ${c.customer_name}`).join(" | ")}\n`);

const TYPES = [
  { type: "membership_expiry_reminder",  prefix: "expiry-",       label: "1. MEMBERSHIP EXPIRY REMINDER" },
  { type: "expired_membership_follow_up", prefix: "expired-",     label: "2. EXPIRED MEMBERSHIP FOLLOW-UP" },
  { type: "member_check_in",             prefix: "check-in-",     label: "3. MEMBER CHECK-IN" },
  { type: "lead_follow_up",             prefix: "lead-follow-up-", label: "4. LEAD FOLLOW-UP" },
];

const results = [];

for (const { type, prefix, label } of TYPES) {
  console.log(`\n${"═".repeat(60)}`);
  console.log(label);
  console.log("═".repeat(60));

  await disableAll(gymId);
  await enableOnly(gymId, type);
  const cleared = await clearExecutions(gymId);
  console.log(`Cleared ${cleared} prior executions. Only '${type}' enabled.`);

  const { status, body } = await run(gymId);
  console.log(`Runner → HTTP ${status}  sent=${body.sent} skipped=${body.skipped} failed=${body.failed}`);

  // If some failed (rate limit), wait and retry once
  if (body.failed > 0) {
    console.log("  Some failed — waiting 20s for rate-limit reset then retrying...");
    await sleep(20_000);
    const retry = await run(gymId);
    console.log(`  Retry  → sent=${retry.body.sent} skipped=${retry.body.skipped} failed=${retry.body.failed}`);
  }

  const execResults = await latestSentMessage(gymId, prefix);
  if (execResults.length === 0) {
    console.log("  No executions found — automation may not have matching data.");
    results.push({ label, type, pass: false, reason: "no execution found" });
    continue;
  }

  // Take the first sent one, or the first overall if none sent
  const sentExec = execResults.find((e) => e.status === "sent") ?? execResults[0];
  console.log(`\n  trigger_key : ${sentExec.trigger_key}`);
  console.log(`  status      : ${sentExec.status}`);
  if (sentExec.status !== "sent") {
    console.log(`  error       : ${sentExec.error_message}`);
    results.push({ label, type, pass: false, reason: sentExec.error_message ?? "not sent" });
    continue;
  }
  console.log(`  conversation: ${sentExec.conversation_id}`);
  console.log(`  message     : "${sentExec.content}"`);
  const assessment = assess(type, sentExec.content);
  console.log(`  assessment  : ${assessment}`);

  // Duplicate check
  const dup = await run2(gymId);
  console.log(`  dup run     : sent=${dup.sent} skipped=${dup.skipped} failed=${dup.failed}  (sent must be 0)`);
  const dupOk = dup.sent === 0;

  const pass = assessment.startsWith("OK") && dupOk;
  results.push({ label, type, pass, assessment, dupOk, message: sentExec.content });

  // Pause between types to respect TPM limit
  if (type !== TYPES.at(-1).type) {
    console.log("  (pausing 15s before next type to avoid rate-limit burst)");
    await sleep(15_000);
  }
}

// ─── Summary ─────────────────────────────────────────────────────────────────
console.log(`\n${"═".repeat(60)}`);
console.log("SUMMARY");
console.log("═".repeat(60));
let allPassed = true;
for (const r of results) {
  const icon = r.pass ? "✅" : "❌";
  console.log(`${icon}  ${r.label}`);
  if (!r.pass) {
    console.log(`     reason: ${r.reason ?? r.assessment}`);
    allPassed = false;
  } else {
    console.log(`     assessment: ${r.assessment}   dup prevention: ${r.dupOk ? "OK" : "FAIL"}`);
  }
}
console.log(allPassed ? "\nAll four automation types PASSED." : "\nSome types FAILED — see above.");
