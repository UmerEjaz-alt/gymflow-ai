export type KnowledgeEntryCategory =
  | "trial_policy"
  | "guest_policy"
  | "membership_freeze"
  | "payment_methods"
  | "cancellation_rules"
  | "beginner_guidance"
  | "female_membership"
  | "peak_hours"
  | "general";

export type KnowledgeEntry = {
  id:         string;
  gym_id:     string;
  question:   string;
  answer:     string;
  category:   KnowledgeEntryCategory;
  active:     boolean;
  created_at: string;
  updated_at: string;
};

export type CreateKnowledgeEntryPayload = {
  gym_id:    string;
  question:  string;
  answer:    string;
  category?: KnowledgeEntryCategory;
  active?:   boolean;
};

export type UpdateKnowledgeEntryPayload = Partial<Omit<CreateKnowledgeEntryPayload, "gym_id">>;
