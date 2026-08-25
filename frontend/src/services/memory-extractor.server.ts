/**
 * Conversation Memory Extractor (deterministic, rule-based)
 *
 * Extracts high-confidence customer attributes from a single incoming message
 * and merges them into existing conversation memory without losing stronger
 * known values.
 */

import type {
  ConversationMemory,
  ExperienceLevel,
  FitnessGoal,
  PersonalTrainingInterest,
  PreferredWorkoutTime,
} from "@/types/conversation-memory";

type MemoryPatch = Partial<ConversationMemory>;

/**
 * Extracts high-confidence memory fields from a customer message.
 * Only returns fields that can be confidently inferred from explicit wording.
 */
export function extractMemoryPatch(message: string): MemoryPatch {
  const patch: MemoryPatch = {};
  const raw = message.trim();
  const norm = normalise(raw);

  if (!norm) return patch;

  const customerName = extractCustomerName(raw);
  if (customerName) {
    patch.customer_name = customerName;
  }

  const fitnessGoal = extractFitnessGoal(norm);
  if (fitnessGoal) {
    patch.fitness_goal = fitnessGoal;
  }

  const budget = extractBudget(raw, norm);
  if (budget !== null) {
    patch.budget = budget;
  }

  const preferredWorkoutTime = extractPreferredWorkoutTime(norm);
  if (preferredWorkoutTime) {
    patch.preferred_workout_time = preferredWorkoutTime;
  }

  const experienceLevel = extractExperienceLevel(norm);
  if (experienceLevel) {
    patch.experience_level = experienceLevel;
  }

  const interestedPackage = extractInterestedPackage(raw);
  if (interestedPackage) {
    patch.interested_package = interestedPackage;
  }

  const personalTrainingInterest = extractPersonalTrainingInterest(norm);
  if (personalTrainingInterest) {
    patch.personal_training_interest = personalTrainingInterest;
  }

  if (mentionsTrial(norm)) {
    patch.trial_discussed = true;
  }

  if (mentionsVisit(norm)) {
    patch.visit_discussed = true;
  }

  return patch;
}

/**
 * Merges a new memory patch into existing memory.
 * Returns changed=false when the resulting object is identical.
 */
export function mergeConversationMemory(
  existing: ConversationMemory | null | undefined,
  patch: MemoryPatch,
): { memory: ConversationMemory | null; changed: boolean } {
  const hasPatchValues = Object.keys(patch).length > 0;
  if (!hasPatchValues) {
    return { memory: existing ?? null, changed: false };
  }

  const base: ConversationMemory = existing ? { ...existing } : {};
  let changed = false;

  for (const [field, incoming] of Object.entries(patch) as Array<
    [keyof ConversationMemory, ConversationMemory[keyof ConversationMemory]]
  >) {
    if (incoming === undefined) continue;

    if (field === "personal_training_interest") {
      const current = base.personal_training_interest;
      const next = incoming as PersonalTrainingInterest;

      // Never downgrade a known yes/no preference to "unknown".
      if ((current === "yes" || current === "no") && next === "unknown") {
        continue;
      }
    }

    if (base[field] !== incoming) {
      base[field] = incoming as never;
      changed = true;
    }
  }

  if (!changed) {
    return { memory: existing ?? null, changed: false };
  }

  return { memory: base, changed: true };
}

// ---------------------------------------------------------------------------
// Extractors
// ---------------------------------------------------------------------------

function extractCustomerName(rawMessage: string): string | null {
  const match = rawMessage.match(
    /\b(?:my name is|this is|call me)\s+([a-z][a-z'\-]*(?:\s+[a-z][a-z'\-]*){0,3})\b/i,
  );
  if (!match) return null;
  return toTitleCase(match[1].trim());
}

function extractFitnessGoal(normalisedMessage: string): FitnessGoal | null {
  if (
    hasPhrase(normalisedMessage, [
      "lose weight",
      "weight loss",
      "fat loss",
      "burn fat",
      "slim down",
    ])
  ) {
    return "weight_loss";
  }

  if (
    hasPhrase(normalisedMessage, [
      "gain muscle",
      "muscle gain",
      "build muscle",
      "bulk up",
      "bodybuilding",
    ])
  ) {
    return "muscle_gain";
  }

  if (
    hasPhrase(normalisedMessage, [
      "build strength",
      "get stronger",
      "increase strength",
      "strength training",
      "powerlifting",
    ])
  ) {
    return "strength";
  }

  if (
    hasPhrase(normalisedMessage, [
      "improve stamina",
      "increase stamina",
      "better endurance",
      "build endurance",
      "cardio fitness",
    ])
  ) {
    return "endurance";
  }

  if (
    hasPhrase(normalisedMessage, [
      "general fitness",
      "stay fit",
      "keep fit",
      "overall fitness",
    ])
  ) {
    return "general_fitness";
  }

  return null;
}

function extractBudget(rawMessage: string, normalisedMessage: string): number | null {
  const budgetSignal = /\b(?:budget|range|can spend|spend up to|max(?:imum)?)\b/i;
  if (!budgetSignal.test(normalisedMessage)) return null;

  const match = rawMessage.match(
    /\b(?:budget|range|can spend|spend up to|max(?:imum)?)\b[^0-9]{0,20}([\d,]{3,9})\b/i,
  );
  if (!match) return null;

  const amount = Number(match[1].replace(/,/g, ""));
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return Math.round(amount);
}

function extractPreferredWorkoutTime(
  normalisedMessage: string,
): PreferredWorkoutTime | null {
  if (hasPhrase(normalisedMessage, ["morning", "in the morning", "am workout"])) {
    return "morning";
  }

  if (hasPhrase(normalisedMessage, ["afternoon", "in the afternoon"])) {
    return "afternoon";
  }

  if (hasPhrase(normalisedMessage, ["evening", "in the evening", "after work"])) {
    return "evening";
  }

  if (hasPhrase(normalisedMessage, ["night", "late night"])) {
    return "night";
  }

  return null;
}

function extractExperienceLevel(normalisedMessage: string): ExperienceLevel | null {
  if (
    hasPhrase(normalisedMessage, [
      "i am a beginner",
      "i am beginner",
      "beginner",
      "new to gym",
      "never worked out",
    ])
  ) {
    return "beginner";
  }

  if (
    hasPhrase(normalisedMessage, [
      "intermediate",
      "some experience",
      "been training for",
      "trained before",
    ])
  ) {
    return "intermediate";
  }

  if (
    hasPhrase(normalisedMessage, [
      "advanced",
      "experienced lifter",
      "athlete",
      "training for years",
    ])
  ) {
    return "advanced";
  }

  return null;
}

function extractInterestedPackage(rawMessage: string): string | null {
  const explicitInterestPattern =
    /\b(?:interested in|want|prefer|choose|go with)\s+([a-z0-9][a-z0-9\s\-]{1,40}?)\s+(?:package|plan)\b/i;
  const message = rawMessage.trim();

  const match = message.match(explicitInterestPattern);
  if (!match) return null;

  const cleaned = match[1]
    .trim()
    .replace(/\s+/g, " ")
    .replace(/\b(the|a|an)\b/gi, "")
    .trim();

  if (!cleaned) return null;
  return toTitleCase(cleaned);
}

function extractPersonalTrainingInterest(
  normalisedMessage: string,
): PersonalTrainingInterest | null {
  const hasPTTerm = hasPhrase(normalisedMessage, [
    "personal training",
    "personal trainer",
    "pt session",
    "private trainer",
    "pt",
  ]);

  if (!hasPTTerm) return null;

  if (
    hasPhrase(normalisedMessage, [
      "not interested in personal training",
      "dont want personal training",
      "do not want personal training",
      "without personal training",
      "no personal training",
      "no pt",
    ])
  ) {
    return "no";
  }

  if (
    hasPhrase(normalisedMessage, [
      "not sure about personal training",
      "unsure about personal training",
      "maybe personal training",
      "personal training maybe",
      "not decided on personal training",
    ])
  ) {
    return "unknown";
  }

  if (
    hasPhrase(normalisedMessage, [
      "interested in personal training",
      "want personal training",
      "need personal training",
      "yes personal training",
      "yes pt",
      "i want a personal trainer",
      "i need a personal trainer",
    ])
  ) {
    return "yes";
  }

  return null;
}

function mentionsTrial(normalisedMessage: string): boolean {
  return hasPhrase(normalisedMessage, [
    "trial",
    "free trial",
    "trial class",
    "demo session",
    "demo class",
  ]);
}

function mentionsVisit(normalisedMessage: string): boolean {
  return hasPhrase(normalisedMessage, [
    "visit",
    "walk in",
    "walk-in",
    "drop by",
    "come in",
    "come to gym",
  ]);
}

// ---------------------------------------------------------------------------
// Utility helpers
// ---------------------------------------------------------------------------

function hasPhrase(message: string, phrases: string[]): boolean {
  return phrases.some((phrase) => {
    const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(`(?:^|[^\\w])${escaped}(?:[^\\w]|$)`, "i");
    return pattern.test(message);
  });
}

function toTitleCase(value: string): string {
  return value
    .toLowerCase()
    .split(" ")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function normalise(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s']/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
