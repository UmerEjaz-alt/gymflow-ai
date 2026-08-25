/**
 * Structured customer information remembered across a conversation.
 * Every field is optional and should only be set when confidently known.
 */
export type FitnessGoal =
  | "weight_loss"
  | "muscle_gain"
  | "general_fitness"
  | "strength"
  | "endurance";

export type PreferredWorkoutTime = "morning" | "afternoon" | "evening" | "night";

export type ExperienceLevel = "beginner" | "intermediate" | "advanced";

export type PersonalTrainingInterest = "yes" | "no" | "unknown";

export type ConversationMemory = {
  customer_name?:              string;
  fitness_goal?:               FitnessGoal;
  budget?:                     number;
  preferred_workout_time?:     PreferredWorkoutTime;
  experience_level?:           ExperienceLevel;
  interested_package?:         string;
  personal_training_interest?: PersonalTrainingInterest;
  trial_discussed?:            boolean;
  visit_discussed?:            boolean;
};
