/**
 * Resets automation executions and enables all configs for re-testing message content.
 */
import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const env = Object.fromEntries(
  fs
    .readFileSync(path.join(__dirname, "..", ".env.local"), "utf8")
    .split("\n")
    .filter((l) => l && !l.startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i), l.slice(i + 1)];
    }),
);

const supabase = createClient(
  env.NEXT_PUBLIC_SUPABASE_URL,
  env.SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: { autoRefreshToken: false, persistSession: false },
  },
);

const gymId = (await supabase.from("gyms").select("id").limit(1).maybeSingle()).data
  ?.id;

if (!gymId) throw new Error("No gym");

console.log("Gym:", gymId);

// Enable all four automation types for testing
for (const automation_type of [
  "membership_expiry_reminder",
  "expired_membership_follow_up",
  "member_check_in",
  "lead_follow_up",
]) {
  const defaults = {
    membership_expiry_reminder: { delay_days: 1 },
    expired_membership_follow_up: { delay_days: 0 },
    member_check_in: { delay_days: 30 },
    lead_follow_up: { delay_days: 0 },
  };
  const { error } = await supabase.from("automation_configs").upsert(
    {
      gym_id: gymId,
      automation_type,
      enabled: true,
      auto_send: true,
      max_follow_ups: 1,
      quiet_hours_start: null,
      quiet_hours_end: null,
      delay_days: defaults[automation_type].delay_days,
    },
    { onConflict: "gym_id,automation_type" },
  );
  if (error) console.error(`Config ${automation_type}:`, error.message);
  else console.log(`Enabled ${automation_type}`);
}

// Delete prior executions so triggers can fire again with fixed pipeline
const { error: delError, count } = await supabase
  .from("automation_executions")
  .delete({ count: "exact" })
  .eq("gym_id", gymId);
console.log(`Deleted ${count ?? 0} prior executions`, delError?.message ?? "");

// Run automations
const response = await fetch("http://localhost:3000/api/automations/run", {
  body: JSON.stringify({ gymId }),
  headers: {
    Authorization: `Bearer ${env.AUTOMATION_RUNNER_SECRET}`,
    "Content-Type": "application/json",
  },
  method: "POST",
});
const body = await response.json();
console.log("Run result:", response.status, body);

// Fetch new executions + messages
const { data: executions } = await supabase
  .from("automation_executions")
  .select("automation_config_id, conversation_id, trigger_key, status, sent_message_id")
  .eq("gym_id", gymId)
  .order("created_at", { ascending: true });

for (const exec of executions ?? []) {
  const { data: config } = await supabase
    .from("automation_configs")
    .select("automation_type")
    .eq("id", exec.automation_config_id)
    .maybeSingle();
  const { data: message } = exec.sent_message_id
    ? await supabase
        .from("messages")
        .select("content, sender_type, conversation_id")
        .eq("id", exec.sent_message_id)
        .maybeSingle()
    : { data: null };
  console.log("\n---", config?.automation_type ?? "unknown", "---");
  console.log("trigger:", exec.trigger_key, "status:", exec.status);
  console.log("conversation_id:", exec.conversation_id);
  console.log("message:", message?.content ?? "(none)");
  console.log("sender_type:", message?.sender_type);
  console.log("conversation match:", message?.conversation_id === exec.conversation_id);
}

// Second run for duplicate test
const second = await fetch("http://localhost:3000/api/automations/run", {
  body: JSON.stringify({ gymId }),
  headers: {
    Authorization: `Bearer ${env.AUTOMATION_RUNNER_SECRET}`,
    "Content-Type": "application/json",
  },
  method: "POST",
});
console.log("\nDuplicate run:", await second.json());
