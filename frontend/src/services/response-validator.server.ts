/**
 * Response Validator
 *
 * Validates AI structured JSON output and produces a safe reply + understanding
 * payload for downstream persistence.
 */

import type { AIResponse } from "@/services/ai-provider";
import type {
  AIBookingAction,
  AIBookingActionType,
  ConversationStage,
  ConversationUnderstanding,
  LeadSignal,
  StructuredAIOutput,
  UnderstandingMemoryUpdates,
} from "@/types/understanding";
import type { BookingType } from "@/types/booking";
import type {
  ExperienceLevel,
  FitnessGoal,
  PersonalTrainingInterest,
  PreferredWorkoutTime,
} from "@/types/conversation-memory";
import type { PendingMediaReference } from "@/types/media-asset";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type ValidatedResponse = {
  approved: boolean;
  text: string;
  reason: string | null;
  understanding: ConversationUnderstanding;
  usedFallback: boolean;
  mediaActions: Array<{ assetId: string; caption: string | null }>;
  messageSequence: Array<
    | { type: "text"; text: string }
    | { type: "image"; assetId: string; caption: string | null }
  >;
  pendingMediaAssetId: string | null;
  pendingMedia: PendingMediaReference | null;
  selectedBranchId: string | null;
  bookingAction: AIBookingAction | null;
};

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const MAX_WORDS = 120;
const FALLBACK_REPLY =
  "Thanks for your message. I can help with packages, pricing, timings, trials, and trainer info. Could you share what you want to achieve?";

const CONVERSATION_STAGES: ConversationStage[] = [
  "greeting",
  "discovery",
  "consideration",
  "decision",
  "handoff",
];
const LEAD_SIGNALS: LeadSignal[] = [
  "neutral",
  "interest",
  "high_intent",
  "visit_inquiry",
  "visit_commitment",
  "rejection",
  "reengagement",
];
const FITNESS_GOALS: FitnessGoal[] = [
  "weight_loss",
  "muscle_gain",
  "general_fitness",
  "strength",
  "endurance",
];
const EXPERIENCE_LEVELS: ExperienceLevel[] = ["beginner", "intermediate", "advanced"];
const PT_INTERESTS: PersonalTrainingInterest[] = ["yes", "no", "unknown"];
const WORKOUT_TIMES: PreferredWorkoutTime[] = [
  "morning",
  "afternoon",
  "evening",
  "night",
];

const BANNED_PHRASES: string[] = [
  "free membership",
  "lifetime membership",
  "guaranteed results",
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function countWords(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}

function findBannedPhrase(text: string): string | null {
  const lower = text.toLowerCase();
  for (const phrase of BANNED_PHRASES) {
    if (lower.includes(phrase.toLowerCase())) return phrase;
  }
  return null;
}

function isEnumValue<T extends string>(
  value: unknown,
  options: readonly T[],
): value is T {
  return typeof value === "string" && options.includes(value as T);
}

function parseNullableNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return value;
}

function parseUnderstandingMemoryUpdates(value: unknown): UnderstandingMemoryUpdates {
  if (!value || typeof value !== "object") return {};
  const raw = value as Record<string, unknown>;
  const updates: UnderstandingMemoryUpdates = {};

  if (typeof raw.customer_name === "string" && raw.customer_name.trim() !== "") {
    updates.customer_name = raw.customer_name.trim();
  }
  if (isEnumValue(raw.fitness_goal, FITNESS_GOALS)) {
    updates.fitness_goal = raw.fitness_goal;
  }
  if (typeof raw.budget === "number" && Number.isFinite(raw.budget) && raw.budget > 0) {
    updates.budget = Math.round(raw.budget);
  }
  if (isEnumValue(raw.preferred_workout_time, WORKOUT_TIMES)) {
    updates.preferred_workout_time = raw.preferred_workout_time;
  }
  if (isEnumValue(raw.experience_level, EXPERIENCE_LEVELS)) {
    updates.experience_level = raw.experience_level;
  }
  if (
    typeof raw.interested_package === "string" &&
    raw.interested_package.trim() !== ""
  ) {
    updates.interested_package = raw.interested_package.trim();
  }
  if (isEnumValue(raw.personal_training_interest, PT_INTERESTS)) {
    updates.personal_training_interest = raw.personal_training_interest;
  }
  if (typeof raw.trial_discussed === "boolean") {
    updates.trial_discussed = raw.trial_discussed;
  }
  if (typeof raw.visit_discussed === "boolean") {
    updates.visit_discussed = raw.visit_discussed;
  }

  return updates;
}

function defaultUnderstanding(): ConversationUnderstanding {
  return {
    conversation_stage: "discovery",
    lead_signal: "neutral",
    customer_goal: null,
    budget: null,
    experience: null,
    personal_training_interest: null,
    package_interest: null,
    preferred_workout_time: null,
    confidence: 0,
    memory_updates: {},
  };
}

function sanitizeUnderstanding(
  understanding: unknown,
): ConversationUnderstanding | null {
  if (!understanding || typeof understanding !== "object") return null;
  const raw = understanding as Record<string, unknown>;

  if (!isEnumValue(raw.conversation_stage, CONVERSATION_STAGES)) return null;

  const confidence = parseNullableNumber(raw.confidence);
  if (confidence === null) return null;
  const boundedConfidence = Math.max(0, Math.min(1, confidence));

  const leadSignal: LeadSignal = isEnumValue(raw.lead_signal, LEAD_SIGNALS)
    ? raw.lead_signal
    : "neutral";

  const customerGoal = isEnumValue(raw.customer_goal, FITNESS_GOALS)
    ? raw.customer_goal
    : null;
  const budget = parseNullableNumber(raw.budget);
  const experience = isEnumValue(raw.experience, EXPERIENCE_LEVELS)
    ? raw.experience
    : null;
  const personalTraining = isEnumValue(raw.personal_training_interest, PT_INTERESTS)
    ? raw.personal_training_interest
    : null;
  const packageInterest =
    typeof raw.package_interest === "string" && raw.package_interest.trim() !== ""
      ? raw.package_interest.trim()
      : null;
  const preferredWorkoutTime = isEnumValue(raw.preferred_workout_time, WORKOUT_TIMES)
    ? raw.preferred_workout_time
    : null;
  const memoryUpdates = parseUnderstandingMemoryUpdates(raw.memory_updates);

  let conversationStage: ConversationStage = raw.conversation_stage;
  if (conversationStage === "handoff") {
    if (
      memoryUpdates.visit_discussed ||
      memoryUpdates.trial_discussed ||
      packageInterest
    ) {
      conversationStage = "decision";
    } else {
      conversationStage = "consideration";
    }
  }

  return {
    conversation_stage: conversationStage,
    lead_signal: leadSignal,
    customer_goal: customerGoal,
    budget: budget !== null && budget > 0 ? Math.round(budget) : null,
    experience,
    personal_training_interest: personalTraining,
    package_interest: packageInterest,
    preferred_workout_time: preferredWorkoutTime,
    confidence: boundedConfidence,
    memory_updates: memoryUpdates,
  };
}

/**
 * Strips any leaked internal UUIDs or (ID <uuid>) tags from customer-facing text.
 */
export function stripInternalIdentifiers(text: string): string {
  return text
    .replace(
      /\s*\(\s*(?:branch\s*)?id[:\s]*[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\s*\)/gi,
      "",
    )
    .replace(
      /\s*\[\s*(?:branch\s*)?id[:\s]*[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\s*\]/gi,
      "",
    )
    .replace(
      /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi,
      "",
    )
    .replace(/\s{2,}/g, " ")
    .trim();
}

function sanitizeStructuredOutput(output: StructuredAIOutput | null): {
  reply: string | null;
  understanding: ConversationUnderstanding | null;
} {
  if (!output) {
    return { reply: null, understanding: null };
  }

  const rawReply =
    typeof output.reply === "string" && output.reply.trim() !== ""
      ? output.reply.trim()
      : null;
  const reply = rawReply ? stripInternalIdentifiers(rawReply) : null;
  const understanding = sanitizeUnderstanding(output.understanding);

  return { reply, understanding };
}

function buildFallback(reason: string): ValidatedResponse {
  return {
    approved: true,
    text: FALLBACK_REPLY,
    reason,
    understanding: defaultUnderstanding(),
    usedFallback: true,
    mediaActions: [],
    messageSequence: [],
    pendingMediaAssetId: null,
    pendingMedia: null,
    selectedBranchId: null,
    bookingAction: null,
  };
}

function parseMessageSequence(value: unknown): ValidatedResponse["messageSequence"] {
  if (!Array.isArray(value)) return [];
  const result: ValidatedResponse["messageSequence"] = [];
  for (const item of value.slice(0, 6)) {
    if (!item || typeof item !== "object") continue;
    const raw = item as Record<string, unknown>;
    if (raw.type === "text" && typeof raw.text === "string" && raw.text.trim())
      result.push({ type: "text", text: stripInternalIdentifiers(raw.text.trim()) });
    if (raw.type === "image" && typeof raw.asset_id === "string" && raw.asset_id.trim())
      result.push({
        type: "image",
        assetId: raw.asset_id.trim(),
        caption:
          typeof raw.caption === "string" && raw.caption.trim()
            ? raw.caption.trim()
            : null,
      });
  }
  return result;
}

function parseMediaActions(
  value: unknown,
): Array<{ assetId: string; caption: string | null }> {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 3).flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const raw = item as Record<string, unknown>;
    if (typeof raw.asset_id !== "string" || raw.asset_id.trim() === "") return [];
    return [
      {
        assetId: raw.asset_id.trim(),
        caption:
          typeof raw.caption === "string" && raw.caption.trim()
            ? raw.caption.trim()
            : null,
      },
    ];
  });
}

function parseSelectedBranchId(value: unknown): string | null {
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
    ? value
    : null;
}

function parsePendingMediaAssetId(value: unknown): string | null {
  return parseSelectedBranchId(value);
}

const VALID_BOOKING_ACTIONS: AIBookingActionType[] = [
  "create",
  "reschedule",
  "cancel",
  "check_availability",
];
const VALID_BOOKING_TYPES: BookingType[] = [
  "gym_visit",
  "trial_session",
  "pt_consultation",
  "pt_session",
];

function parseBookingAction(value: unknown): AIBookingAction | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  if (
    typeof raw.action !== "string" ||
    !VALID_BOOKING_ACTIONS.includes(raw.action as AIBookingActionType)
  ) {
    return null;
  }

  const action = raw.action as AIBookingActionType;
  const bookingType =
    typeof raw.booking_type === "string" &&
    VALID_BOOKING_TYPES.includes(raw.booking_type as BookingType)
      ? (raw.booking_type as BookingType)
      : null;
  const trainerName =
    typeof raw.trainer_name === "string" && raw.trainer_name.trim()
      ? raw.trainer_name.trim()
      : null;
  const requestedDate =
    typeof raw.requested_date === "string" && raw.requested_date.trim()
      ? raw.requested_date.trim()
      : null;
  const requestedTime =
    typeof raw.requested_time === "string" && raw.requested_time.trim()
      ? raw.requested_time.trim()
      : null;
  const durationMinutes =
    typeof raw.duration_minutes === "number" &&
    [30, 45, 60, 90].includes(raw.duration_minutes)
      ? raw.duration_minutes
      : null;

  return {
    action,
    booking_type: bookingType,
    trainer_name: trainerName,
    requested_date: requestedDate,
    requested_time: requestedTime,
    duration_minutes: durationMinutes,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function validateAIResponse(response: AIResponse): ValidatedResponse {
  const { reply, understanding } = sanitizeStructuredOutput(response.output);

  if (response.parseError || !reply || !understanding) {
    const reason = response.parseError
      ? `Structured JSON parse failed: ${response.parseError}`
      : "Structured JSON validation failed.";
    console.error("[Response Validator] Falling back to safe reply:", reason);
    return buildFallback(reason);
  }

  const wordCount = countWords(reply);
  if (wordCount > MAX_WORDS) {
    return buildFallback(`Response exceeds ${MAX_WORDS} words (${wordCount} words).`);
  }

  const banned = findBannedPhrase(reply);
  if (banned) {
    return buildFallback(`Response contains a disallowed phrase: "${banned}".`);
  }

  return {
    approved: true,
    text: reply,
    reason: null,
    understanding,
    usedFallback: false,
    mediaActions: parseMediaActions(
      (response.output as StructuredAIOutput).media_actions,
    ),
    messageSequence: parseMessageSequence(
      (response.output as StructuredAIOutput).message_sequence,
    ),
    pendingMediaAssetId: parsePendingMediaAssetId(
      (response.output as StructuredAIOutput).pending_media_asset_id,
    ),
    pendingMedia: null,
    selectedBranchId: parseSelectedBranchId(
      (response.output as StructuredAIOutput).selected_branch_id,
    ),
    bookingAction: parseBookingAction(
      (response.output as StructuredAIOutput).booking_action,
    ),
  };
}
