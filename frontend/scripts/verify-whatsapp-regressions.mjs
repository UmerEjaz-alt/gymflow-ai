import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { validateWhatsAppImageUpload } from "../src/lib/whatsapp-media-upload.ts";

const readSource = (relativePath) =>
  readFile(new URL(`../${relativePath}`, import.meta.url), "utf8");

const [
  inbox,
  conversations,
  appLayout,
  activeBranch,
  branchSelector,
  turn,
  reply,
  outbox,
  webhook,
  mediaManager,
  settingsActions,
] = await Promise.all([
  readSource("src/app/(app)/inbox/page.tsx"),
  readSource("src/services/conversation.server.ts"),
  readSource("src/app/(app)/layout.tsx"),
  readSource("src/lib/active-branch.server.ts"),
  readSource("src/components/layouts/branch-selector.tsx"),
  readSource("src/services/conversation-turn.server.ts"),
  readSource("src/services/conversation-reply.server.ts"),
  readSource("src/services/whatsapp-outbox.server.ts"),
  readSource("src/app/api/webhooks/whatsapp/route.ts"),
  readSource("src/features/settings/components/media-manager.tsx"),
  readSource("src/app/(app)/settings/actions.ts"),
]);

// Inbox must use the selected branch scope, including the explicit NULL scope,
// without excluding real WhatsApp rows by source.
assert.match(inbox, /resolved\.isUnassigned\s*\?\s*"unassigned"/);
assert.match(
  inbox,
  /listConversationsWithMessagePreview\(\s*gym\.id,\s*undefined,\s*conversationScope/s,
);
assert.match(inbox, /conversation\.source !== "simulator"/);
assert.match(conversations, /\.eq\("gym_id", gymId\)/);
assert.match(
  conversations,
  /branchId === "unassigned"[\s\S]*\.is\("branch_id", null\)/,
);
assert.match(conversations, /else if \(branchId\)[\s\S]*\.eq\("branch_id", branchId\)/);

// The server and client selector must agree on the unassigned sentinel, even
// for a one-branch gym that uses a shared WhatsApp number.
assert.match(activeBranch, /cookieBranchId === UNASSIGNED_BRANCH_SENTINEL/);
assert.match(appLayout, /resolved\.isUnassigned[\s\S]*UNASSIGNED_BRANCH_SENTINEL/);
assert.doesNotMatch(branchSelector, /branches\.length <= 1/);
assert.match(branchSelector, /value=\{UNASSIGNED_BRANCH_SENTINEL\}/);

// A validated branch choice is persisted only when it is gym-owned and agrees
// with the authoritative resolved turn; exploratory cross-branch facts cannot
// switch the conversation.
assert.match(
  turn,
  /allowedBranchIds\.includes\(pipelineResult\.validatedResponse\.selectedBranchId\)/,
);
assert.match(turn, /selectedBranchId ===\s*initialTurn\.effectiveBranchId/);
assert.match(turn, /persistPrimaryBranchId:\s*validatedSelectedBranchId/);
assert.match(reply, /allowedBranchIds\.includes\(branchIdToPersist\)/);

// Media remains one authoritative persisted sequence. The outbox reads the
// saved image URL and the webhook delivers every saved message in order.
assert.match(reply, /media_asset_id: asset!\.id/);
assert.match(reply, /media_url: asset!\.media_url/);
assert.match(reply, /outbound_delivery: "whatsapp_outbox"/);
assert.match(outbox, /message\.message_type === "image" && imageUrl/);
assert.match(outbox, /sendWhatsAppImage\(\{/);
assert.match(webhook, /for \(const message of turn\.outboundMessages/);
assert.match(mediaManager, /accept=\{WHATSAPP_IMAGE_ACCEPT\}/);
assert.doesNotMatch(mediaManager, /createBrowserSupabaseClient/);
assert.match(settingsActions, /validateWhatsAppImageUpload\(file\)/);
assert.match(
  settingsActions,
  /validateWhatsAppImageUpload\(file\)[\s\S]*supabase\.storage[\s\S]*\.from\("gymflow-media"\)[\s\S]*\.upload/,
);

const jpegBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const webpBytes = new TextEncoder().encode("RIFF0000WEBP");
const gifBytes = new TextEncoder().encode("GIF89a");
const svgBytes = new TextEncoder().encode("<svg></svg>");
const avifBytes = new TextEncoder().encode("....ftypavif");

for (const file of [
  new File([jpegBytes], "photo.jpg", { type: "image/jpeg" }),
  new File([jpegBytes], "photo.jpeg", { type: "image/jpeg" }),
  new File([pngBytes], "photo.png", { type: "image/png" }),
]) {
  assert.equal((await validateWhatsAppImageUpload(file)).error, null);
}

for (const file of [
  new File([webpBytes], "photo.webp", { type: "image/webp" }),
  new File([gifBytes], "photo.gif", { type: "image/gif" }),
  new File([svgBytes], "photo.svg", { type: "image/svg+xml" }),
  new File([avifBytes], "photo.avif", { type: "image/avif" }),
  new File([webpBytes], "disguised.jpg", { type: "image/jpeg" }),
  new File([pngBytes], "wrong-signature.jpg", { type: "image/jpeg" }),
  new File([jpegBytes], "wrong-extension.webp", { type: "image/jpeg" }),
  new File([new Uint8Array(5 * 1024 * 1024 + 1)], "too-large.jpg", {
    type: "image/jpeg",
  }),
]) {
  assert.notEqual((await validateWhatsAppImageUpload(file)).error, null);
}

console.log("WhatsApp inbox and unassigned-branch visibility checks passed.");
console.log("Authoritative branch persistence checks passed.");
console.log("Persisted media-to-outbox delivery checks passed.");
console.log("Authoritative WhatsApp image upload validation checks passed.");
