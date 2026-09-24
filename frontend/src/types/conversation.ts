import type { ConversationMemory } from "@/types/conversation-memory";
import type { ConversationUnderstanding } from "@/types/understanding";

/** Allowed values for the conversation status field. */
export type ConversationStatus = "active" | "human" | "closed";

/** The channel that supplied the customer's message. */
export type ConversationSource =
  "whatsapp" | "sms" | "simulator" | "playground" | "import";

/** Allowed values for the lead pipeline stage field. */
export type LeadStage = "new_lead" | "qualified" | "trial_booked" | "member" | "lost";

/** The active-lead rule used by the operational Leads workspace. */
export function isLeadStage(stage: LeadStage) {
  return stage !== "member" && stage !== "lost";
}

/** Full conversation row returned from Supabase. */
export type Conversation = {
  id: string;
  gym_id: string;
  /** Nullable: null until the customer establishes their preferred branch. */
  branch_id: string | null;
  /** WhatsApp endpoint / destination this conversation arrived on. */
  whatsapp_endpoint_id?: string | null;
  /** SMS endpoint / destination this conversation arrived on. */
  sms_endpoint_id?: string | null;
  customer_phone: string;
  customer_name: string | null;
  source: ConversationSource;
  status: ConversationStatus;
  lead_stage: LeadStage;
  /** Permanent timestamp set when the existing AI lead flow first identifies this lead. */
  ai_lead_at?: string | null;
  last_message_at: string;
  ai_enabled: boolean;
  intent: string | null;
  intent_confidence: number | null;
  customer_memory: ConversationMemory | null;
  latest_understanding: ConversationUnderstanding | null;
  created_at: string;
  updated_at: string;
};

/** Payload for creating a new conversation. */
export type CreateConversationPayload = {
  gym_id: string;
  branch_id?: string | null;
  whatsapp_endpoint_id?: string | null;
  sms_endpoint_id?: string | null;
  customer_phone: string;
  customer_name?: string | null;
  source?: ConversationSource;
  status?: ConversationStatus;
  lead_stage?: LeadStage;
  ai_lead_at?: string | null;
  last_message_at?: string;
  ai_enabled?: boolean;
  intent?: string | null;
  intent_confidence?: number | null;
  customer_memory?: ConversationMemory | null;
  latest_understanding?: ConversationUnderstanding | null;
};

/** Payload for updating an existing conversation. All fields are optional. */
export type UpdateConversationPayload = Partial<
  Omit<CreateConversationPayload, "gym_id">
>;
