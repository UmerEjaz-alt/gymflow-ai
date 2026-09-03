/**
 * Verifies the database idempotency boundary used by AI booking mutations.
 *
 * Run against a development database after migration 000021:
 *   node scripts/verify-booking-action-idempotency.mjs
 *
 * Required .env.local values:
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SECRET_KEY)
 *
 * By default, the script finds an existing Simulator conversation, creates four
 * short-lived customer messages there, and removes both those messages and the
 * ledger rows it creates before it exits. It never uses WhatsApp conversations.
 *
 * Optional manual fixture override (all values are required together):
 *   BOOKING_IDEMPOTENCY_TEST_GYM_ID
 *   BOOKING_IDEMPOTENCY_TEST_CONVERSATION_ID
 *   BOOKING_IDEMPOTENCY_TEST_CREATE_MESSAGE_ID
 *   BOOKING_IDEMPOTENCY_TEST_RESCHEDULE_MESSAGE_ID
 *   BOOKING_IDEMPOTENCY_TEST_CANCEL_MESSAGE_ID
 *   BOOKING_IDEMPOTENCY_TEST_SAME_TEXT_MESSAGE_ID
 *
 * The four supplied message IDs must be distinct persisted customer messages in
 * the supplied conversation. The create and same-text IDs must have identical
 * content. The script removes only ledger rows it creates.
 */

import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const directory = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(directory, "..", ".env.local");

function loadEnv(filePath) {
  if (!fs.existsSync(filePath)) return {};
  return Object.fromEntries(
    fs
      .readFileSync(filePath, "utf8")
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#") && line.includes("="))
      .map((line) => {
        const index = line.indexOf("=");
        return [line.slice(0, index), line.slice(index + 1)];
      }),
  );
}

const env = { ...process.env, ...loadEnv(envPath) };
const url = env.NEXT_PUBLIC_SUPABASE_URL;
const key = env.SUPABASE_SERVICE_ROLE_KEY ?? env.SUPABASE_SECRET_KEY;
const manualFixtureVariables = [
  "BOOKING_IDEMPOTENCY_TEST_GYM_ID",
  "BOOKING_IDEMPOTENCY_TEST_CONVERSATION_ID",
  "BOOKING_IDEMPOTENCY_TEST_CREATE_MESSAGE_ID",
  "BOOKING_IDEMPOTENCY_TEST_RESCHEDULE_MESSAGE_ID",
  "BOOKING_IDEMPOTENCY_TEST_CANCEL_MESSAGE_ID",
  "BOOKING_IDEMPOTENCY_TEST_SAME_TEXT_MESSAGE_ID",
];

if (!url || !key) {
  console.error(
    "Missing Supabase credentials. Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SECRET_KEY) in .env.local.",
  );
  process.exit(1);
}

const suppliedManualFixtureVariables = manualFixtureVariables.filter(
  (name) => env[name],
);
if (
  suppliedManualFixtureVariables.length > 0 &&
  suppliedManualFixtureVariables.length !== manualFixtureVariables.length
) {
  console.error(
    `Incomplete manual fixture. Either remove BOOKING_IDEMPOTENCY_TEST_* values to use a disposable Simulator fixture, or provide all of: ${manualFixtureVariables.join(", ")}.`,
  );
  process.exit(1);
}

const supabase = createClient(url, key, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const insertedSourceIds = [];
const createdMessageIds = [];

async function resolveManualFixture() {
  const gymId = env.BOOKING_IDEMPOTENCY_TEST_GYM_ID;
  const conversationId = env.BOOKING_IDEMPOTENCY_TEST_CONVERSATION_ID;
  const messageIds = manualFixtureVariables.slice(2).map((name) => env[name]);

  if (new Set(messageIds).size !== messageIds.length) {
    throw new Error("Manual fixture message IDs must all be distinct.");
  }

  const { data: messages, error } = await supabase
    .from("messages")
    .select("id, conversation_id, sender_type, content, conversations!inner(gym_id)")
    .in("id", messageIds);

  if (error)
    throw new Error(`Could not validate manual fixture messages: ${error.message}`);
  if (!messages || messages.length !== messageIds.length) {
    throw new Error("One or more manual fixture messages do not exist.");
  }

  const byId = new Map(messages.map((message) => [message.id, message]));
  const orderedMessages = messageIds.map((id) => byId.get(id));
  if (
    orderedMessages.some(
      (message) =>
        !message ||
        message.sender_type !== "customer" ||
        message.conversation_id !== conversationId ||
        message.conversations?.gym_id !== gymId,
    )
  ) {
    throw new Error(
      "Manual fixture messages must be customer messages in the supplied conversation and gym.",
    );
  }
  if (orderedMessages[0].content !== orderedMessages[3].content) {
    throw new Error(
      "The create and same-text manual fixture messages must have identical content.",
    );
  }

  return { gymId, conversationId, messageIds, source: "manual" };
}

async function createDisposableSimulatorFixture() {
  const { data: conversations, error } = await supabase
    .from("conversations")
    .select("id, gym_id")
    .eq("source", "simulator")
    .order("last_message_at", { ascending: false })
    .limit(1);

  if (error)
    throw new Error(`Could not find a Simulator conversation: ${error.message}`);
  const conversation = conversations?.[0];
  if (!conversation) {
    throw new Error(
      "No Simulator conversation was found. Create any Simulator conversation first, then run this command again; no WhatsApp/customer conversation will be used automatically.",
    );
  }

  const marker = `GymFlow idempotency verification ${Date.now()}`;
  const rows = [
    { content: `${marker} create` },
    { content: `${marker} reschedule` },
    { content: `${marker} cancel` },
    { content: `${marker} create` },
  ].map(({ content }) => ({
    conversation_id: conversation.id,
    sender_type: "customer",
    message_type: "text",
    content,
    metadata: { booking_idempotency_test: true },
  }));

  const { data: messages, error: insertError } = await supabase
    .from("messages")
    .insert(rows)
    .select("id, content");
  if (insertError || !messages || messages.length !== rows.length) {
    throw new Error(
      `Could not create disposable Simulator messages: ${insertError?.message ?? "unknown error"}`,
    );
  }

  const createMessageIds = messages
    .filter((message) => message.content === `${marker} create`)
    .map((message) => message.id);
  const rescheduleMessageId = messages.find(
    (message) => message.content === `${marker} reschedule`,
  )?.id;
  const cancelMessageId = messages.find(
    (message) => message.content === `${marker} cancel`,
  )?.id;
  if (createMessageIds.length !== 2 || !rescheduleMessageId || !cancelMessageId) {
    throw new Error("Disposable Simulator messages could not be identified safely.");
  }

  const messageIds = [
    createMessageIds[0],
    rescheduleMessageId,
    cancelMessageId,
    createMessageIds[1],
  ];
  createdMessageIds.push(...messageIds);
  return {
    gymId: conversation.gym_id,
    conversationId: conversation.id,
    messageIds,
    source: "disposable Simulator",
  };
}

async function resolveFixture() {
  if (suppliedManualFixtureVariables.length === manualFixtureVariables.length) {
    return resolveManualFixture();
  }
  return createDisposableSimulatorFixture();
}

async function claim(gymId, conversationId, sourceMessageId, actionType) {
  const { error } = await supabase.from("booking_action_executions").insert({
    gym_id: gymId,
    conversation_id: conversationId,
    source_message_id: sourceMessageId,
    action_type: actionType,
  });
  if (!error) insertedSourceIds.push(sourceMessageId);
  return error;
}

async function expectFirstClaimAndDuplicate(
  gymId,
  conversationId,
  sourceMessageId,
  actionType,
  label,
) {
  const first = await claim(gymId, conversationId, sourceMessageId, actionType);
  if (first) throw new Error(`${label}: first claim failed: ${first.message}`);
  const duplicate = await claim(gymId, conversationId, sourceMessageId, actionType);
  if (duplicate?.code !== "23505") {
    throw new Error(`${label}: duplicate claim was not rejected by unique constraint.`);
  }
  console.log(`${label}: one claim accepted; duplicate rejected.`);
}

async function main() {
  try {
    const fixture = await resolveFixture();
    const { gymId, conversationId, messageIds } = fixture;
    console.log(`Using ${fixture.source} fixture.`);

    await expectFirstClaimAndDuplicate(
      gymId,
      conversationId,
      messageIds[0],
      "create",
      "Duplicate create",
    );
    await expectFirstClaimAndDuplicate(
      gymId,
      conversationId,
      messageIds[1],
      "reschedule",
      "Duplicate reschedule",
    );
    await expectFirstClaimAndDuplicate(
      gymId,
      conversationId,
      messageIds[2],
      "cancel",
      "Duplicate cancel",
    );

    const differentMessage = await claim(
      gymId,
      conversationId,
      messageIds[3],
      "create",
    );
    if (differentMessage) {
      throw new Error(
        `Same-text/different-message-ID claim failed: ${differentMessage.message}`,
      );
    }
    console.log(
      "Same text with a different inbound message ID: accepted as a new action.",
    );
    console.log("Booking action idempotency verification passed.");
  } finally {
    let ledgerCleanupSucceeded = true;
    if (insertedSourceIds.length > 0) {
      const { error } = await supabase
        .from("booking_action_executions")
        .delete()
        .in("source_message_id", insertedSourceIds);
      if (error) {
        ledgerCleanupSucceeded = false;
        console.error("Could not remove test ledger rows:", error.message);
      }
    }
    if (createdMessageIds.length > 0 && ledgerCleanupSucceeded) {
      const { error } = await supabase
        .from("messages")
        .delete()
        .in("id", createdMessageIds);
      if (error)
        console.error("Could not remove disposable Simulator messages:", error.message);
    } else if (createdMessageIds.length > 0) {
      console.error(
        "Disposable Simulator messages were kept because their ledger cleanup failed.",
      );
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
