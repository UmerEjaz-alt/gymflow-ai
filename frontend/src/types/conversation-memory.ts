import type { BookingType } from "@/types/booking";

/**
 * Structured customer information remembered across a conversation.
 * Every field is optional and should only be set when confidently known.
 */
export type FitnessGoal =
  "weight_loss" | "muscle_gain" | "general_fitness" | "strength" | "endurance";

export type PreferredWorkoutTime = "morning" | "afternoon" | "evening" | "night";

export type ExperienceLevel = "beginner" | "intermediate" | "advanced";

export type PersonalTrainingInterest = "yes" | "no" | "unknown";

/** Compact structured draft for accumulating multi-turn booking details. */
export type PendingBookingDraft = {
  action?: "create" | "reschedule" | "cancel" | "check_availability" | null;
  booking_type?: BookingType | null;
  trainer_name?: string | null;
  requested_date?: string | null; // e.g. "2026-08-30" or YYYY-MM-DD
  requested_time?: string | null; // e.g. "19:00" or HH:MM
  duration_minutes?: number | null;
};

export type ConversationMemory = {
  customer_name?: string;
  fitness_goal?: FitnessGoal;
  budget?: number;
  preferred_workout_time?: PreferredWorkoutTime;
  experience_level?: ExperienceLevel;
  interested_package?: string;
  personal_training_interest?: PersonalTrainingInterest;
  trial_discussed?: boolean;
  visit_discussed?: boolean;
  pending_booking?: PendingBookingDraft | null;
};
