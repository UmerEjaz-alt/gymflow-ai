import assert from "node:assert/strict";
import {
  classifyCurrentTurnIntent,
  resolveCurrentTurnState,
  resolveNamedEntity,
} from "../src/services/authoritative-turn-state.ts";
import {
  resolveMediaSelection,
  resolveProactiveTrainerMedia,
} from "../src/services/media-selection.ts";

const branchId = "branch-a";
const mediaFirstIntent = classifyCurrentTurnIntent({
  joiningSalesCue: false,
  needs: {
    all: false,
    packages: true,
    trainers: false,
    facilities: false,
    media: true,
    policies: false,
    openingHours: false,
    offers: true,
  },
  previousIntent: "pricing",
});
assert.equal(mediaFirstIntent, "media");
const packageEntity = {
  type: "package",
  id: "package-premium",
  name: "premium package",
};
const trainerEntity = {
  type: "trainer",
  id: "trainer-jaime",
  name: "Jaime",
};
const trainer = { id: trainerEntity.id, full_name: trainerEntity.name };

// A normal trainer enquiry semantically becomes a trainer turn without any
// requirement that the customer explicitly ask for an image.
const trainerEnquiryIntent = classifyCurrentTurnIntent({
  joiningSalesCue: false,
  needs: {
    all: false,
    packages: false,
    trainers: true,
    facilities: false,
    media: false,
    policies: false,
    openingHours: false,
    offers: false,
  },
  previousIntent: "pricing",
});
assert.equal(trainerEnquiryIntent, "trainer");
const trainerEnquiryTurn = resolveCurrentTurnState({
    provisionalIntent: trainerEnquiryIntent,
    needsAll: false,
    mediaRequest: "none",
    entityResolution: { entity: trainerEntity, source: "current" },
  });
assert.deepEqual(
  trainerEnquiryTurn,
  { intent: "trainer", entity: trainerEntity },
);
assert.deepEqual(
  resolveProactiveTrainerMedia({
    turnIntent: trainerEnquiryTurn.intent,
    explicitMediaRequest: false,
    resolvedTrainerId: trainerEnquiryTurn.entity?.id ?? null,
    activeTrainerCount: 1,
    availableTrainerCards: [
      {
        id: "trainer-jaime-card",
        branch_id: branchId,
        trainer_id: trainerEntity.id,
      },
    ],
    previouslySentResolvedTrainerCards: [],
  }).map((asset) => asset.id),
  ["trainer-jaime-card"],
);

// Real failure shape: current trainer name is misspelled after pricing state.
const matchedTrainer = resolveNamedEntity(
  "No I wwanna see Jamie",
  [trainer],
  (candidate) => candidate.full_name,
);
assert.equal(matchedTrainer?.id, trainer.id);
const trainerCorrection = resolveCurrentTurnState({
  provisionalIntent: "pricing",
  needsAll: true,
  mediaRequest: "entity",
  entityResolution: {
    entity: trainerEntity,
    source: "current",
  },
});
assert.deepEqual(trainerCorrection, {
  intent: "trainer",
  entity: trainerEntity,
});

const trainerMedia = { id: "trainer-photo", branch_id: branchId };
const survivingTrainerAction = resolveMediaSelection({
  explicitMediaRequest: false,
  effectiveBranchId: branchId,
  authoritativeAssetIds: new Set([trainerMedia.id]),
  requestedActions: [{ assetId: trainerMedia.id, caption: null }],
  allowedAssets: [trainerMedia],
  fallbackAssets: [trainerMedia],
});
assert.deepEqual(survivingTrainerAction.actions, [
  { assetId: trainerMedia.id, caption: null },
]);
assert.equal(survivingTrainerAction.reason, "model_selection");

// A new general gallery request must not be relabelled as the prior package.
const gymGalleryTurn = resolveCurrentTurnState({
  provisionalIntent: "media",
  needsAll: false,
  mediaRequest: "gallery",
  entityResolution: {
    entity: packageEntity,
    source: "continuity",
  },
});
assert.deepEqual(gymGalleryTurn, { intent: "media", entity: null });

const gymPhoto = { id: "gym-photo", branch_id: branchId };
const gymMediaSelection = resolveMediaSelection({
  explicitMediaRequest: true,
  effectiveBranchId: branchId,
  authoritativeAssetIds: new Set([gymPhoto.id]),
  requestedActions: [],
  allowedAssets: [gymPhoto],
  fallbackAssets: [gymPhoto],
});
assert.equal(gymMediaSelection.actions.length, 1);

// Genuine package and trainer follow-ups retain useful continuity.
assert.deepEqual(
  resolveCurrentTurnState({
    provisionalIntent: "pricing",
    needsAll: false,
    mediaRequest: "none",
    entityResolution: { entity: packageEntity, source: "continuity" },
  }),
  { intent: "pricing", entity: packageEntity },
);
assert.deepEqual(
  resolveCurrentTurnState({
    provisionalIntent: "trainer",
    needsAll: true,
    mediaRequest: "none",
    entityResolution: { entity: trainerEntity, source: "continuity" },
  }),
  { intent: "trainer", entity: trainerEntity },
);

console.log("Current misspelled trainer entity overrides stale package state.");
console.log("Normal trainer enquiries override stale pricing intent semantically.");
console.log("General gallery requests discard incompatible package continuity.");
console.log("Valid trainer and gym media actions survive authoritative validation.");
console.log("Contextual pricing and trainer follow-ups retain useful state.");
