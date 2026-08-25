/**
 * Tests all four automation types against the live database and inspects message content.
 *
 * Usage: node scripts/test-automation-types.mjs
 */

import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function loadEnv() {
  const env = { ...process.env };
  for (const line of fs.readFileSync(path.join(__dirname, "..", ".env.local"), "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const i = trimmed.indexOf("=");
    if (i === -1) continue;
    env[trimmed.slice(0, i)] = trimmed.slice(i + 1);
  }
  return env;
}

const env = loadEnv();
const url = env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY ?? env.SUPABASE_SECRET_KEY;
const runnerSecret = env.AUTOMATION_RUNNER_SECRET;
const appUrl = env.APP_URL ?? "http://localhost:3000";

if (!url || !serviceKey || !runnerSecret) {
  console.error("Missing required env vars.");
  process.exit(1);
}

const supabase = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const today = new Date().toISOString().slice(0, 10);

async function resolveGymId() {
  if (env.DEFAULT_GYM_ID) return env.DEFAULT_GYM_ID;
  const { data } = await supabase.from("gyms").select("id").limit(1).maybeSingle();
  return data?.id ?? null;
}

async function runAutomations(gymId) {
  const response = await fetch(`${appUrl}/api/automations/run`, {
    body: JSON.stringify({ gymId }),
    headers: {
      Authorization: `Bearer ${runnerSecret}`,
      "Content-Type": "application/json",
    },
    method: "POST",
  });
  const body = await response.json().catch(() => ({}));
  return { status: response.status, body };
}

async function latestExecution(gymId, triggerPrefix) {
  const { data } = await supabase
    .from("automation_executions")
    .select("*, message:messages(id, conversation_id, sender_type, content)")
    .eq("gym_id", gymId)
    .like("trigger_key", `${triggerPrefix}%`)
    .order("created_at", { ascending: false })
    .limit(1);
  return data?.[0] ?? null;
}

function assessContent(type, text) {
  const lower = (text ?? "").toLowerCase();
  const dumpsPackages =
    (lower.match(/package/g) ?? []).length >= 3 ||
    lower.includes("here are") && lower.includes("package");
  const issues = [];
  if (!text || text.trim().length < 10) issues.push("message too short or empty");
  if (dumpsPackages) issues.push("looks like a generic package dump");
  if (type === "membership_expiry_reminder" && !/expir|renew|ending|end(s)? soon|upcoming/.test(lower))
    issues.push("missing pre-expiry tone");
  if (type === "expired_membership_follow_up" && !/expir|renew|checking in|follow/.test(lower))
    issues.push("missing post-expiry tone");
  if (type === "member_check_in" && !/check(ing)? in|how.*going|getting started/.test(lower))
    issues.push("missing check-in tone");
  if (type === "lead_follow_up" && dumpsPackages) issues.push("lead follow-up dumped packages");
  return issues;
}

async function main() {
  const gymId = await resolveGymId();
  if (!gymId) throw new Error("No gym found");

  console.log(`Gym: ${gymId}\n`);

  const { data: configs } = await supabase
    .from("automation_configs")
    .select("*")
    .eq("gym_id", gymId);
  console.log("Automation configs:", configs?.map((c) => ({
    type: c.automation_type,
    enabled: c.enabled,
    auto_send: c.auto_send,
    delay_days: c.delay_days,
  })));

  const { data: memberships } = await supabase
    .from("memberships")
    .select("id, conversation_id, start_date, expiry_date, package:membership_packages(package_name)")
    .eq("gym_id", gymId);
  console.log("\nMemberships:", memberships);

  const { data: conversations } = await supabase
    .from("conversations")
    .select("id, customer_name, lead_stage, last_message_at")
    .eq("gym_id", gymId)
    .neq("lead_stage", "member")
    .neq("lead_stage", "lost");
  console.log("\nLead conversations:", conversations);

  console.log("\n--- Running automations ---");
  const result = await runAutomations(gymId);
  console.log("Runner result:", result);

  const checks = [
    ["membership_expiry_reminder", "expiry-"],
    ["expired_membership_follow_up", "expired-"],
    ["member_check_in", "check-in-"],
    ["lead_follow_up", "lead-follow-up-"],
  ];

  console.log("\n--- Execution review ---");
  for (const [type, prefix] of checks) {
    const exec = await latestExecution(gymId, prefix);
    if (!exec) {
      console.log(`\n${type}: no execution found (may not be due / enabled / already sent)`);
      continue;
    }
    const message = exec.message ?? (exec.sent_message_id
      ? (await supabase.from("messages").select("*").eq("id", exec.sent_message_id).maybeSingle()).data
      : null);
    const issues = assessContent(type, message?.content ?? "");
    console.log(`\n${type}:`);
    console.log(`  status=${exec.status} trigger=${exec.trigger_key}`);
    console.log(`  conversation_id=${exec.conversation_id}`);
    console.log(`  message: ${message?.content ?? "(none)"}`);
    console.log(`  assessment: ${issues.length ? issues.join("; ") : "OK"}`);
  }

  // Test E: lead with customer reply should not get follow-up when last msg is customer
  console.log("\n--- Test E check (lead replied) ---");
  for (const conv of conversations ?? []) {
    const { data: msgs } = await supabase
      .from("messages")
      .select("sender_type, content, created_at")
      .eq("conversation_id", conv.id)
      .order("created_at", { ascending: true });
    const last = msgs?.at(-1);
    if (last?.sender_type === "customer") {
      const exec = await supabase
        .from("automation_executions")
        .select("id, trigger_key, created_at")
        .eq("conversation_id", conv.id)
        .like("trigger_key", "lead-follow-up-%")
        .order("created_at", { ascending: false })
        .limit(1);
      console.log(
        `  conv ${conv.id} (${conv.customer_name}): last msg from customer -> recent lead exec:`,
        exec.data?.[0] ?? "none (correct if no new exec after customer reply)",
      );
    }
  }

  // Test F: duplicate run
  console.log("\n--- Test F: duplicate scheduler run ---");
  const before = await supabase
    .from("automation_executions")
    .select("id", { count: "exact", head: true })
    .eq("gym_id", gymId);
  const second = await runAutomations(gymId);
  const after = await supabase
    .from("automation_executions")
    .select("id", { count: "exact", head: true })
    .eq("gym_id", gymId);
  console.log("  first run:", result.body);
  console.log("  second run:", second.body);
  console.log(`  executions before=${before.count} after=${after.count} (should not grow for same triggers)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
