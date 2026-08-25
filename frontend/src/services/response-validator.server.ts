/**
 * Response Validator
 *
 * Validates AI structured JSON output and produces a safe reply + understanding
 * payload for downstream persistence.
 */

import type { AIResponse } from "@/services/ai-provider";
import type {
  ConversationStage,
  ConversationUnderstanding,
  LeadSignal,
  StructuredAIOutput,
  UnderstandingMemoryUpdates,
} from "@/types/understanding";
import type {
  ExperienceLevel,
  FitnessGoal,
  PersonalTrainingInterest,
  PreferredWorkoutTime,
} from "@/types/conversation-memory";

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
  selectedBranchId: string | null;
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
    selectedBranchId: null,
  };
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
    selectedBranchId: parseSelectedBranchId(
      (response.output as StructuredAIOutput).selected_branch_id,
    ),
  };
}
