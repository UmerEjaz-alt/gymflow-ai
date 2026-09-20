/**
 * Knowledge Layer
 *
 * Assembles structured data from the service layer into a KnowledgeContext
 * for one conversation turn. Branch-aware: when a branch is known it fetches
 * only that branch's data. When no branch is known it fetches the gym record
 * and, if there is only one branch, uses that branch automatically.
 *
 * No AI. No prompt generation. No LLM formatting.
 * Returns plain typed data; callers decide how to use it.
 */

import type { Gym } from "@/types/gym";
import type { Branch } from "@/types/branch";
import type { MembershipPackage } from "@/types/membership-package";
import type { Trainer } from "@/types/trainer";
import type { Facility } from "@/types/facility";
import type { MediaAsset, PendingMediaReference } from "@/types/media-asset";
import type { GroundedOffer } from "@/types/offer";
import type { ConversationContext } from "@/services/conversation-manager.server";
import type { Message } from "@/types/message";
import { getGymById } from "@/services/gym.server";
import { getBranches } from "@/services/branch.server";
import { getMembershipPackages } from "@/services/membership-package.server";
import { getTrainers } from "@/services/trainer.server";
import { getFacilities } from "@/services/facility.server";
import { getMediaAssets } from "@/services/media-asset.server";
import { getActiveOffers } from "@/services/offer.server";
import { hasJoiningSalesCue } from "@/lib/joining-intent-cues";
import { elapsedMs, logPerformance } from "@/lib/performance-log.server";
import {
  classifyCurrentTurnIntent,
  normalizeEntityText,
  resolveCurrentTurnState,
  resolveNamedEntity,
  type EntityResolution,
} from "@/services/authoritative-turn-state";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type CrossBranchKnowledge = {
  branch: Branch;
  packages: MembershipPackage[];
  facilities: Facility[];
  trainers: Trainer[];
  media: MediaAsset[];
  offers: GroundedOffer[];
};

/**
 * Resource categories that were confidently relevant to this customer turn.
 * `all` is the conservative fallback: ambiguity must never hide knowledge.
 */
export type KnowledgeNeeds = {
  all: boolean;
  packages: boolean;
  trainers: boolean;
  facilities: boolean;
  media: boolean;
  policies: boolean;
  openingHours: boolean;
  offers: boolean;
};

export type ResolvedEntityType = "facility" | "trainer" | "package";

export type ResolvedTurnEntity = {
  type: ResolvedEntityType;
  id: string;
  name: string;
} | null;

/**
 * The sole authoritative interpretation of a customer turn. Downstream
 * prompt, media, and persistence code consume this object rather than
 * independently re-reading the customer message.
 */
export type ResolvedTurnContext = {
  gymId: string;
  primaryBranchId: string | null;
  effectiveBranchId: string | null;
  isTemporaryBranch: boolean;
  persistPrimaryBranchId: string | null;
  proactiveSalesFollowUp: boolean;
  intent:
    | "joining"
    | "pricing"
    | "trainer"
    | "facility"
    | "media"
    | "policy"
    | "hours"
    | "general";
  hasExplicitTrainerIntent: boolean;
  entity: ResolvedTurnEntity;
  previous: {
    effectiveBranchId: string | null;
    isTemporaryBranch: boolean;
    entity: ResolvedTurnEntity;
    intent: ResolvedTurnContext["intent"] | null;
  } | null;
  directFacilityAvailability: boolean;
  explicitMediaRequest: boolean;
  mediaRequest: "none" | "gallery" | "entity" | "more";
  mediaCategory: string | null;
  pendingMedia: MediaAsset | null;
  facts: {
    packages: MembershipPackage[];
    trainers: Trainer[];
    facilities: Facility[];
    media: MediaAsset[];
    offers: GroundedOffer[];
  };
};

export type KnowledgeContext = {
  /** The gym profile (business-level: name, logo, email). Always present. */
  gym: Gym | null;
  /**
   * The resolved branch for this conversation turn, or null when the branch
   * could not be determined. The prompt builder uses this for branch-specific
   * contact details, hours, policies and FAQs.
   */
  branch: Branch | null;
  /**
   * Whether the gym has multiple branches. Used by the prompt builder to
   * instruct the AI to ask which branch when pricing differs.
   */
  isMultiBranch: boolean;
  /**
   * All branches for the gym — populated when isMultiBranch is true so the
   * AI can answer cross-branch questions ("which branch is cheapest?").
   * Null for single-branch gyms to avoid unnecessary data loading.
   */
  allBranches: Branch[] | null;
  /** Active membership packages for the resolved branch. Null when not needed. */
  packages: MembershipPackage[] | null;
  /** Active trainers for the resolved branch. Null when not needed. */
  trainers: Trainer[] | null;
  /** Active facilities for the resolved branch. Null when not needed. */
  facilities: Facility[] | null;
  /** Active media assets for the resolved branch. Null when not needed. */
  media: MediaAsset[] | null;
  /** Single source of truth for resolved branch/entity/intent state this turn. */
  turn: ResolvedTurnContext;
  /** Active, server-calculated offers eligible for this turn's primary branch. */
  offers: GroundedOffer[] | null;
  /**
   * Targeted cross-branch details loaded when a customer asks about other branches
   * (e.g. "What packages does DHA have?" while primary branch is G-14).
   */
  crossBranchKnowledge?: CrossBranchKnowledge[] | null;
  /** The conservative relevance decision used to construct this context. */
  needs: KnowledgeNeeds;
  /** Human-readable load summary for logging. */
  summary: string;
};

type KnowledgeResult =
  { data: KnowledgeContext; error: null } | { data: null; error: string };

// ---------------------------------------------------------------------------
// Internal: fetch strategy per message type
// ---------------------------------------------------------------------------

type FetchStrategy = {
  needsGym: boolean;
  needsPackages: boolean;
  needsTrainers: boolean;
  needsFacilities: boolean;
  needsMedia: boolean;
};

const STRATEGY: Record<
  ConversationContext["latestCustomerMessage"]["message_type"],
  FetchStrategy
> = {
  text: {
    needsGym: true,
    needsPackages: true,
    needsTrainers: true,
    needsFacilities: true,
    needsMedia: true,
  },
  interactive: {
    needsGym: true,
    needsPackages: true,
    needsTrainers: true,
    needsFacilities: true,
    needsMedia: true,
  },
  image: {
    needsGym: true,
    needsPackages: false,
    needsTrainers: false,
    needsFacilities: false,
    needsMedia: false,
  },
  audio: {
    needsGym: true,
    needsPackages: false,
    needsTrainers: false,
    needsFacilities: false,
    needsMedia: false,
  },
  video: {
    needsGym: true,
    needsPackages: false,
    needsTrainers: false,
    needsFacilities: false,
    needsMedia: false,
  },
  document: {
    needsGym: true,
    needsPackages: false,
    needsTrainers: false,
    needsFacilities: false,
    needsMedia: false,
  },
  location: {
    needsGym: true,
    needsPackages: false,
    needsTrainers: false,
    needsFacilities: false,
    needsMedia: false,
  },
  system: {
    needsGym: true,
    needsPackages: false,
    needsTrainers: false,
    needsFacilities: false,
    needsMedia: false,
  },
};

const ALL_KNOWLEDGE_NEEDS: KnowledgeNeeds = {
  all: true,
  packages: true,
  trainers: true,
  facilities: true,
  media: true,
  policies: true,
  openingHours: true,
  // Offers are intentionally not part of the generic fallback: promotion
  // modes must not turn a greeting or an unrelated query into coupon spam.
  offers: false,
};

const OFFER_REQUEST_PATTERN =
  /\b(discounts?|offers?|promotions?|deals?|concession|special price|last price|rate\s*kam|price\s*kam|kuch\s*kam|kam\s*karo|kam\s*kar\s*do|discount\s*(hai|mil)|offer\s*(hai|mil))\b/i;
const SALES_PATTERN =
  /\b(fee|fees|price|pricing|rate|charges?|package|packages|membership|plan|monthly|join|joining|registration|enroll|budget|kitna|kitne)\b/i;
const MONEY_OR_PERCENT_PATTERN =
  /(?:[€£$]\s*\d|\b(?:pkr|rs\.?|rupees?|euros?|dollars?|pounds?)\b\s*\d|\b\d+(?:\.\d+)?\s*(?:%|percent|pkr|rs\.?|rupees?|euros?|dollars?|pounds?))\b/i;
const RECENT_OFFER_MENTION_PATTERN =
  /\b(discounts?|offers?|promotions?|deals?|concession|special price|final price|admission fee waived)\b/i;

type OfferTurnRelevance = {
  explicitlyAsked: boolean;
  salesRelevant: boolean;
  contextualFollowUp: boolean;
};

type OfferFilterOptions = {
  /** A branch selection immediately following a sales-intent customer turn. */
  proactiveSalesFollowUp?: boolean;
};

/**
 * Recognises a reply that points back to an offer named in the recent AI reply,
 * without treating ordinary conversational pronouns as offer questions.
 */
function getOfferTurnRelevance(
  messageContent: string,
  recentMessages: Message[] = [],
): OfferTurnRelevance {
  const text = messageContent.toLowerCase();
  const explicitlyAsked = OFFER_REQUEST_PATTERN.test(text);
  const salesRelevant = SALES_PATTERN.test(text);
  const recentAiMentionedOffer = recentMessages
    .slice(-6)
    .some(
      (message) =>
        message.sender_type === "ai" &&
        RECENT_OFFER_MENTION_PATTERN.test(message.content),
    );

  // Examples: "u js said it's €81" and "wo 10 percent wala". A price or
  // percentage reference plus a recent AI offer mention is specific enough to
  // re-check live offers, while an unrelated "you said 5 pm" is not.
  const refersToPriorPrice =
    MONEY_OR_PERCENT_PATTERN.test(text) &&
    (/\b(?:you|u)\s*(?:just|js)?\s*(?:said|say|told)\b/i.test(text) ||
      /\b(?:wo|woh|jo)\b.*\b(?:wala|wali|walay)\b/i.test(text));

  return {
    explicitlyAsked,
    salesRelevant,
    contextualFollowUp: recentAiMentionedOffer && refersToPriorPrice,
  };
}

/**
 * Narrows retrieval only when the latest message makes its subject explicit.
 * It is deliberately not an intent system: unclear, conversational, and
 * mixed-topic messages retain the full knowledge set.
 */
export function inferKnowledgeNeeds(
  messageContent: string,
  recentMessages: Message[] = [],
  offerRelevance = getOfferTurnRelevance(messageContent, recentMessages),
): KnowledgeNeeds {
  const text = messageContent.toLowerCase();
  const joiningSalesIntent = hasJoiningSalesCue(messageContent);
  const packages =
    /\b(fee|fees|price|pricing|rate|charges?|package|packages|membership|plan|monthly|join|joining|registration|enroll|kitna|kitne)\b/.test(
      text,
    );
  const trainers = /\b(trainer|trainers|coach|coaches|personal training|\bpt\b)\b/.test(
    text,
  );
  const facilities =
    /\b(facility|facilities|parking|sauna|steam|shower|locker|lockers|cardio|treadmill|equipment|air ?conditioning|ac)\b/.test(
      text,
    );
  const media =
    /\b(photo|photos|picture|pictures|pic|pics|picutes|image|images|video|videos|brochure|gallery|dekha|dekhna|dikha)\b/.test(
      text,
    );
  const policies =
    /\b(trials?|visits?|tours?|day pass|polic(?:y|ies)|refund|freeze|cancel(?:lation)?|guest|transfer|discount|concession|special price|last price)\b/.test(
      text,
    );
  const openingHours = /\b(timing|timings|hours|open|close|closing|kab|time)\b/.test(
    text,
  );

  const offers =
    offerRelevance.explicitlyAsked ||
    offerRelevance.salesRelevant ||
    offerRelevance.contextualFollowUp;

  if (!packages && !trainers && !facilities && !media && !policies && !openingHours) {
    return ALL_KNOWLEDGE_NEEDS;
  }

  return {
    all: false,
    packages: packages || offers || joiningSalesIntent,
    trainers,
    facilities,
    // Trainer cards live in media_assets. Load them alongside trainer records so
    // the existing channel-neutral media path can deterministically deliver
    // eligible cards without relying on the model to request them.
    media: media || trainers || joiningSalesIntent,
    policies,
    openingHours,
    offers,
  };
}

function filterOffersForTurn(
  offers: GroundedOffer[],
  relevance: OfferTurnRelevance,
  { proactiveSalesFollowUp = false }: OfferFilterOptions = {},
): GroundedOffer[] {
  const { explicitlyAsked, salesRelevant, contextualFollowUp } = relevance;
  const offerRelevant = explicitlyAsked || contextualFollowUp;
  return offers.filter((offer) =>
    offer.promotion_mode === "asked_only"
      ? offerRelevant
      : offer.promotion_mode === "relevant_only"
        ? offerRelevant || salesRelevant
        : offerRelevant || salesRelevant || proactiveSalesFollowUp,
  );
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

async function fetchGym(gymId: string, purpose = "primary") {
  const startedAt = performance.now();
  const result = await getGymById(gymId);
  logPerformance("ai.knowledge_query", {
    resource: "gym",
    purpose,
    outcome: result.error ? "error" : "success",
    row_count: result.data ? 1 : 0,
    total_ms: elapsedMs(startedAt),
  });
  if (result.error) return { error: result.error };
  if (!result.data) return { error: "Gym profile not found." };
  return { gym: result.data };
}

async function fetchActivePackages(
  gymId: string,
  branchId: string,
  purpose = "primary",
) {
  const startedAt = performance.now();
  const result = await getMembershipPackages(gymId, branchId);
  logPerformance("ai.knowledge_query", {
    resource: "packages",
    purpose,
    outcome: result.error ? "error" : "success",
    row_count: result.data?.length ?? 0,
    total_ms: elapsedMs(startedAt),
  });
  if (result.error) return { error: result.error };
  return { packages: (result.data ?? []).filter((p) => p.active) };
}

async function fetchActiveTrainers(
  gymId: string,
  branchId: string,
  purpose = "primary",
) {
  const startedAt = performance.now();
  const result = await getTrainers(gymId, branchId);
  logPerformance("ai.knowledge_query", {
    resource: "trainers",
    purpose,
    outcome: result.error ? "error" : "success",
    row_count: result.data?.length ?? 0,
    total_ms: elapsedMs(startedAt),
  });
  if (result.error) return { error: result.error };
  return { trainers: (result.data ?? []).filter((t) => t.active) };
}

async function fetchActiveFacilities(
  gymId: string,
  branchId: string,
  purpose = "primary",
) {
  const startedAt = performance.now();
  const result = await getFacilities(gymId, branchId);
  logPerformance("ai.knowledge_query", {
    resource: "facilities",
    purpose,
    outcome: result.error ? "error" : "success",
    row_count: result.data?.length ?? 0,
    total_ms: elapsedMs(startedAt),
  });
  if (result.error) return { error: result.error };
  return { facilities: (result.data ?? []).filter((f) => f.active) };
}

async function fetchActiveMediaAssets(
  gymId: string,
  branchId: string,
  purpose = "primary",
) {
  const startedAt = performance.now();
  const result = await getMediaAssets(gymId, branchId);
  logPerformance("ai.knowledge_query", {
    resource: "media",
    purpose,
    outcome: result.error ? "error" : "success",
    row_count: result.data?.length ?? 0,
    total_ms: elapsedMs(startedAt),
  });
  if (result.error) return { error: result.error };
  return { media: (result.data ?? []).filter((m) => m.active) };
}

async function fetchActiveOffersForKnowledge(
  gymId: string,
  branchId: string | null,
  packages: MembershipPackage[],
  branchTimeZone: string | null,
  purpose: "primary" | "cross_branch",
) {
  const startedAt = performance.now();
  const result = await getActiveOffers(gymId, branchId, packages, branchTimeZone);
  logPerformance("ai.knowledge_query", {
    resource: "offers",
    purpose,
    outcome: result.error ? "error" : "success",
    row_count: result.data?.length ?? 0,
    total_ms: elapsedMs(startedAt),
  });
  return result;
}

function parsePendingMediaReference(
  message: Message | undefined,
): PendingMediaReference | null {
  const value = message?.metadata?.pending_media;
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  if (
    typeof raw.asset_id !== "string" ||
    typeof raw.branch_id !== "string" ||
    typeof raw.media_type !== "string" ||
    typeof raw.context_type !== "string" ||
    typeof raw.label !== "string"
  ) {
    return null;
  }
  return {
    asset_id: raw.asset_id,
    branch_id: raw.branch_id,
    media_type: raw.media_type as PendingMediaReference["media_type"],
    context_type: raw.context_type as PendingMediaReference["context_type"],
    related_entity_id:
      typeof raw.related_entity_id === "string" ? raw.related_entity_id : null,
    label: raw.label,
  };
}

async function resolvePendingMedia(
  gymId: string,
  messages: Message[],
  branches: Branch[],
): Promise<MediaAsset | null> {
  const previousMessage =
    messages.length >= 2 ? messages[messages.length - 2] : undefined;
  const pending =
    previousMessage?.sender_type === "ai" && previousMessage.message_type === "text"
      ? parsePendingMediaReference(previousMessage)
      : null;
  if (!pending || !branches.some((branch) => branch.id === pending.branch_id))
    return null;

  const mediaResult = await fetchActiveMediaAssets(
    gymId,
    pending.branch_id,
    "pending_media",
  );
  if ("error" in mediaResult) return null;
  const asset = mediaResult.media.find(
    (candidate) =>
      candidate.id === pending.asset_id &&
      candidate.branch_id === pending.branch_id &&
      candidate.media_type === "photo",
  );
  if (!asset) return null;

  if (asset.trainer_id) {
    const trainersResult = await fetchActiveTrainers(
      gymId,
      pending.branch_id,
      "pending_media",
    );
    if (
      "error" in trainersResult ||
      !trainersResult.trainers.some((trainer) => trainer.id === asset.trainer_id)
    ) {
      return null;
    }
  }

  return asset;
}

function parsePreviousTurnContext(
  message: Message | undefined,
): ResolvedTurnContext["previous"] {
  const value = message?.metadata?.turn_context;
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const entityRaw = raw.entity;
  const entity =
    entityRaw &&
    typeof entityRaw === "object" &&
    typeof (entityRaw as Record<string, unknown>).type === "string" &&
    typeof (entityRaw as Record<string, unknown>).id === "string" &&
    typeof (entityRaw as Record<string, unknown>).name === "string"
      ? {
          type: (entityRaw as Record<string, unknown>).type as ResolvedEntityType,
          id: (entityRaw as Record<string, unknown>).id as string,
          name: (entityRaw as Record<string, unknown>).name as string,
        }
      : null;
  return {
    effectiveBranchId:
      typeof raw.effective_branch_id === "string" ? raw.effective_branch_id : null,
    isTemporaryBranch: raw.is_temporary_branch === true,
    entity,
    intent:
      typeof raw.intent === "string" &&
      [
        "joining",
        "pricing",
        "trainer",
        "facility",
        "media",
        "policy",
        "hours",
        "general",
      ].includes(raw.intent)
        ? (raw.intent as ResolvedTurnContext["intent"])
        : null,
  };
}

function classifyTurnIntent(
  text: string,
  needs: KnowledgeNeeds,
  previous: ResolvedTurnContext["previous"],
): ResolvedTurnContext["intent"] {
  return classifyCurrentTurnIntent({
    joiningSalesCue: hasJoiningSalesCue(text),
    needs,
    previousIntent: previous?.intent ?? null,
  });
}

function isDirectFacilityAvailabilityQuestion(value: string): boolean {
  return /\b(?:do|does)\s+(?:you|u)(?:\s+\w+){0,2}\s+have\b|\b(?:is|are)\s+there\b|\b(?:is|are)\b.*\bavailable\b|\bcan\s+i\s+(?:use|access)\b/i.test(
    value,
  );
}

function isExplicitMediaRequest(value: string): boolean {
  return /\bshow\s+me\b|\b(?:show|send)\b.*\b(?:pic|pics|photo|photos|picture|pictures|image|images)\b|\bcan\s+i\s+see\b/i.test(
    value,
  );
}

function resolveMediaRequest(
  value: string,
): Pick<
  ResolvedTurnContext,
  "explicitMediaRequest" | "mediaRequest" | "mediaCategory"
> {
  const text = value.toLowerCase();
  const explicitMediaRequest =
    isExplicitMediaRequest(value) ||
    /\b(photo|photos|picture|pictures|pic|pics|picutes|image|images|gallery|dekha|dekhna|dikha)\b/i.test(
      value,
    );
  const mediaRequest = !explicitMediaRequest
    ? "none"
    : /\b(more|aur|another|extra)\b/i.test(text)
      ? "more"
      : "gallery";
  const mediaCategory = /\bsauna\b/i.test(text)
    ? "sauna"
    : /\bcardio\b/i.test(text)
      ? "cardio"
      : /\b(strength|weights?)\b/i.test(text)
        ? "strength_area"
        : /\b(locker|changing)\b/i.test(text)
          ? "locker_room"
          : null;
  return { explicitMediaRequest, mediaRequest, mediaCategory };
}

function resolveTurnEntity(
  text: string,
  intent: ResolvedTurnContext["intent"],
  effectiveBranchId: string | null,
  previous: ResolvedTurnContext["previous"],
  packages: MembershipPackage[],
  trainers: Trainer[],
  facilities: Facility[],
): EntityResolution {
  const facility = resolveNamedEntity(text, facilities, (item) => item.name, true);
  if (facility)
    return {
      entity: { type: "facility", id: facility.id, name: facility.name },
      source: "current",
    };
  const trainer =
    resolveNamedEntity(text, trainers, (item) => item.full_name) ??
    (intent === "trainer" && trainers.length === 1 ? trainers[0]! : null);
  if (trainer)
    return {
      entity: { type: "trainer", id: trainer.id, name: trainer.full_name },
      source: "current",
    };
  const pkg = resolveNamedEntity(text, packages, (item) => item.package_name);
  if (pkg)
    return {
      entity: { type: "package", id: pkg.id, name: pkg.package_name },
      source: "current",
    };
  // A temporary branch reference can continue the previously grounded topic
  // (for example, the same owner-configured facility at another location).
  // Re-resolve by the structured entity name against the effective branch's
  // own records; never reuse the prior branch's entity ID.
  if (previous?.entity && previous.effectiveBranchId !== effectiveBranchId) {
    const source =
      previous.entity.type === "facility"
        ? facilities
        : previous.entity.type === "trainer"
          ? trainers
          : packages;
    const name =
      previous.entity.type === "facility"
        ? (item: Facility | Trainer | MembershipPackage) =>
            "name" in item
              ? item.name
              : "full_name" in item
                ? item.full_name
                : item.package_name
        : previous.entity.type === "trainer"
          ? (item: Facility | Trainer | MembershipPackage) =>
              "full_name" in item
                ? item.full_name
                : "name" in item
                  ? item.name
                  : item.package_name
          : (item: Facility | Trainer | MembershipPackage) =>
              "package_name" in item
                ? item.package_name
                : "name" in item
                  ? item.name
                  : item.full_name;
    const matchingEntity = source.filter(
      (item) =>
        normalizeEntityText(name(item)) === normalizeEntityText(previous.entity!.name),
    );
    if (matchingEntity.length === 1) {
      const item = matchingEntity[0]!;
      return {
        entity: {
          type: previous.entity.type,
          id: item.id,
          name: name(item),
        },
        source: "continuity",
      };
    }
  }
  if (previous?.entity && previous.effectiveBranchId === effectiveBranchId) {
    const source =
      previous.entity.type === "facility"
        ? facilities
        : previous.entity.type === "trainer"
          ? trainers
          : packages;
    if (source.some((item) => item.id === previous.entity!.id))
      return { entity: previous.entity, source: "continuity" };
  }
  return { entity: null, source: "none" };
}

export function resolveAuthoritativeTurnState(input: {
  customerText: string;
  needs: KnowledgeNeeds;
  previous: ResolvedTurnContext["previous"];
  effectiveBranchId: string | null;
  packages: MembershipPackage[];
  trainers: Trainer[];
  facilities: Facility[];
}): {
  intent: ResolvedTurnContext["intent"];
  entity: ResolvedTurnEntity;
  entitySource: EntityResolution["source"];
  mediaRequest: ReturnType<typeof resolveMediaRequest>;
} {
  const provisionalIntent = classifyTurnIntent(
    input.customerText,
    input.needs,
    input.previous,
  );
  const entityResolution = resolveTurnEntity(
    input.customerText,
    provisionalIntent,
    input.effectiveBranchId,
    input.previous,
    input.packages,
    input.trainers,
    input.facilities,
  );
  const mediaRequest = resolveMediaRequest(input.customerText);
  const currentState = resolveCurrentTurnState({
    provisionalIntent,
    needsAll: input.needs.all,
    mediaRequest: mediaRequest.mediaRequest,
    entityResolution,
  });

  return {
    intent: currentState.intent,
    entity: currentState.entity as ResolvedTurnEntity,
    entitySource: entityResolution.source,
    mediaRequest,
  };
}

// ---------------------------------------------------------------------------
// Branch resolution
// ---------------------------------------------------------------------------

/**
 * Resolves which branch to use for a conversation turn.
 *
 * Priority:
 *  1. conversation.branch_id (already established)
 *  2. Single-branch gym → use that branch automatically
 *  3. Multi-branch gym with no branch established → return null (AI must ask)
 */
async function resolveBranch(
  gymId: string,
  conversationBranchId: string | null,
): Promise<{
  branch: Branch | null;
  allBranches: Branch[];
  isMultiBranch: boolean;
}> {
  const startedAt = performance.now();
  const branchesResult = await getBranches(gymId);
  logPerformance("ai.knowledge_query", {
    resource: "branches",
    purpose: "resolution",
    outcome: branchesResult.error ? "error" : "success",
    row_count: branchesResult.data?.length ?? 0,
    total_ms: elapsedMs(startedAt),
  });
  const allBranches = branchesResult.data ?? [];
  const isMultiBranch = allBranches.length > 1;

  if (conversationBranchId) {
    // Use the already-established branch
    const match = allBranches.find((b) => b.id === conversationBranchId) ?? null;
    if (match) return { branch: match, allBranches, isMultiBranch };
    // Branch not found in this gym — fall through to default
  }

  if (!isMultiBranch && allBranches.length === 1) {
    // Single-branch gym: always use the only branch
    return { branch: allBranches[0]!, allBranches, isMultiBranch: false };
  }

  // Multi-branch, branch not yet established
  return { branch: null, allBranches, isMultiBranch };
}

/**
 * Detects whether the customer message asks about another branch in the gym.
 * Matches branch names, aliases (e.g. DHA, G-14, F-10), city names, or broad comparison phrases.
/**
 * Detects whether the customer message asks about or selects a branch in the gym.
 * Matches branch names, aliases (e.g. DHA, G-14, F-10, Karachi Company), city names,
 * ordinal selections ("1", "first", "option 1"), or broad comparison phrases.
 */
export function detectReferencedBranches(
  messageContent: string,
  allBranches: Branch[],
  primaryBranchId: string | null,
): Branch[] {
  if (!messageContent || allBranches.length <= 1) return [];

  const text = messageContent.toLowerCase().trim();
  const cleanText = text.replace(/[^a-z0-9]/g, "");

  const asksAllBranches =
    /\b(all branch(es)?|other branch(es)?|every branch|compare branch(es)?|different branch(es)?|both branch(es)?|har branch|sari branch(es)?|tamam branch(es)?)\b/i.test(
      text,
    );

  // Check for simple ordinal selections like "1", "2", "option 1", "first one"
  if (/^(1|first|option\s*1|first\s*one|1st)$/i.test(text) && allBranches[0]) {
    return primaryBranchId === allBranches[0].id ? [] : [allBranches[0]];
  }
  if (/^(2|second|option\s*2|second\s*one|2nd)$/i.test(text) && allBranches[1]) {
    return primaryBranchId === allBranches[1].id ? [] : [allBranches[1]];
  }
  if (/^(3|third|option\s*3|third\s*one|3rd)$/i.test(text) && allBranches[2]) {
    return primaryBranchId === allBranches[2].id ? [] : [allBranches[2]];
  }

  const explicitlyReferenced = allBranches.filter((b) => {
    // Skip if it's the primary branch (already loaded as primary)
    if (primaryBranchId && b.id === primaryBranchId) return false;

    if (asksAllBranches) return true;

    return branchMatchesText(b, text, cleanText, allBranches);
  });

  return explicitlyReferenced;
}

function branchMatchesText(
  branch: Branch,
  text: string,
  cleanText: string,
  allBranches: Branch[],
): boolean {
  const name = branch.branch_name.toLowerCase();
  if (name && text.includes(name)) return true;

  const tokens = name.split(/[\s\-_,]+/).filter(
    (token) =>
      token.length >= 2 &&
      !["branch", "gym", "fitness", "the"].includes(token) &&
      allBranches.filter((other) =>
        other.branch_name
          .toLowerCase()
          .split(/[\s\-_,]+/)
          .includes(token),
      ).length === 1,
  );
  for (const token of tokens) {
    if (text.includes(token)) return true;
    const cleanToken = token.replace(/[^a-z0-9]/g, "");
    if (cleanToken.length >= 2 && cleanText.includes(cleanToken)) return true;
  }

  const cleanName = name.replace(/[^a-z0-9]/g, "");
  if (cleanName.length >= 3 && cleanText.includes(cleanName)) return true;

  const addressTokens = (branch.address ?? "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 2);
  for (let index = 0; index < addressTokens.length - 1; index += 1) {
    if (text.includes(`${addressTokens[index]} ${addressTokens[index + 1]}`))
      return true;
  }
  // Sector/area identifiers such as G-14, G14, and G 14 are meaningful
  // aliases even when they are stored only in the branch address.
  if (
    addressTokens.some(
      (token) => /^[a-z]{1,3}\d{1,3}$/.test(token) && cleanText.includes(token),
    )
  ) {
    return true;
  }
  const addressAreaAliases = (branch.address ?? "").matchAll(
    /\b([a-z]{1,3})\s*-?\s*(\d{1,3})\b/gi,
  );
  for (const match of addressAreaAliases) {
    if (cleanText.includes(`${match[1]}${match[2]}`.toLowerCase())) return true;
  }

  if (
    branch.city &&
    branch.city.length >= 4 &&
    text.includes(branch.city.toLowerCase())
  ) {
    const sameCityCount = allBranches.filter(
      (other) => other.city?.toLowerCase() === branch.city?.toLowerCase(),
    ).length;
    if (sameCityCount === 1) return true;
  }

  return false;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Builds a KnowledgeContext from a ConversationContext.
 *
 * Branch resolution:
 * - Uses conversation.branch_id when set.
 * - Falls back to the gym's single branch if there is only one.
 * - Returns branch: null for multi-branch gyms where the branch is unknown,
 *   so the prompt builder can instruct the AI to ask the customer.
 * - Detects cross-branch inquiries (e.g. "What packages does DHA have?" while
 *   primary is G-14) and retrieves targeted packages/facilities for the discussion branch.
 *
 * All branch-specific data is fetched from the resolved branch only.
 * Cross-gym contamination is impossible because every query is filtered by gym_id.
 */
export async function buildKnowledgeContext(
  ctx: ConversationContext,
): Promise<KnowledgeResult> {
  const totalStartedAt = performance.now();
  const gymId = ctx.conversation.gym_id;
  const messageType = ctx.latestCustomerMessage.message_type;
  const customerText = ctx.latestCustomerMessage.content;

  // Automation turns only need gym/branch identity; not full business listings.
  const strategy = ctx.automationInstruction
    ? {
        needsGym: true,
        needsPackages: false,
        needsTrainers: false,
        needsFacilities: false,
        needsMedia: false,
      }
    : STRATEGY[messageType];
  const offerRelevance = getOfferTurnRelevance(customerText, ctx.latestMessages);
  let needs = ctx.automationInstruction
    ? ALL_KNOWLEDGE_NEEDS
    : inferKnowledgeNeeds(customerText, ctx.latestMessages, offerRelevance);
  const previousAiText = [...ctx.latestMessages]
    .reverse()
    .find(
      (message) =>
        message.id !== ctx.latestCustomerMessage.id &&
        message.sender_type === "ai" &&
        message.message_type === "text",
    );
  const previous = parsePreviousTurnContext(previousAiText);
  const initialIntent = classifyTurnIntent(customerText, needs, previous);
  if (previous?.entity?.type === "package") {
    needs = { ...needs, packages: true };
  }
  if (previous?.entity?.type === "trainer" || initialIntent === "trainer") {
    needs = { ...needs, trainers: true, media: true };
  }
  if (previous?.entity?.type === "facility" || initialIntent === "facility") {
    needs = { ...needs, facilities: true, media: true };
  }

  // ── Resolve branch ────────────────────────────────────────────────────────
  const branchResolutionPromise = (async () => {
    const startedAt = performance.now();
    const result = await resolveBranch(gymId, ctx.conversation.branch_id ?? null);
    return { result, elapsedMs: elapsedMs(startedAt) };
  })();
  const gymPromise = (async () => {
    const startedAt = performance.now();
    const result = strategy.needsGym ? await fetchGym(gymId) : null;
    return { result, elapsedMs: elapsedMs(startedAt) };
  })();
  const establishedBranchId = ctx.conversation.branch_id ?? null;
  // The conversation branch is protected by the compound gym/branch foreign
  // key. Start scoped reads speculatively, but consume them only after the
  // branch directory confirms the same authoritative branch for this turn.
  const earlyPrimaryReads = establishedBranchId
    ? {
        packages:
          strategy.needsPackages && needs.packages
            ? fetchActivePackages(gymId, establishedBranchId, "established_branch")
            : null,
        trainers:
          strategy.needsTrainers && needs.trainers
            ? fetchActiveTrainers(gymId, establishedBranchId, "established_branch")
            : null,
        facilities:
          strategy.needsFacilities && needs.facilities
            ? fetchActiveFacilities(gymId, establishedBranchId, "established_branch")
            : null,
        media:
          strategy.needsMedia && needs.media
            ? fetchActiveMediaAssets(gymId, establishedBranchId, "established_branch")
            : null,
      }
    : null;
  const branchResolution = await branchResolutionPromise;
  const { branch, allBranches, isMultiBranch } = branchResolution.result;
  const branchResolutionMs = branchResolution.elapsedMs;

  const branchId = branch?.id ?? null;
  const pendingMediaPromise = (async () => {
    const startedAt = performance.now();
    const result = ctx.automationInstruction
      ? null
      : await resolvePendingMedia(gymId, ctx.latestMessages, allBranches);
    return { result, elapsedMs: elapsedMs(startedAt) };
  })();

  // ── Detect cross-branch references or branch selections in customer message ──
  // When primary branch is established (branchId != null), loads data for other branches being asked about.
  // When unresolved (branchId === null), loads data for any specifically named branch so the AI can
  // answer explicit branch queries or immediately provide details in the SAME TURN upon branch selection.
  const explicitlyReferencedBranches = isMultiBranch
    ? detectReferencedBranches(customerText, allBranches, branchId)
    : [];
  // When exactly one alternate location exists, a branch-relative continuation
  // of a previously resolved entity can safely use that location's own facts.
  // This is intentionally structural (current branch + one alternative +
  // grounded prior entity), rather than a dictionary of language-specific
  // spellings for "other".
  const alternateBranches = branchId
    ? allBranches.filter((item) => item.id !== branchId)
    : [];
  const customerMentionsPrimaryBranch = branch
    ? branchMatchesText(
        branch,
        customerText.toLocaleLowerCase(),
        customerText.toLocaleLowerCase().replace(/[^a-z0-9]/g, ""),
        allBranches,
      )
    : false;
  const implicitAlternateBranch =
    explicitlyReferencedBranches.length === 0 &&
    branchId !== null &&
    previous?.entity != null &&
    alternateBranches.length === 1 &&
    /\bbranch(?:es)?\b/i.test(customerText) &&
    !customerMentionsPrimaryBranch
      ? alternateBranches
      : [];
  const referencedBranches =
    explicitlyReferencedBranches.length > 0
      ? explicitlyReferencedBranches
      : implicitAlternateBranch.length > 0
        ? implicitAlternateBranch
        : previous?.isTemporaryBranch &&
            previous.effectiveBranchId &&
            previous.effectiveBranchId !== branchId &&
            allBranches.some((item) => item.id === previous.effectiveBranchId)
          ? [allBranches.find((item) => item.id === previous.effectiveBranchId)!]
          : [];

  // A short branch answer (e.g. "G-9") inherits the immediately preceding
  // joining/pricing context for proactive promotions. This is turn-local: it
  // neither changes branch selection nor makes relevant-only/asked-only offers
  // appear outside their configured modes.
  const proactiveSalesFollowUp =
    !ctx.automationInstruction &&
    !branchId &&
    referencedBranches.length === 1 &&
    previous?.intent === "joining";
  // An unresolved conversation that names exactly one branch can safely load
  // that branch's candidates. The single existing model call then determines
  // semantically whether it is a joining commitment; this preload itself never
  // persists a branch or sends media.
  const resolvedBranchCandidate =
    !ctx.automationInstruction && !branchId && referencedBranches.length === 1;
  if (proactiveSalesFollowUp || resolvedBranchCandidate) {
    needs = { ...needs, packages: true, offers: true, media: true };
  }
  const provisionalIntent = classifyTurnIntent(customerText, needs, previous);
  if (previous?.entity?.type === "package") {
    needs = { ...needs, packages: true };
  }
  if (previous?.entity?.type === "trainer" || provisionalIntent === "trainer") {
    needs = { ...needs, trainers: true, media: true };
  }
  if (previous?.entity?.type === "facility" || provisionalIntent === "facility") {
    needs = { ...needs, facilities: true, media: true };
  }
  const useEarlyPrimaryReads =
    establishedBranchId !== null && branchId === establishedBranchId;
  if (earlyPrimaryReads && !useEarlyPrimaryReads) {
    void Promise.all(
      Object.values(earlyPrimaryReads).filter(
        (read): read is NonNullable<typeof read> => read !== null,
      ),
    ).catch(() => undefined);
  }

  // ── Parallel fetches ─────────────────────────────────────────────────────
  const dataQueriesStartedAt = performance.now();
  const [pendingMediaResolution, dataResults] = await Promise.all([
    pendingMediaPromise,
    Promise.all([
      gymPromise.then(({ result }) => result),
      strategy.needsPackages && needs.packages && branchId
        ? useEarlyPrimaryReads && earlyPrimaryReads?.packages
          ? earlyPrimaryReads.packages
          : fetchActivePackages(gymId, branchId)
        : Promise.resolve(null),
      strategy.needsTrainers && needs.trainers && branchId
        ? useEarlyPrimaryReads && earlyPrimaryReads?.trainers
          ? earlyPrimaryReads.trainers
          : fetchActiveTrainers(gymId, branchId)
        : Promise.resolve(null),
      strategy.needsFacilities && needs.facilities && branchId
        ? useEarlyPrimaryReads && earlyPrimaryReads?.facilities
          ? earlyPrimaryReads.facilities
          : fetchActiveFacilities(gymId, branchId)
        : Promise.resolve(null),
      strategy.needsMedia && needs.media && branchId
        ? useEarlyPrimaryReads && earlyPrimaryReads?.media
          ? earlyPrimaryReads.media
          : fetchActiveMediaAssets(gymId, branchId)
        : Promise.resolve(null),
      // Fetch data for referenced cross-branches if any
      referencedBranches.length > 0
        ? Promise.all(
            referencedBranches.map(async (rb) => {
              const [pkgs, facs, trns, media] = await Promise.all([
                needs.packages || needs.offers
                  ? fetchActivePackages(gymId, rb.id, "cross_branch")
                  : Promise.resolve({ packages: [] }),
                needs.facilities
                  ? fetchActiveFacilities(gymId, rb.id, "cross_branch")
                  : Promise.resolve({ facilities: [] }),
                needs.trainers
                  ? fetchActiveTrainers(gymId, rb.id, "cross_branch")
                  : Promise.resolve({ trainers: [] }),
                needs.media
                  ? fetchActiveMediaAssets(gymId, rb.id, "cross_branch")
                  : Promise.resolve({ media: [] }),
              ]);
              return {
                branch: rb,
                packages: "packages" in pkgs ? (pkgs.packages ?? []) : [],
                facilities: "facilities" in facs ? (facs.facilities ?? []) : [],
                trainers: "trainers" in trns ? (trns.trainers ?? []) : [],
                media: "media" in media ? (media.media ?? []) : [],
                offers: [],
              } as CrossBranchKnowledge;
            }),
          )
        : Promise.resolve(null),
    ]),
  ]);
  const pendingMedia = pendingMediaResolution.result;
  const pendingMediaMs = pendingMediaResolution.elapsedMs;
  const [
    gymResult,
    packagesResult,
    trainersResult,
    facilitiesResult,
    mediaResult,
    crossBranchResults,
  ] = dataResults;
  const dataQueriesMs = elapsedMs(dataQueriesStartedAt);

  // ── Error surface ─────────────────────────────────────────────────────────
  if (gymResult && "error" in gymResult)
    return { data: null, error: `Gym fetch failed: ${gymResult.error}` };
  if (packagesResult && "error" in packagesResult)
    return { data: null, error: `Packages fetch failed: ${packagesResult.error}` };
  if (trainersResult && "error" in trainersResult)
    return { data: null, error: `Trainers fetch failed: ${trainersResult.error}` };
  if (facilitiesResult && "error" in facilitiesResult)
    return { data: null, error: `Facilities fetch failed: ${facilitiesResult.error}` };
  if (mediaResult && "error" in mediaResult)
    return { data: null, error: `Media fetch failed: ${mediaResult.error}` };

  // ── Assemble ──────────────────────────────────────────────────────────────
  const gym = gymResult ? gymResult.gym : null;
  const packages = packagesResult ? packagesResult.packages : null;
  const trainers = trainersResult ? trainersResult.trainers : null;
  const facilities = facilitiesResult ? facilitiesResult.facilities : null;
  const media = mediaResult ? mediaResult.media : null;
  const primaryPackages = packages ?? [];
  const offersStartedAt = performance.now();
  const primaryOffersResult =
    needs.offers && branch?.timezone
      ? await fetchActiveOffersForKnowledge(
          gymId,
          branchId,
          primaryPackages,
          branch?.timezone ?? null,
          "primary",
        )
      : { data: null, error: null };
  if (primaryOffersResult.error)
    return { data: null, error: `Offers fetch failed: ${primaryOffersResult.error}` };
  const offers = primaryOffersResult.data
    ? filterOffersForTurn(primaryOffersResult.data, offerRelevance, {
        proactiveSalesFollowUp,
      })
    : null;
  const crossBranchKnowledge = crossBranchResults
    ? await Promise.all(
        crossBranchResults.map(async (crossBranch) => {
          if (!needs.offers) return crossBranch;
          if (!crossBranch.branch.timezone) return { ...crossBranch, offers: [] };
          const offerResult = await fetchActiveOffersForKnowledge(
            gymId,
            crossBranch.branch.id,
            crossBranch.packages,
            crossBranch.branch.timezone,
            "cross_branch",
          );
          if (offerResult.error) throw new Error(offerResult.error);
          return {
            ...crossBranch,
            offers: filterOffersForTurn(offerResult.data ?? [], offerRelevance, {
              proactiveSalesFollowUp,
            }),
          };
        }),
      )
    : null;
  const offersMs = elapsedMs(offersStartedAt);

  const effectiveBranchId =
    referencedBranches.length === 1 ? referencedBranches[0]!.id : branchId;
  const effectiveCrossBranch = crossBranchKnowledge?.find(
    (item) => item.branch.id === effectiveBranchId,
  );
  const effectivePackages = effectiveCrossBranch?.packages ?? packages ?? [];
  const effectiveTrainers = effectiveCrossBranch?.trainers ?? trainers ?? [];
  const effectiveFacilities = effectiveCrossBranch?.facilities ?? facilities ?? [];
  const effectiveMedia = effectiveCrossBranch?.media ?? media ?? [];
  const effectiveOffers = effectiveCrossBranch?.offers ?? offers ?? [];
  const resolvedState = resolveAuthoritativeTurnState({
    customerText,
    needs,
    previous,
    effectiveBranchId,
    packages: effectivePackages,
    trainers: effectiveTrainers,
    facilities: effectiveFacilities,
  });
  const { intent, entity, mediaRequest } = resolvedState;
  const turn: ResolvedTurnContext = {
    gymId,
    primaryBranchId: branchId,
    effectiveBranchId,
    isTemporaryBranch:
      effectiveBranchId !== null &&
      effectiveBranchId !== branchId &&
      !proactiveSalesFollowUp,
    persistPrimaryBranchId: proactiveSalesFollowUp ? effectiveBranchId : null,
    proactiveSalesFollowUp,
    intent,
    hasExplicitTrainerIntent: !needs.all && needs.trainers,
    entity,
    previous,
    directFacilityAvailability:
      entity?.type === "facility" && isDirectFacilityAvailabilityQuestion(customerText),
    explicitMediaRequest: mediaRequest.explicitMediaRequest,
    mediaRequest: entity ? "entity" : mediaRequest.mediaRequest,
    mediaCategory: mediaRequest.mediaCategory,
    pendingMedia,
    facts: {
      packages: effectivePackages,
      trainers: effectiveTrainers,
      facilities: effectiveFacilities,
      media: effectiveMedia,
      offers: effectiveOffers,
    },
  };

  const loaded: string[] = [];
  if (gym) loaded.push("gym");
  if (branch) loaded.push(`branch:${branch.branch_name}`);
  if (packages) loaded.push(`${packages.length} package(s)`);
  if (trainers) loaded.push(`${trainers.length} trainer(s)`);
  if (facilities) loaded.push(`${facilities.length} facility(ies)`);
  if (media) loaded.push(`${media.length} media asset(s)`);
  if (offers) loaded.push(`${offers.length} active offer(s)`);
  if (crossBranchKnowledge && crossBranchKnowledge.length > 0) {
    loaded.push(
      `cross-branch:${crossBranchKnowledge.map((c) => c.branch.branch_name).join(",")}`,
    );
  }

  const summary =
    loaded.length > 0
      ? `Loaded for "${messageType}": ${loaded.join(", ")}.${isMultiBranch && !branch ? " [no branch established — AI should ask]" : ""}`
      : `No data loaded for "${messageType}".`;

  logPerformance("ai.knowledge_load", {
    message_type: messageType,
    branch_resolution_ms: branchResolutionMs,
    pending_media_ms: pendingMediaMs,
    data_queries_ms: dataQueriesMs,
    offers_ms: offersMs,
    branch_count: allBranches.length,
    package_count: packages?.length ?? 0,
    trainer_count: trainers?.length ?? 0,
    facility_count: facilities?.length ?? 0,
    media_count: media?.length ?? 0,
    offer_count: offers?.length ?? 0,
    cross_branch_count: crossBranchKnowledge?.length ?? 0,
    resolved_intent: turn.intent,
    resolved_entity_type: turn.entity?.type ?? null,
    resolved_entity_source: resolvedState.entitySource,
    explicit_media_request: turn.explicitMediaRequest,
    resolved_media_request: turn.mediaRequest,
    established_branch_reads_started_early: Boolean(earlyPrimaryReads),
    total_ms: elapsedMs(totalStartedAt),
  });

  return {
    data: {
      gym,
      branch,
      isMultiBranch,
      allBranches: isMultiBranch ? allBranches : null,
      packages,
      trainers,
      facilities,
      media,
      turn,
      offers,
      crossBranchKnowledge,
      needs,
      summary,
    },
    error: null,
  };
}
