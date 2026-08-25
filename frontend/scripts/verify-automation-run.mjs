/**
 * Verifies the automation runner end-to-end against the live Supabase database.
 *
 * Usage (from frontend/):
 *   node scripts/verify-automation-run.mjs
 *
 * Requires in .env.local:
 *   - SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SECRET_KEY)
 *   - AUTOMATION_RUNNER_SECRET
 *   - DEFAULT_GYM_ID (optional; first gym is used when omitted)
 *   - APP_URL (optional; defaults to http://localhost:3000)
 */

import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(__dirname, "..", ".env.local");

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const env = {};
  for (const line of fs.readFileSync(filePath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index === -1) continue;
    env[trimmed.slice(0, index)] = trimmed.slice(index + 1);
  }
  return env;
}

const env = { ...process.env, ...loadEnvFile(envPath) };
const url = env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY ?? env.SUPABASE_SECRET_KEY;
const runnerSecret = env.AUTOMATION_RUNNER_SECRET;
const appUrl = env.APP_URL ?? "http://localhost:3000";

if (!url || !serviceKey) {
  console.error(
    "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY / SUPABASE_SECRET_KEY in .env.local",
  );
  process.exit(1);
}
if (!runnerSecret) {
  console.error("Missing AUTOMATION_RUNNER_SECRET in .env.local");
  process.exit(1);
}

const supabase = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const today = new Date().toISOString().slice(0, 10);

async function main() {
  let gymId = env.DEFAULT_GYM_ID;
  if (!gymId) {
    const { data: gyms, error } = await supabase.from("gyms").select("id,gym_name").limit(1);
    if (error) throw new Error(`Failed to load gyms: ${error.message}`);
    if (!gyms?.length) throw new Error("No gyms found in the database.");
    gymId = gyms[0].id;
    console.log(`Using gym ${gyms[0].gym_name} (${gymId})`);
  } else {
    console.log(`Using DEFAULT_GYM_ID=${gymId}`);
  }

  const { data: config } = await supabase
    .from("automation_configs")
    .select("*")
    .eq("gym_id", gymId)
    .eq("automation_type", "expired_membership_follow_up")
    .maybeSingle();

  console.log("Expired membership config:", config ?? "(none)");

  const { data: memberships } = await supabase
    .from("memberships")
    .select("id, conversation_id, expiry_date")
    .eq("gym_id", gymId)
    .lte("expiry_date", today);

  console.log(
    "Expired memberships:",
    memberships?.map((item) => ({
      id: item.id,
      conversation_id: item.conversation_id,
      expiry_date: item.expiry_date,
    })) ?? [],
  );

  const { count: executionsBefore } = await supabase
    .from("automation_executions")
    .select("id", { count: "exact", head: true })
    .eq("gym_id", gymId);

  const response = await fetch(`${appUrl}/api/automations/run`, {
    body: JSON.stringify({ gymId }),
    headers: {
      Authorization: `Bearer ${runnerSecret}`,
      "Content-Type": "application/json",
    },
    method: "POST",
  });

  const body = await response.json().catch(() => ({}));
  console.log("Runner response:", response.status, body);

  if (!response.ok) {
    process.exit(1);
  }

  const { data: executionsAfter } = await supabase
    .from("automation_executions")
    .select("id, conversation_id, trigger_key, status, sent_message_id, created_at")
    .eq("gym_id", gymId)
    .order("created_at", { ascending: false })
    .limit(5);

  console.log("Recent automation_executions:", executionsAfter);

  const latestExecution = executionsAfter?.[0];
  if (!latestExecution) {
    console.error("No automation_executions records found after run.");
    process.exit(1);
  }

  if (latestExecution.status === "sent" && latestExecution.sent_message_id) {
    const { data: message } = await supabase
      .from("messages")
      .select("id, conversation_id, sender_type, content, created_at")
      .eq("id", latestExecution.sent_message_id)
      .maybeSingle();

    console.log("Sent message:", message);

    if (!message) {
      console.error("sent_message_id does not resolve to a messages row.");
      process.exit(1);
    }
    if (message.conversation_id !== latestExecution.conversation_id) {
      console.error("Message conversation_id does not match execution conversation_id.");
      process.exit(1);
    }
    if (message.sender_type !== "ai") {
      console.error("Automation message sender_type is not ai.");
      process.exit(1);
    }
  } else {
    console.log(
      `Latest execution status=${latestExecution.status}; sent message verification skipped.`,
    );
  }

  console.log(
    `Executions before=${executionsBefore ?? 0}, after sample count=${executionsAfter?.length ?? 0}`,
  );
  console.log("Verification complete.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
