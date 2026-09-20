/**
 * Channel-neutral conversation turn processor.
 *
 * Channel adapters normalize an inbound message, then call this service. It
 * persists the customer message, runs the established AI pipeline, and saves
 * the approved reply. Delivery remains the responsibility of the adapter.
 */

import type { IncomingMessageEvent } from "@/services/conversation-manager.server";
import { handleIncomingMessage } from "@/services/conversation-manager.server";
import { generateValidatedReply } from "@/services/ai-pipeline.server";
import { saveAIReply } from "@/services/conversation-reply.server";
import {
  createMessage,
  getMessageByWhatsAppMessageId,
} from "@/services/message.server";
import { executeAIBookingAction } from "@/services/ai-booking-executor.server";
import type { Message } from "@/types/message";
import type { MediaAsset } from "@/types/media-asset";
import type { Facility } from "@/types/facility";
import type { ResolvedTurnContext } from "@/services/knowledge-layer.server";
import type { MembershipPackage } from "@/types/membership-package";
import { elapsedMs, logPerformance } from "@/lib/performance-log.server";
import { resolveMediaSelection } from "@/services/media-selection";

export type ProcessConversationTurnResult = {
  customerMessage: Message | null;
  aiMessage: Message | null;
  /** Persisted outgoing messages for this turn, in delivery order. */
  outboundMessages?: Message[];
  /** Persisted authoritative endpoint used by the durable outbox trigger. */
  deliveryEndpointId?: string | null;
  action: string;
  error: string | null;
};

export async function processIncomingConversationTurn(
  event: IncomingMessageEvent,
): Promise<ProcessConversationTurnResult> {
  const totalStartedAt = performance.now();
  let idempotencyMs = 0;
  const usesTransactionalEndpointIngestion = Boolean(
    event.whatsappMessageId &&
    event.endpointId &&
    event.aiRateLimit &&
    (event.source ?? "whatsapp") === "whatsapp",
  );
  if (event.whatsappMessageId && !usesTransactionalEndpointIngestion) {
    const idempotencyStartedAt = performance.now();
    const existing = await getMessageByWhatsAppMessageId(event.whatsappMessageId);
    idempotencyMs = elapsedMs(idempotencyStartedAt);
    if (existing.error) {
      return {
        customerMessage: null,
        aiMessage: null,
        action: "error",
        error: `Webhook idempotency lookup failed: ${existing.error}`,
      };
    }
    if (existing.data) {
      return {
        customerMessage: existing.data,
        aiMessage: null,
        action: "duplicate",
        error: null,
      };
    }
  }

  const managerStartedAt = performance.now();
  const managerResult = await handleIncomingMessage(event);
  const managerMs = elapsedMs(managerStartedAt);
  if (managerResult.error || !managerResult.data) {
    return {
      customerMessage: null,
      aiMessage: null,
      action: "error",
      error: `Conversation manager failed: ${managerResult.error ?? "Unknown error."}`,
    };
  }

  const context = managerResult.data;
  if (context.duplicateInbound) {
    return {
      customerMessage: context.latestCustomerMessage,
      aiMessage: null,
      action: "duplicate",
      error: null,
    };
  }

  // Voice-note transcription/download failures are a channel concern, not a
  // customer message for the receptionist model. Persist a concise fallback
  // only for AI-active conversations; human takeover remains untouched.
  if (event.safeFallbackReplyText) {
    if (!context.shouldCallAI) {
      return {
        customerMessage: context.latestCustomerMessage,
        aiMessage: null,
        action: context.humanTakeover ? "human_takeover" : "no_reply",
        error: null,
      };
    }
    const fallbackResult = await createMessage({
      conversation_id: context.conversation.id,
      sender_type: "ai",
      message_type: "text",
      content: event.safeFallbackReplyText,
      metadata: {
        system_fallback: "voice_transcription_failed",
        ...(event.whatsappMessageId ? { outbound_delivery: "whatsapp_outbox" } : {}),
      },
    });
    if (fallbackResult.error) {
      return {
        customerMessage: context.latestCustomerMessage,
        aiMessage: null,
        action: "error",
        error: `Voice fallback persistence failed: ${fallbackResult.error}`,
      };
    }
    return {
      customerMessage: context.latestCustomerMessage,
      aiMessage: fallbackResult.data!,
      outboundMessages: [fallbackResult.data!],
      deliveryEndpointId: context.conversation.whatsapp_endpoint_id ?? null,
      action: "voice_transcription_failed",
      error: null,
    };
  }

  if (!context.shouldCallAI) {
    return {
      customerMessage: context.latestCustomerMessage,
      aiMessage: null,
      action: context.humanTakeover ? "human_takeover" : "no_reply",
      error: null,
    };
  }

  try {
    const pipelineStartedAt = performance.now();
    const pipelineResult = await generateValidatedReply(context);
    const pipelineMs = elapsedMs(pipelineStartedAt);
    if (
      pipelineResult.action !== "knowledge_ready" ||
      !pipelineResult.validatedResponse
    ) {
      return {
        customerMessage: context.latestCustomerMessage,
        aiMessage: null,
        action: pipelineResult.action,
        error: null,
      };
    }

    const initialTurn = pipelineResult.knowledge!.turn;
    const allowedBranchIds =
      pipelineResult.knowledge?.allBranches?.map((branch) => branch.id) ?? [];
    const validatedSelectedBranchId =
      pipelineResult.validatedResponse.selectedBranchId &&
      allowedBranchIds.includes(pipelineResult.validatedResponse.selectedBranchId) &&
      pipelineResult.validatedResponse.selectedBranchId ===
        initialTurn.effectiveBranchId
        ? pipelineResult.validatedResponse.selectedBranchId
        : null;
    const semanticJoiningBranchSelection =
      initialTurn.primaryBranchId === null &&
      initialTurn.effectiveBranchId !== null &&
      pipelineResult.validatedResponse.understanding.lead_signal === "high_intent";
    const resolvedTurn =
      validatedSelectedBranchId || semanticJoiningBranchSelection
        ? {
            ...initialTurn,
            isTemporaryBranch: false,
            persistPrimaryBranchId:
              validatedSelectedBranchId ?? initialTurn.effectiveBranchId,
          }
        : initialTurn;
    const resolvedBranchSelectionId = resolvedTurn.persistPrimaryBranchId ?? null;

    const availableMedia = uniqueMediaAssets([
      ...(pipelineResult.knowledge?.media ?? []),
      ...(pipelineResult.knowledge?.crossBranchKnowledge?.flatMap(
        (crossBranch) => crossBranch.media,
      ) ?? []),
      ...(pipelineResult.knowledge?.turn.pendingMedia
        ? [pipelineResult.knowledge.turn.pendingMedia]
        : []),
    ]);
    const mediaSafeResponse = buildMediaSafeResponse(
      pipelineResult.validatedResponse,
      context.latestMessages,
      availableMedia,
      pipelineResult.knowledge?.allBranches ?? [],
      resolvedTurn,
    );

    let finalResponse = mediaSafeResponse;

    let bookingActionMs = 0;
    if (pipelineResult.validatedResponse.bookingAction && pipelineResult.knowledge) {
      const bookingStartedAt = performance.now();
      const knowledge = pipelineResult.knowledge;
      const executionResult = await executeAIBookingAction({
        action: pipelineResult.validatedResponse.bookingAction,
        turn: resolvedTurn,
        conversation: context.conversation,
        gym: knowledge.gym!,
        branch: knowledge.branch,
        allBranches:
          knowledge.allBranches ?? (knowledge.branch ? [knowledge.branch] : []),
        trainers: [
          ...(knowledge.trainers ?? []),
          ...(knowledge.crossBranchKnowledge?.flatMap((cb) => cb.trainers) ?? []),
        ],
        customerMemory: context.conversation.customer_memory,
        sourceMessageId: context.latestCustomerMessage.id,
      });
      bookingActionMs = elapsedMs(bookingStartedAt);

      if (executionResult.executed && executionResult.responseText) {
        finalResponse = {
          ...finalResponse,
          text: executionResult.responseText,
          messageSequence: [
            { type: "text", text: executionResult.responseText },
            ...finalResponse.messageSequence.filter((item) => item.type === "image"),
          ],
        };

        if (executionResult.clearedPendingBooking) {
          finalResponse.understanding = {
            ...finalResponse.understanding,
            memory_updates: {
              ...finalResponse.understanding.memory_updates,
              pending_booking: null,
            },
          };
        }
      }
    }

    const persistedTurn = resolveTurnForPersistence(
      resolvedTurn,
      finalResponse.understanding.package_interest,
      [
        ...(pipelineResult.knowledge?.packages ?? []),
        ...(pipelineResult.knowledge?.crossBranchKnowledge?.flatMap(
          (crossBranch) => crossBranch.packages,
        ) ?? []),
      ],
    );

    const persistenceStartedAt = performance.now();
    const saveResult = await saveAIReply(
      context.conversation.id,
      finalResponse,
      pipelineResult.aiResponse?.model ?? "unknown",
      availableMedia,
      allowedBranchIds,
      resolvedBranchSelectionId,
      persistedTurn,
      Boolean(event.whatsappMessageId),
      Boolean(event.whatsappMessageId),
    );
    const persistenceMs = elapsedMs(persistenceStartedAt);

    if (!saveResult.saved) {
      return {
        customerMessage: context.latestCustomerMessage,
        aiMessage: null,
        action: pipelineResult.action,
        error: saveResult.error ?? "The AI reply was not saved.",
      };
    }

    const outboundMessages = saveResult.messages ?? [];
    const aiMessage = outboundMessages[0] ?? null;

    logPerformance("ai.conversation_turn", {
      source: event.source ?? "whatsapp",
      message_type: event.messageType,
      idempotency_ms: idempotencyMs,
      conversation_load_ms: managerMs,
      ai_pipeline_ms: pipelineMs,
      booking_action_ms: bookingActionMs,
      persistence_ms: persistenceMs,
      outbound_message_count: outboundMessages.length,
      outbound_message_types: outboundMessages
        .map((message) => message.message_type)
        .join(","),
      total_ms: elapsedMs(totalStartedAt),
    });

    return {
      customerMessage: context.latestCustomerMessage,
      aiMessage,
      outboundMessages,
      deliveryEndpointId: context.conversation.whatsapp_endpoint_id ?? null,
      action: pipelineResult.action,
      error: null,
    };
  } catch (error) {
    return {
      customerMessage: context.latestCustomerMessage,
      aiMessage: null,
      action: "error",
      error:
        error instanceof Error
          ? `AI pipeline error: ${error.message}`
          : "AI pipeline error.",
    };
  }
}

function buildMediaSafeResponse(
  response: NonNullable<
    Awaited<ReturnType<typeof generateValidatedReply>>["validatedResponse"]
  >,
  history: Message[],
  availableMedia: MediaAsset[],
  availableBranches: Array<{ id: string; branch_name: string }>,
  turn: ResolvedTurnContext,
) {
  const alreadySent = new Set(
    history
      .map((message) => message.metadata?.media_asset_id)
      .filter((id): id is string => typeof id === "string"),
  );
  const activePhotos = availableMedia.filter(
    (asset) => asset.active && asset.media_type === "photo",
  );
  const permittedPhotos = activePhotos.filter((asset) => !alreadySent.has(asset.id));
  const effectivePhotos = turn.effectiveBranchId
    ? permittedPhotos.filter(
        (asset) =>
          asset.branch_id === turn.effectiveBranchId &&
          turn.facts.media.some((fact) => fact.id === asset.id),
      )
    : [];
  const resolvedFacility =
    turn.entity?.type === "facility"
      ? (turn.facts.facilities.find((facility) => facility.id === turn.entity?.id) ??
        null)
      : null;
  const directFacilityAvailabilityQuestion =
    resolvedFacility !== null && turn.directFacilityAvailability;
  const explicitFacilityImageRequest =
    resolvedFacility !== null && turn.explicitMediaRequest;
  const matchingFacilityPhotos =
    resolvedFacility && resolvedFacility.available
      ? effectivePhotos.filter(
          (asset) =>
            asset.trainer_id === null &&
            asset.branch_id === resolvedFacility.branch_id &&
            mediaMatchesFacility(asset, resolvedFacility),
        )
      : [];
  const permitted =
    directFacilityAvailabilityQuestion || explicitFacilityImageRequest
      ? matchingFacilityPhotos
      : filterMediaForTurn(effectivePhotos, history, turn);
  const pendingOfferMedia = response.pendingMediaAssetId
    ? (effectivePhotos.find((asset) => asset.id === response.pendingMediaAssetId) ??
      null)
    : null;
  const pendingOfferCandidate =
    pendingOfferMedia && !alreadySent.has(pendingOfferMedia.id)
      ? pendingOfferMedia
      : null;
  const inheritedPendingCandidate =
    turn.pendingMedia &&
    turn.pendingMedia.active &&
    turn.pendingMedia.media_type === "photo" &&
    turn.pendingMedia.branch_id === turn.effectiveBranchId &&
    !alreadySent.has(turn.pendingMedia.id)
      ? turn.pendingMedia
      : null;
  const permittedWithPending = [
    ...permitted,
    ...(pendingOfferCandidate ? [pendingOfferCandidate] : []),
    ...(inheritedPendingCandidate ? [inheritedPendingCandidate] : []),
  ].filter(
    (asset, index, assets) =>
      assets.findIndex((item) => item.id === asset.id) === index,
  );
  const automaticFacilityMedia =
    matchingFacilityPhotos.length > 0
      ? [{ assetId: matchingFacilityPhotos[0]!.id, caption: null }]
      : [];
  const activeTrainers = turn.facts.trainers.filter((trainer) => trainer.active);
  const activeTrainerIds = new Set(activeTrainers.map((trainer) => trainer.id));
  const trainerCards = effectivePhotos.filter(
    (asset) => asset.trainer_id !== null && activeTrainerIds.has(asset.trainer_id),
  );
  const trainerAsked = turn.hasExplicitTrainerIntent;
  const resolvedTrainerIds = new Set(
    turn.entity?.type === "trainer" ? [turn.entity.id] : [],
  );
  const resolvedTrainerCards = trainerCards.filter(
    (asset) => asset.trainer_id && resolvedTrainerIds.has(asset.trainer_id),
  );
  const explicitFallbackMedia =
    turn.entity?.type === "trainer"
      ? resolvedTrainerCards.slice(0, 1)
      : turn.intent === "trainer"
        ? trainerCards
        : permitted;
  const authoritativeAssetIds = new Set([
    ...turn.facts.media.map((asset) => asset.id),
    ...(pendingOfferCandidate ? [pendingOfferCandidate.id] : []),
    ...(inheritedPendingCandidate ? [inheritedPendingCandidate.id] : []),
  ]);
  const explicitSelection = resolveMediaSelection({
    explicitMediaRequest: turn.explicitMediaRequest,
    effectiveBranchId: turn.effectiveBranchId,
    authoritativeAssetIds,
    requestedActions: [
      ...response.mediaActions,
      ...response.messageSequence.flatMap((item) =>
        item.type === "image"
          ? [{ assetId: item.assetId, caption: item.caption }]
          : [],
      ),
    ],
    allowedAssets: permittedWithPending,
    fallbackAssets: explicitFallbackMedia,
  });
  const requested = explicitSelection.actions;
  const explicitlyRequestsTrainerImage =
    resolvedTrainerIds.size > 0 && turn.explicitMediaRequest;
  const previouslySentResolvedTrainerCards = explicitlyRequestsTrainerImage
    ? activePhotos.filter(
        (asset) =>
          asset.trainer_id !== null &&
          asset.branch_id === turn.effectiveBranchId &&
          activeTrainerIds.has(asset.trainer_id) &&
          resolvedTrainerIds.has(asset.trainer_id) &&
          alreadySent.has(asset.id),
      )
    : [];
  const automaticTrainerCards =
    (turn.hasExplicitTrainerIntent || turn.explicitMediaRequest) &&
    resolvedTrainerCards.length > 0
      ? resolvedTrainerCards.slice(0, 1)
      : (turn.hasExplicitTrainerIntent || turn.explicitMediaRequest) &&
          previouslySentResolvedTrainerCards.length > 0
        ? previouslySentResolvedTrainerCards.slice(0, 1)
        : trainerAsked && activeTrainers.length <= 3 && trainerCards.length > 0
          ? trainerCards
          : [];
  const joiningPresentation = Boolean(
    turn.effectiveBranchId &&
    (turn.primaryBranchId === turn.effectiveBranchId ||
      turn.persistPrimaryBranchId === turn.effectiveBranchId ||
      turn.proactiveSalesFollowUp ||
      (turn.primaryBranchId === null &&
        response.understanding.lead_signal === "high_intent")),
  );
  const featuredBranchId = joiningPresentation ? turn.effectiveBranchId : null;
  const featuredBranch = availableBranches.find(
    (branch) => branch.id === featuredBranchId,
  );
  const featured =
    featuredBranchId && joiningPresentation
      ? permitted
          .filter(
            (asset) =>
              asset.branch_id === featuredBranchId &&
              asset.featured &&
              asset.trainer_id === null,
          )
          .slice(0, 2)
          .map((asset) => ({ assetId: asset.id, caption: null }))
      : [];
  const mediaActions = [
    ...requested,
    ...automaticFacilityMedia,
    ...automaticTrainerCards.map((asset) => ({ assetId: asset.id, caption: null })),
    ...featured.filter(
      (action) => !requested.some((item) => item.assetId === action.assetId),
    ),
  ]
    .filter(
      (action, index, actions) =>
        actions.findIndex((item) => item.assetId === action.assetId) === index,
    )
    .slice(0, 3);
  const mediaUnavailable =
    turn.explicitMediaRequest && mediaActions.length === 0;
  const responseText = mediaUnavailable
    ? "I don't have a matching photo available to send right now."
    : response.text;
  const messageSequence: typeof response.messageSequence =
    mediaUnavailable || response.messageSequence.length === 0
      ? [{ type: "text", text: responseText }]
      : [];
  if (!mediaUnavailable) {
    for (const item of response.messageSequence) {
      if (
        item.type === "text" ||
        permittedWithPending.some((asset) => asset.id === item.assetId)
      )
        messageSequence.push(item);
    }
  }

  if (joiningPresentation && featured.length > 0 && featuredBranch) {
    const featuredAssetIds = new Set(featured.map((action) => action.assetId));
    const featuredIndexes = messageSequence
      .map((item, index) =>
        item.type === "image" && featuredAssetIds.has(item.assetId) ? index : -1,
      )
      .filter((index) => index >= 0);
    const firstTextIndex = messageSequence.findIndex((item) => item.type === "text");
    const lastTextIndex = messageSequence.reduce(
      (lastIndex, item, index) => (item.type === "text" ? index : lastIndex),
      -1,
    );
    const hasCompleteOrderedPresentation =
      firstTextIndex === 0 &&
      featuredIndexes.length === featured.length &&
      featuredIndexes.every((index) => index > firstTextIndex && index < lastTextIndex);

    if (!hasCompleteOrderedPresentation) {
      const joiningDetails = buildGroundedJoiningDetails(
        featuredBranch.branch_name,
        turn,
      );
      logMediaResolution({
        response,
        turn,
        availableMedia,
        effectivePhotos,
        permittedWithPending,
        explicitFallbackMedia,
        explicitSelection,
        mediaActions,
        finalMessageTypes: ["text", ...featured.map(() => "image"), "text"],
      });
      return {
        ...response,
        mediaActions,
        pendingMedia: null,
        messageSequence: [
          {
            type: "text" as const,
            text: `Great — here's a quick look at ${featuredBranch.branch_name} 👇`,
          },
          ...featured.map((action) => ({
            type: "image" as const,
            assetId: action.assetId,
            caption: action.caption,
          })),
          { type: "text" as const, text: joiningDetails ?? response.text },
        ],
      };
    }
  }

  // Insert automatic/validated media immediately after the first persisted text,
  // preserving text → image(s) → later text when Groq provided a sequence.
  const missingMedia = [] as Array<{
    type: "image";
    assetId: string;
    caption: string | null;
  }>;
  for (const action of mediaActions) {
    if (
      !messageSequence.some(
        (item) => item.type === "image" && item.assetId === action.assetId,
      )
    ) {
      missingMedia.push({
        type: "image",
        assetId: action.assetId,
        caption: action.caption,
      });
    }
  }
  const firstTextIndex = messageSequence.findIndex((item) => item.type === "text");
  messageSequence.splice(
    firstTextIndex < 0 ? 0 : firstTextIndex + 1,
    0,
    ...missingMedia,
  );
  const sentAssetIds = new Set(
    messageSequence.flatMap((item) => (item.type === "image" ? [item.assetId] : [])),
  );
  const validatedPendingMedia =
    pendingOfferCandidate &&
    !sentAssetIds.has(pendingOfferCandidate.id) &&
    isPendingMediaEligible(pendingOfferCandidate, activeTrainerIds)
      ? toPendingMediaReference(pendingOfferCandidate)
      : null;
  logMediaResolution({
    response,
    turn,
    availableMedia,
    effectivePhotos,
    permittedWithPending,
    explicitFallbackMedia,
    explicitSelection,
    mediaActions,
    finalMessageTypes: messageSequence.map((item) => item.type),
  });
  return {
    ...response,
    text: responseText,
    mediaActions,
    messageSequence,
    pendingMedia: validatedPendingMedia,
  };
}

function logMediaResolution(input: {
  response: NonNullable<
    Awaited<ReturnType<typeof generateValidatedReply>>["validatedResponse"]
  >;
  turn: ResolvedTurnContext;
  availableMedia: MediaAsset[];
  effectivePhotos: MediaAsset[];
  permittedWithPending: MediaAsset[];
  explicitFallbackMedia: MediaAsset[];
  explicitSelection: ReturnType<typeof resolveMediaSelection>;
  mediaActions: Array<{ assetId: string; caption: string | null }>;
  finalMessageTypes: string[];
}): void {
  const describe = (assets: MediaAsset[]) =>
    assets
      .slice(0, 10)
      .map(
        (asset) =>
          `${asset.id}:${asset.branch_id}:${asset.media_type}:${asset.category}:${asset.trainer_id ?? "gallery"}:${asset.active ? "active" : "inactive"}:${asset.featured ? "featured" : "standard"}`,
      )
      .join(",");
  const modelSequenceImageIds = input.response.messageSequence.flatMap((item) =>
    item.type === "image" ? [item.assetId] : [],
  );

  logPerformance("ai.media_resolution", {
    explicit_media_request: input.turn.explicitMediaRequest,
    media_request: input.turn.mediaRequest,
    intent: input.turn.intent,
    entity_type: input.turn.entity?.type ?? null,
    effective_branch_id: input.turn.effectiveBranchId,
    ai_media_action_count: input.response.mediaActions.length,
    ai_media_action_ids: input.response.mediaActions
      .map((action) => action.assetId)
      .join(","),
    ai_sequence_image_count: modelSequenceImageIds.length,
    ai_sequence_image_ids: modelSequenceImageIds.join(","),
    available_media_count: input.availableMedia.length,
    available_media: describe(input.availableMedia),
    effective_photo_count: input.effectivePhotos.length,
    effective_photos: describe(input.effectivePhotos),
    candidate_media_count: input.permittedWithPending.length,
    candidate_media: describe(input.permittedWithPending),
    fallback_media_count: input.explicitFallbackMedia.length,
    fallback_media: describe(input.explicitFallbackMedia),
    resolver_reason: input.explicitSelection.reason,
    resolver_action_count: input.explicitSelection.actions.length,
    final_media_action_count: input.mediaActions.length,
    final_media_action_ids: input.mediaActions
      .map((action) => action.assetId)
      .join(","),
    final_message_types: input.finalMessageTypes.join(","),
  });
}

function buildGroundedJoiningDetails(
  branchName: string,
  turn: ResolvedTurnContext,
): string | null {
  const packages = turn.facts.packages.slice(0, 3);
  if (packages.length === 0) return null;

  const packageDetails = packages.map((pkg) => {
    const activeOfferPrice = turn.facts.offers
      .flatMap((offer) => offer.package_prices)
      .find(
        (price) =>
          price.package_id === pkg.id && price.final_price < price.regular_price,
      );
    const duration = `${pkg.duration_months} month${pkg.duration_months === 1 ? "" : "s"}`;
    if (activeOfferPrice) {
      return `${pkg.package_name}: normally ${pkg.currency} ${activeOfferPrice.regular_price.toLocaleString("en-US")} / ${duration}, currently ${pkg.currency} ${activeOfferPrice.final_price.toLocaleString("en-US")} with the active offer`;
    }
    return `${pkg.package_name}: ${pkg.currency} ${pkg.price.toLocaleString("en-US")} / ${duration}`;
  });

  const nonPriceOffer = turn.facts.offers.find(
    (offer) => offer.package_prices.length === 0,
  );
  const offerSuffix = nonPriceOffer ? ` Current offer: ${nonPriceOffer.name}.` : "";
  return `Membership options at ${branchName}: ${packageDetails.join("; ")}.${offerSuffix}`;
}

function uniqueMediaAssets(assets: MediaAsset[]): MediaAsset[] {
  return assets.filter(
    (asset, index) =>
      assets.findIndex((candidate) => candidate.id === asset.id) === index,
  );
}

function resolveTurnForPersistence(
  turn: ResolvedTurnContext,
  packageInterest: string | null,
  packages: MembershipPackage[],
): ResolvedTurnContext {
  if (turn.entity || !packageInterest) return turn;
  const normalizedInterest = packageInterest.trim().toLocaleLowerCase();
  const matches = packages.filter(
    (pkg) =>
      pkg.branch_id === turn.effectiveBranchId &&
      pkg.package_name.trim().toLocaleLowerCase() === normalizedInterest,
  );
  return matches.length === 1
    ? {
        ...turn,
        entity: {
          type: "package",
          id: matches[0]!.id,
          name: matches[0]!.package_name,
        },
      }
    : turn;
}

function isPendingMediaEligible(
  asset: MediaAsset,
  activeTrainerIds: Set<string>,
): boolean {
  return (
    asset.active &&
    asset.media_type === "photo" &&
    (asset.trainer_id === null || activeTrainerIds.has(asset.trainer_id))
  );
}

function toPendingMediaReference(asset: MediaAsset) {
  return {
    asset_id: asset.id,
    branch_id: asset.branch_id,
    media_type: asset.media_type,
    context_type: asset.trainer_id
      ? ("trainer_card" as const)
      : asset.category === "facility"
        ? ("facility" as const)
        : asset.category === "gym" || asset.category === "general_gym"
          ? ("gallery" as const)
          : ("other" as const),
    related_entity_id: asset.trainer_id,
    label: asset.title,
  };
}

function filterMediaForTurn(
  assets: MediaAsset[],
  history: Message[],
  turn: ResolvedTurnContext,
): MediaAsset[] {
  const previousMediaId = [...history]
    .reverse()
    .map((item) => item.metadata?.media_asset_id)
    .find((id): id is string => typeof id === "string");
  const previousWasTrainer =
    turn.facts.media.find((asset) => asset.id === previousMediaId)?.trainer_id != null;

  if (
    turn.intent === "trainer" ||
    (turn.mediaRequest === "more" && previousWasTrainer)
  ) {
    return assets.filter((asset) => asset.trainer_id !== null);
  }

  if (
    turn.intent === "facility" &&
    turn.entity === null &&
    !turn.explicitMediaRequest
  ) {
    return [];
  }

  // Gallery and facility requests can never select trainer cards.
  const gallery = assets.filter((asset) => asset.trainer_id === null);
  return turn.mediaCategory
    ? gallery.filter((asset) => asset.category === turn.mediaCategory)
    : gallery;
}

function mediaMatchesFacility(asset: MediaAsset, facility: Facility): boolean {
  const facilityName = normalizeFacilityText(facility.name);
  const mediaText = normalizeFacilityText(
    [asset.title, asset.description, asset.category].filter(Boolean).join(" "),
  );
  if (mediaText.includes(facilityName)) return true;

  const distinctiveTokens = facilityName
    .split(" ")
    .filter((token) => token.length >= 3);
  return (
    distinctiveTokens.length > 0 &&
    distinctiveTokens.every((token) => mediaText.includes(token))
  );
}

function normalizeFacilityText(value: string): string {
  return value
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}
