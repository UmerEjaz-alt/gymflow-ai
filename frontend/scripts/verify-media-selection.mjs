import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  resolveMediaSelection,
  resolveProactiveTrainerMedia,
} from "../src/services/media-selection.ts";

const branchA = "branch-a";
const branchB = "branch-b";
const gymPhoto = { id: "gym-photo-a", branch_id: branchA };
const secondGymPhoto = { id: "gym-photo-a-2", branch_id: branchA };
const trainerPhoto = { id: "trainer-photo-a", branch_id: branchA };
const otherBranchPhoto = { id: "gym-photo-b", branch_id: branchB };
const jaimeCard = {
  id: "trainer-jaime-card",
  branch_id: branchA,
  trainer_id: "trainer-jaime",
};
const saraCard = {
  id: "trainer-sara-card",
  branch_id: branchA,
  trainer_id: "trainer-sara",
};

// A semantic trainer presentation is sufficient for proactive sales media;
// it must not depend on an explicit request for a photo.
const singleTrainerPresentation = resolveProactiveTrainerMedia({
  turnIntent: "trainer",
  explicitMediaRequest: false,
  resolvedTrainerId: "trainer-jaime",
  activeTrainerCount: 1,
  availableTrainerCards: [jaimeCard],
  previouslySentResolvedTrainerCards: [],
});
assert.deepEqual(singleTrainerPresentation.map((asset) => asset.id), [jaimeCard.id]);

const multipleTrainerPresentation = resolveProactiveTrainerMedia({
  turnIntent: "trainer",
  explicitMediaRequest: false,
  resolvedTrainerId: null,
  activeTrainerCount: 2,
  availableTrainerCards: [jaimeCard, saraCard],
  previouslySentResolvedTrainerCards: [],
});
assert.deepEqual(
  multipleTrainerPresentation.map((asset) => asset.id),
  [jaimeCard.id, saraCard.id],
);

// Contextual presentations do not repeat cards already excluded by history.
const repeatedContextualCard = resolveProactiveTrainerMedia({
  turnIntent: "trainer",
  explicitMediaRequest: false,
  resolvedTrainerId: "trainer-jaime",
  activeTrainerCount: 1,
  availableTrainerCards: [],
  previouslySentResolvedTrainerCards: [jaimeCard],
});
assert.deepEqual(repeatedContextualCard, []);

const trainerWithoutPoster = resolveProactiveTrainerMedia({
  turnIntent: "trainer",
  explicitMediaRequest: false,
  resolvedTrainerId: "trainer-jaime",
  activeTrainerCount: 1,
  availableTrainerCards: [],
  previouslySentResolvedTrainerCards: [],
});
assert.deepEqual(trainerWithoutPoster, []);

// An explicit trainer-photo request retains the existing deliberate resend.
const explicitTrainerResend = resolveProactiveTrainerMedia({
  turnIntent: "trainer",
  explicitMediaRequest: true,
  resolvedTrainerId: "trainer-jaime",
  activeTrainerCount: 1,
  availableTrainerCards: [],
  previouslySentResolvedTrainerCards: [jaimeCard],
});
assert.deepEqual(explicitTrainerResend.map((asset) => asset.id), [jaimeCard.id]);

// Non-trainer turns never receive an unrelated trainer poster.
const pricingConversation = resolveProactiveTrainerMedia({
  turnIntent: "pricing",
  explicitMediaRequest: false,
  resolvedTrainerId: null,
  activeTrainerCount: 2,
  availableTrainerCards: [jaimeCard, saraCard],
  previouslySentResolvedTrainerCards: [],
});
assert.deepEqual(pricingConversation, []);

// Mirrors the production G-14 shape: the featured gym photo was already sent,
// one non-trainer photo remains eligible, and a trainer card must stay outside
// a general gym gallery request.
const productionShapedMedia = [
  {
    id: "featured-strength-photo",
    branch_id: branchA,
    media_type: "photo",
    category: "strength_area",
    active: true,
    featured: true,
    trainer_id: null,
  },
  {
    id: "sauna-photo",
    branch_id: branchA,
    media_type: "photo",
    category: "sauna",
    active: true,
    featured: false,
    trainer_id: null,
  },
  {
    id: "trainer-card",
    branch_id: branchA,
    media_type: "photo",
    category: "trainer",
    active: true,
    featured: false,
    trainer_id: "trainer-a",
  },
];
const alreadySent = new Set(["featured-strength-photo"]);
const effectivePhotos = productionShapedMedia.filter(
  (asset) =>
    asset.active &&
    asset.media_type === "photo" &&
    asset.branch_id === branchA &&
    !alreadySent.has(asset.id),
);
const productionGallery = effectivePhotos.filter((asset) => asset.trainer_id === null);
const productionShapeSelection = resolveMediaSelection({
  explicitMediaRequest: true,
  effectiveBranchId: branchA,
  authoritativeAssetIds: new Set(productionShapedMedia.map((asset) => asset.id)),
  requestedActions: [],
  allowedAssets: productionGallery,
  fallbackAssets: productionGallery,
});
assert.deepEqual(productionShapeSelection.actions, [
  { assetId: "sauna-photo", caption: null },
]);
assert.equal(
  productionShapeSelection.reason,
  "explicit_authoritative_fallback",
);

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
assert.equal(gymSelection.reason, "explicit_authoritative_fallback");

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
assert.equal(unavailableSelection.reason, "no_eligible_media");

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
assert.deepEqual(normalTextSelection, {
  actions: [],
  mediaUnavailable: false,
  reason: "not_explicit",
});

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
assert.match(turnSource, /resolveProactiveTrainerMedia\(\{/);
assert.match(
  turnSource,
  /asset\.branch_id === turn\.effectiveBranchId[\s\S]*turn\.facts\.media\.some/,
);
assert.match(turnSource, /!alreadySent\.has\(asset\.id\)/);
assert.match(turnSource, /turn\.entity\?\.type === "trainer"[\s\S]*resolvedTrainerCards\.slice\(0, 1\)/);
assert.match(turnSource, /turn\.explicitMediaRequest && mediaActions\.length === 0/);
assert.match(turnSource, /logPerformance\("ai\.media_resolution"/);
assert.match(turnSource, /outbound_message_types:/);
assert.match(turnSource, /text: responseText,[\s\S]*mediaActions,[\s\S]*messageSequence/);
assert.match(replySource, /message_type: isText \? "text" : "image"/);
assert.match(replySource, /media_asset_id: asset!\.id/);
assert.match(promptSource, /media_actions is REQUIRED for that turn/);
assert.match(
  promptSource,
  /Never say or imply that a photo is being sent unless its asset ID is in media_actions/,
);
assert.match(promptSource, /never paste the URL into the reply/);
assert.match(promptSource, /Trainer: \$\{trainer\.full_name\}/);

console.log("Explicit gym-photo selection produces durable media actions.");
console.log("Trainer-photo selection produces the matching media action.");
console.log("Semantic trainer presentations proactively select relevant poster cards.");
console.log("Trainer poster history prevents contextual repeat spam.");
console.log("Missing and cross-branch media remain safely unavailable.");
console.log("Normal text-only turns remain text-only.");
console.log("Validated media actions still persist through the existing image outbox path.");
