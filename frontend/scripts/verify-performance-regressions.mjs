import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  conversationMatchesScope,
  normalizeConversationMessagePreviews,
  replaceConversationMessages,
} from "../src/lib/conversation-message-query.ts";
import { newestFirstToChronological } from "../src/lib/message-order.ts";

const readSource = (relativePath) =>
  readFile(new URL(`../${relativePath}`, import.meta.url), "utf8");

const conversation = (id, gymId, branchId, messages = []) => ({
  id,
  gym_id: gymId,
  branch_id: branchId,
  messages,
});
const message = (id, conversationId, createdAt) => ({
  id,
  conversation_id: conversationId,
  created_at: createdAt,
});

// Embedded previews remain associated and bounded to one row per conversation.
const previewRows = normalizeConversationMessagePreviews([
  conversation("c1", "gym-a", "branch-a", [
    message("c1-new", "c1", "2026-01-03"),
    message("c1-old", "c1", "2026-01-02"),
    message("wrong", "c2", "2026-01-04"),
  ]),
  conversation("c2", "gym-a", null, [message("c2-new", "c2", "2026-01-03")]),
]);
assert.deepEqual(
  previewRows.map((row) => row.messages.map((item) => item.id)),
  [["c1-new"], ["c2-new"]],
);

// Lazy selected-history replacement cannot alter another conversation.
const selectedRows = replaceConversationMessages(previewRows, "c2", [
  message("c2-old", "c2", "2026-01-01"),
  message("cross", "c1", "2026-01-02"),
]);
assert.deepEqual(
  selectedRows[0].messages.map((item) => item.id),
  ["c1-new"],
);
assert.deepEqual(
  selectedRows[1].messages.map((item) => item.id),
  ["c2-old"],
);

// Tenant, branch, and explicit unassigned scopes remain exact.
assert.equal(conversationMatchesScope(previewRows[0], "gym-a", "branch-a"), true);
assert.equal(conversationMatchesScope(previewRows[0], "gym-b", "branch-a"), false);
assert.equal(conversationMatchesScope(previewRows[0], "gym-a", "branch-b"), false);
assert.equal(conversationMatchesScope(previewRows[1], "gym-a", null), true);
assert.equal(conversationMatchesScope(previewRows[1], "gym-a", "branch-a"), false);

// A newest-first database result is restored to the same latest-20
// chronological context. Histories shorter than 20 are unchanged.
const chronological25 = Array.from({ length: 25 }, (_, index) => index + 1);
const databaseLimited20 = [...chronological25].reverse().slice(0, 20);
assert.deepEqual(
  newestFirstToChronological(databaseLimited20),
  chronological25.slice(-20),
);
const chronological7 = Array.from({ length: 7 }, (_, index) => index + 1);
assert.deepEqual(
  newestFirstToChronological([...chronological7].reverse()),
  chronological7,
);

const [conversationService, messageService, manager, inbox, leads, members, branch] =
  await Promise.all([
    readSource("src/services/conversation.server.ts"),
    readSource("src/services/message.server.ts"),
    readSource("src/services/conversation-manager.server.ts"),
    readSource("src/app/(app)/inbox/page.tsx"),
    readSource("src/app/(app)/leads/page.tsx"),
    readSource("src/app/(app)/members/page.tsx"),
    readSource("src/lib/active-branch.server.ts"),
  ]);

assert.match(conversationService, /select\("\*, messages\(\*\)"\)/);
assert.match(conversationService, /limit\(1, \{ referencedTable: "messages" \}\)/);
assert.match(messageService, /order\("created_at", \{ ascending: false \}\)/);
assert.match(messageService, /\.limit\(boundedLimit\)/);
assert.match(manager, /listRecentMessages\([\s\S]*LATEST_MESSAGES_LIMIT/);
assert.doesNotMatch(manager, /slice\(-LATEST_MESSAGES_LIMIT\)/);
assert.match(
  manager,
  /Promise\.all\(\[\s*conversationUpdatePromise,\s*historyPromise,?\s*\]\)/,
);

assert.match(inbox, /listConversationsWithMessagePreview/);
assert.match(
  inbox,
  /Promise\.all\(\[[\s\S]*getWhatsAppEndpoints[\s\S]*listConversationsWithMessagePreview/,
);
assert.doesNotMatch(inbox, /conversationsResult[\s\S]*\.map\(async[\s\S]*listMessages/);
assert.match(
  inbox,
  /if \(conversations\[0\]\)[\s\S]*listMessages\(conversations\[0\]\.id\)/,
);
assert.match(leads, /listConversationsWithMessagePreview/);
assert.doesNotMatch(leads, /\.map\(async[\s\S]*listMessages/);
assert.doesNotMatch(members, /listMessages\(/);
assert.match(branch, /cache\(resolveActiveBranchForRequest\)/);

const knowledgeLayer = await readSource("src/services/knowledge-layer.server.ts");
assert.match(
  knowledgeLayer,
  /const gymPromise =[\s\S]*const branchResolution = await branchResolutionPromise/,
);
assert.match(
  knowledgeLayer,
  /Promise\.all\(\[\s*pendingMediaPromise,\s*Promise\.all\(\[/,
);

for (const route of ["inbox", "leads", "bookings", "members"]) {
  const loading = await readSource(`src/app/(app)/${route}/loading.tsx`);
  assert.match(loading, /WorkspaceLoading/);
}

console.log("Dashboard preview batching and lazy-history checks passed.");
console.log("Tenant, branch, and unassigned scope checks passed.");
console.log("Database-limited latest-20 ordering checks passed.");
console.log("Request memoization and route loading-boundary checks passed.");
console.log("Inbound and knowledge critical-path concurrency checks passed.");
