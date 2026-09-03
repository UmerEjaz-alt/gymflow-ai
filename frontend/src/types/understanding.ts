import type {
  ConversationMemory,
  ExperienceLevel,
  FitnessGoal,
  PersonalTrainingInterest,
  PreferredWorkoutTime,
} from "@/types/conversation-memory";
import type { BookingType } from "@/types/booking";

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

export type AIBookingActionType =
  "create" | "reschedule" | "cancel" | "check_availability";

export type AIBookingAction = {
  action: AIBookingActionType;
  booking_type?: BookingType | null;
  trainer_name?: string | null;
  requested_date?: string | null; // e.g. "2026-08-30" or YYYY-MM-DD
  requested_time?: string | null; // e.g. "19:00" or HH:MM
  duration_minutes?: number | null;
};

export type StructuredAIOutput = {
  reply: string;
  understanding: ConversationUnderstanding;
  /** Optional media selected by the AI from the current gym knowledge. */
  media_actions?: Array<{ asset_id: string; caption?: string }>;
  message_sequence?: Array<
    | { type: "text"; text: string }
    | { type: "image"; asset_id: string; caption?: string }
  >;
  /** A listed asset offered for a possible immediate follow-up, but not sent yet. */
  pending_media_asset_id?: string;
  /** Branch selected by the customer, only from the provided branch list. */
  selected_branch_id?: string;
  /** Optional structured booking action requested by the customer. */
  booking_action?: AIBookingAction | null;
};
