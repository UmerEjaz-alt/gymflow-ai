export type MediaSelectionAction = {
  assetId: string;
  caption: string | null;
};

export type MediaSelectionAsset = {
  id: string;
  branch_id: string;
};

export type TrainerMediaSelectionAsset = MediaSelectionAsset & {
  trainer_id: string | null;
};

type ResolveMediaSelectionInput = {
  explicitMediaRequest: boolean;
  effectiveBranchId: string | null;
  authoritativeAssetIds: ReadonlySet<string>;
  requestedActions: MediaSelectionAction[];
  allowedAssets: MediaSelectionAsset[];
  fallbackAssets: MediaSelectionAsset[];
  maxAssets?: number;
};

export type MediaSelectionReason =
  | "no_effective_branch"
  | "model_selection"
  | "not_explicit"
  | "explicit_authoritative_fallback"
  | "no_eligible_media";

type ResolveProactiveTrainerMediaInput = {
  turnIntent: string;
  explicitMediaRequest: boolean;
  resolvedTrainerId: string | null;
  activeTrainerCount: number;
  availableTrainerCards: TrainerMediaSelectionAsset[];
  previouslySentResolvedTrainerCards: TrainerMediaSelectionAsset[];
  maxAssets?: number;
};

/**
 * Selects trainer poster cards from the same authoritative media set used by
 * the normal media resolver. A semantic trainer turn represents a trainer
 * presentation even when the customer did not explicitly ask for a photo.
 *
 * Previously sent cards remain excluded from contextual presentations. The
 * sole exception is an explicit request for a resolved trainer's image, which
 * preserves the existing deliberate resend behavior.
 */
export function resolveProactiveTrainerMedia({
  turnIntent,
  explicitMediaRequest,
  resolvedTrainerId,
  activeTrainerCount,
  availableTrainerCards,
  previouslySentResolvedTrainerCards,
  maxAssets = 3,
}: ResolveProactiveTrainerMediaInput): TrainerMediaSelectionAsset[] {
  const isTrainerPresentation = turnIntent === "trainer";

  if (resolvedTrainerId && (isTrainerPresentation || explicitMediaRequest)) {
    const matchingCards = availableTrainerCards.filter(
      (asset) => asset.trainer_id === resolvedTrainerId,
    );
    if (matchingCards.length > 0) return matchingCards.slice(0, 1);
    if (explicitMediaRequest)
      return previouslySentResolvedTrainerCards
        .filter((asset) => asset.trainer_id === resolvedTrainerId)
        .slice(0, 1);
    return [];
  }

  if (
    isTrainerPresentation &&
    activeTrainerCount <= maxAssets &&
    availableTrainerCards.length > 0
  ) {
    return availableTrainerCards.slice(0, maxAssets);
  }

  return [];
}

/**
 * Resolves the delivery actions for the existing authoritative media path.
 *
 * The model remains the first-choice selector. For an explicit media request,
 * a missing structured action is repaired from the same already-scoped media
 * set so a textual promise cannot silently become a text-only delivery.
 */
export function resolveMediaSelection({
  explicitMediaRequest,
  effectiveBranchId,
  authoritativeAssetIds,
  requestedActions,
  allowedAssets,
  fallbackAssets,
  maxAssets = 3,
}: ResolveMediaSelectionInput): {
  actions: MediaSelectionAction[];
  mediaUnavailable: boolean;
  reason: MediaSelectionReason;
} {
  if (!effectiveBranchId) {
    return {
      actions: [],
      mediaUnavailable: explicitMediaRequest,
      reason: "no_effective_branch",
    };
  }

  const isAuthoritative = (asset: MediaSelectionAsset) =>
    asset.branch_id === effectiveBranchId && authoritativeAssetIds.has(asset.id);
  const allowed = allowedAssets.filter(isAuthoritative);
  const allowedIds = new Set(allowed.map((asset) => asset.id));
  const requested = requestedActions
    .filter((action) => allowedIds.has(action.assetId))
    .filter(
      (action, index, actions) =>
        actions.findIndex((candidate) => candidate.assetId === action.assetId) === index,
    )
    .slice(0, maxAssets);

  if (requested.length > 0 || !explicitMediaRequest) {
    return {
      actions: requested,
      mediaUnavailable: false,
      reason: requested.length > 0 ? "model_selection" : "not_explicit",
    };
  }

  const fallback = fallbackAssets
    .filter(isAuthoritative)
    .filter((asset) => allowedIds.has(asset.id))
    .filter(
      (asset, index, assets) =>
        assets.findIndex((candidate) => candidate.id === asset.id) === index,
    )
    .slice(0, maxAssets)
    .map((asset) => ({ assetId: asset.id, caption: null }));

  return {
    actions: fallback,
    mediaUnavailable: fallback.length === 0,
    reason:
      fallback.length > 0
        ? "explicit_authoritative_fallback"
        : "no_eligible_media",
  };
}
