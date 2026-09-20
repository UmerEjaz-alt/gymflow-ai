import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolveMediaSelection } from "../src/services/media-selection.ts";

const branchA = "branch-a";
const branchB = "branch-b";
const gymPhoto = { id: "gym-photo-a", branch_id: branchA };
const secondGymPhoto = { id: "gym-photo-a-2", branch_id: branchA };
const trainerPhoto = { id: "trainer-photo-a", branch_id: branchA };
const otherBranchPhoto = { id: "gym-photo-b", branch_id: branchB };

const gymSelection = resolveMediaSelection({
  explicitMediaRequest: true,
  effectiveBranchId: branchA,
  authoritativeAssetIds: new Set([gymPhoto.id, secondGymPhoto.id]),
  requestedActions: [],
  allowedAssets: [gymPhoto, secondGymPhoto],
  fallbackAssets: [gymPhoto, secondGymPhoto],
});
assert.deepEqual(
  gymSelection.actions.map((action) => action.assetId),
  [gymPhoto.id, secondGymPhoto.id],
);
assert.equal(gymSelection.mediaUnavailable, false);

const trainerSelection = resolveMediaSelection({
  explicitMediaRequest: true,
  effectiveBranchId: branchA,
  authoritativeAssetIds: new Set([trainerPhoto.id]),
  requestedActions: [],
  allowedAssets: [trainerPhoto],
  fallbackAssets: [trainerPhoto],
});
assert.deepEqual(trainerSelection.actions, [
  { assetId: trainerPhoto.id, caption: null },
]);

const unavailableSelection = resolveMediaSelection({
  explicitMediaRequest: true,
  effectiveBranchId: branchA,
  authoritativeAssetIds: new Set(),
  requestedActions: [],
  allowedAssets: [],
  fallbackAssets: [],
});
assert.deepEqual(unavailableSelection.actions, []);
assert.equal(unavailableSelection.mediaUnavailable, true);

const isolatedSelection = resolveMediaSelection({
  explicitMediaRequest: true,
  effectiveBranchId: branchA,
  authoritativeAssetIds: new Set([gymPhoto.id, otherBranchPhoto.id]),
  requestedActions: [{ assetId: otherBranchPhoto.id, caption: "Wrong branch" }],
  allowedAssets: [gymPhoto, otherBranchPhoto],
  fallbackAssets: [otherBranchPhoto, gymPhoto],
});
assert.deepEqual(isolatedSelection.actions, [
  { assetId: gymPhoto.id, caption: null },
]);

const normalTextSelection = resolveMediaSelection({
  explicitMediaRequest: false,
  effectiveBranchId: branchA,
  authoritativeAssetIds: new Set([gymPhoto.id]),
  requestedActions: [],
  allowedAssets: [gymPhoto],
  fallbackAssets: [gymPhoto],
});
assert.deepEqual(normalTextSelection, { actions: [], mediaUnavailable: false });

const selectedByModel = resolveMediaSelection({
  explicitMediaRequest: true,
  effectiveBranchId: branchA,
  authoritativeAssetIds: new Set([secondGymPhoto.id]),
  requestedActions: [{ assetId: secondGymPhoto.id, caption: "Main floor" }],
  allowedAssets: [secondGymPhoto],
  fallbackAssets: [gymPhoto],
});
assert.deepEqual(selectedByModel.actions, [
  { assetId: secondGymPhoto.id, caption: "Main floor" },
]);

const [turnSource, replySource, promptSource] = await Promise.all([
  readFile(new URL("../src/services/conversation-turn.server.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/services/conversation-reply.server.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/services/prompt-builder.server.ts", import.meta.url), "utf8"),
]);
assert.match(turnSource, /resolveMediaSelection\(\{/);
assert.match(turnSource, /turn\.entity\?\.type === "trainer"[\s\S]*resolvedTrainerCards\.slice\(0, 1\)/);
assert.match(turnSource, /turn\.explicitMediaRequest && mediaActions\.length === 0/);
assert.match(turnSource, /text: responseText,[\s\S]*mediaActions,[\s\S]*messageSequence/);
assert.match(replySource, /message_type: isText \? "text" : "image"/);
assert.match(replySource, /media_asset_id: asset!\.id/);
assert.match(promptSource, /media_actions is REQUIRED for that turn/);
assert.match(promptSource, /never paste the URL into the reply/);
assert.match(promptSource, /Trainer: \$\{trainer\.full_name\}/);

console.log("Explicit gym-photo selection produces durable media actions.");
console.log("Trainer-photo selection produces the matching media action.");
console.log("Missing and cross-branch media remain safely unavailable.");
console.log("Normal text-only turns remain text-only.");
console.log("Validated media actions still persist through the existing image outbox path.");
