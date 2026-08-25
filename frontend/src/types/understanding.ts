import type {
  ConversationMemory,
  ExperienceLevel,
  FitnessGoal,
  PersonalTrainingInterest,
  PreferredWorkoutTime,
} from "@/types/conversation-memory";

export type ConversationStage =
  "greeting" | "discovery" | "consideration" | "decision" | "handoff";

export type LeadSignal =
  | "neutral"
  | "interest"
  | "high_intent"
  | "visit_inquiry"
  | "visit_commitment"
  | "rejection"
  | "reengagement";

export type UnderstandingMemoryUpdates = Partial<ConversationMemory>;

export type ConversationUnderstanding = {
  conversation_stage: ConversationStage;
  lead_signal: LeadSignal;
  customer_goal: FitnessGoal | null;
  budget: number | null;
  experience: ExperienceLevel | null;
  personal_training_interest: PersonalTrainingInterest | null;
  package_interest: string | null;
  preferred_workout_time: PreferredWorkoutTime | null;
  confidence: number;
  memory_updates: UnderstandingMemoryUpdates;
};

export type StructuredAIOutput = {
  reply: string;
  understanding: ConversationUnderstanding;
  /** Optional media selected by the AI from the current gym knowledge. */
  media_actions?: Array<{ asset_id: string; caption?: string }>;
  /** Branch selected by the customer, only from the provided branch list. */
  selected_branch_id?: string;
};
