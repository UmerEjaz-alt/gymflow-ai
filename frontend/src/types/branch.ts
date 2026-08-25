import type { FAQ, OpeningHours } from "@/types/gym";

/** Full branch row returned from Supabase. */
export type Branch = {
  id: string;
  gym_id: string;
  branch_name: string;
  is_default: boolean;

  // Location & contact
  address: string | null;
  city: string | null;
  phone: string | null;
  whatsapp_number: string | null;
  /** Meta WhatsApp Cloud API phone-number ID. Kept server-side for webhook routing. */
  whatsapp_phone_number_id: string | null;
  google_maps_url: string | null;

  // Hours
  opening_hours: OpeningHours | null;

  // Policies
  general_policies: string | null;
  trial_policy: string | null;
  visit_policy: string | null;
  refund_policy: string | null;
  freeze_policy: string | null;
  cancellation_policy: string | null;
  guest_policy: string | null;
  membership_transfer_policy: string | null;

  // AI knowledge
  faqs: FAQ[];
  ai_communication_style: string | null;
  ai_instructions: string | null;

  created_at: string;
  updated_at: string;
};

export type CreateBranchPayload = {
  gym_id: string;
  branch_name: string;
  is_default?: boolean;
  address?: string | null;
  city?: string | null;
  phone?: string | null;
  whatsapp_number?: string | null;
  whatsapp_phone_number_id?: string | null;
  google_maps_url?: string | null;
  opening_hours?: OpeningHours | null;
  general_policies?: string | null;
  trial_policy?: string | null;
  visit_policy?: string | null;
  refund_policy?: string | null;
  freeze_policy?: string | null;
  cancellation_policy?: string | null;
  guest_policy?: string | null;
  membership_transfer_policy?: string | null;
  faqs?: FAQ[];
  ai_communication_style?: string | null;
  ai_instructions?: string | null;
};

export type UpdateBranchPayload = Partial<Omit<CreateBranchPayload, "gym_id">>;
