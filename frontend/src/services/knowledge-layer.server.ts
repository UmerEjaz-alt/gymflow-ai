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
import type { MediaAsset } from "@/types/media-asset";
import type { ConversationContext } from "@/services/conversation-manager.server";
import { getGymById } from "@/services/gym.server";
import { getBranches } from "@/services/branch.server";
import { getMembershipPackages } from "@/services/membership-package.server";
import { getTrainers } from "@/services/trainer.server";
import { getFacilities } from "@/services/facility.server";
import { getMediaAssets } from "@/services/media-asset.server";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type CrossBranchKnowledge = {
  branch: Branch;
  packages: MembershipPackage[];
  facilities: Facility[];
  trainers: Trainer[];
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
};

/**
 * Narrows retrieval only when the latest message makes its subject explicit.
 * It is deliberately not an intent system: unclear, conversational, and
 * mixed-topic messages retain the full knowledge set.
 */
export function inferKnowledgeNeeds(messageContent: string): KnowledgeNeeds {
  const text = messageContent.toLowerCase();
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
    /\b(photo|photos|picture|pictures|image|images|video|videos|brochure|gallery|dekha|dekhna|dikha)\b/.test(
      text,
    );
  const policies =
    /\b(trials?|visits?|tours?|day pass|polic(?:y|ies)|refund|freeze|cancel(?:lation)?|guest|transfer|discount|concession|special price|last price)\b/.test(
      text,
    );
  const openingHours = /\b(timing|timings|hours|open|close|closing|kab|time)\b/.test(
    text,
  );

  if (!packages && !trainers && !facilities && !media && !policies && !openingHours) {
    return ALL_KNOWLEDGE_NEEDS;
  }

  return {
    all: false,
    packages,
    trainers,
    facilities,
    media,
    policies,
    openingHours,
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

async function fetchGym(gymId: string) {
  const result = await getGymById(gymId);
  if (result.error) return { error: result.error };
  if (!result.data) return { error: "Gym profile not found." };
  return { gym: result.data };
}

async function fetchActivePackages(gymId: string, branchId: string) {
  const result = await getMembershipPackages(gymId, branchId);
  if (result.error) return { error: result.error };
  return { packages: (result.data ?? []).filter((p) => p.active) };
}

async function fetchActiveTrainers(gymId: string, branchId: string) {
  const result = await getTrainers(gymId, branchId);
  if (result.error) return { error: result.error };
  return { trainers: (result.data ?? []).filter((t) => t.active) };
}

async function fetchActiveFacilities(gymId: string, branchId: string) {
  const result = await getFacilities(gymId, branchId);
  if (result.error) return { error: result.error };
  return { facilities: (result.data ?? []).filter((f) => f.active) };
}

async function fetchActiveMediaAssets(gymId: string, branchId: string) {
  const result = await getMediaAssets(gymId, branchId);
  if (result.error) return { error: result.error };
  return { media: (result.data ?? []).filter((m) => m.active) };
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
  const branchesResult = await getBranches(gymId);
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

  return allBranches.filter((b) => {
    // Skip if it's the primary branch (already loaded as primary)
    if (primaryBranchId && b.id === primaryBranchId) return false;

    if (asksAllBranches) return true;

    // Check full branch name (e.g. "DHA Branch", "G-14 Branch", "Karachi Company")
    const name = b.branch_name.toLowerCase();
    if (name && text.includes(name)) return true;

    // Check significant tokens in branch name (e.g. "DHA", "G-14", "F-10", "Karachi", "Company", "Gulberg")
    const tokens = name
      .split(/[\s\-_,]+/)
      .filter((t) => t.length >= 2 && !["branch", "gym", "fitness", "the"].includes(t));
    for (const token of tokens) {
      if (text.includes(token)) return true;
      const cleanToken = token.replace(/[^a-z0-9]/g, "");
      if (cleanToken.length >= 2 && cleanText.includes(cleanToken)) return true;
    }

    // Check normalized branch name (e.g. "g14" matches "G-14", "f10" matches "F-10")
    const cleanName = name.replace(/[^a-z0-9]/g, "");
    if (cleanName.length >= 3 && cleanText.includes(cleanName)) return true;

    // A gym may name a branch after the business while storing its familiar
    // area name in the address (for example, "Iron fitness" at "Karachi
    // Company G-9 Markaz"). Match meaningful adjacent address words so an
    // explicit location reference still loads that branch's own knowledge.
    const addressTokens = (b.address ?? "")
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((token) => token.length >= 2);
    for (let index = 0; index < addressTokens.length - 1; index += 1) {
      const locationPhrase = `${addressTokens[index]} ${addressTokens[index + 1]}`;
      if (text.includes(locationPhrase)) return true;
    }

    // Check city/area if distinctive
    if (b.city && b.city.length >= 4 && text.includes(b.city.toLowerCase())) {
      const sameCityCount = allBranches.filter(
        (other) => other.city?.toLowerCase() === b.city?.toLowerCase(),
      ).length;
      if (sameCityCount === 1) return true;
    }

    return false;
  });
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
  const needs = ctx.automationInstruction
    ? ALL_KNOWLEDGE_NEEDS
    : inferKnowledgeNeeds(customerText);

  // ── Resolve branch ────────────────────────────────────────────────────────
  const { branch, allBranches, isMultiBranch } = await resolveBranch(
    gymId,
    ctx.conversation.branch_id ?? null,
  );

  const branchId = branch?.id ?? null;

  // ── Detect cross-branch references or branch selections in customer message ──
  // When primary branch is established (branchId != null), loads data for other branches being asked about.
  // When unresolved (branchId === null), loads data for any specifically named branch so the AI can
  // answer explicit branch queries or immediately provide details in the SAME TURN upon branch selection.
  const referencedBranches = isMultiBranch
    ? detectReferencedBranches(customerText, allBranches, branchId)
    : [];

  // ── Parallel fetches ─────────────────────────────────────────────────────
  const [
    gymResult,
    packagesResult,
    trainersResult,
    facilitiesResult,
    mediaResult,
    crossBranchResults,
  ] = await Promise.all([
    strategy.needsGym ? fetchGym(gymId) : Promise.resolve(null),
    strategy.needsPackages && needs.packages && branchId
      ? fetchActivePackages(gymId, branchId)
      : Promise.resolve(null),
    strategy.needsTrainers && needs.trainers && branchId
      ? fetchActiveTrainers(gymId, branchId)
      : Promise.resolve(null),
    strategy.needsFacilities && needs.facilities && branchId
      ? fetchActiveFacilities(gymId, branchId)
      : Promise.resolve(null),
    strategy.needsMedia && needs.media && branchId
      ? fetchActiveMediaAssets(gymId, branchId)
      : Promise.resolve(null),
    // Fetch data for referenced cross-branches if any
    referencedBranches.length > 0
      ? Promise.all(
          referencedBranches.map(async (rb) => {
            const [pkgs, facs, trns] = await Promise.all([
              needs.packages
                ? fetchActivePackages(gymId, rb.id)
                : Promise.resolve({ packages: [] }),
              needs.facilities
                ? fetchActiveFacilities(gymId, rb.id)
                : Promise.resolve({ facilities: [] }),
              needs.trainers
                ? fetchActiveTrainers(gymId, rb.id)
                : Promise.resolve({ trainers: [] }),
            ]);
            return {
              branch: rb,
              packages: "packages" in pkgs ? (pkgs.packages ?? []) : [],
              facilities: "facilities" in facs ? (facs.facilities ?? []) : [],
              trainers: "trainers" in trns ? (trns.trainers ?? []) : [],
            } as CrossBranchKnowledge;
          }),
        )
      : Promise.resolve(null),
  ]);

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
  const crossBranchKnowledge = crossBranchResults ?? null;

  const loaded: string[] = [];
  if (gym) loaded.push("gym");
  if (branch) loaded.push(`branch:${branch.branch_name}`);
  if (packages) loaded.push(`${packages.length} package(s)`);
  if (trainers) loaded.push(`${trainers.length} trainer(s)`);
  if (facilities) loaded.push(`${facilities.length} facility(ies)`);
  if (media) loaded.push(`${media.length} media asset(s)`);
  if (crossBranchKnowledge && crossBranchKnowledge.length > 0) {
    loaded.push(
      `cross-branch:${crossBranchKnowledge.map((c) => c.branch.branch_name).join(",")}`,
    );
  }

  const summary =
    loaded.length > 0
      ? `Loaded for "${messageType}": ${loaded.join(", ")}.${isMultiBranch && !branch ? " [no branch established — AI should ask]" : ""}`
      : `No data loaded for "${messageType}".`;

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
      crossBranchKnowledge,
      needs,
      summary,
    },
    error: null,
  };
}
