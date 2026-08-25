/** WhatsApp Endpoint / Destination */
export type WhatsAppEndpoint = {
  id: string;
  gym_id: string;
  /** Nullable: null means shared across the entire gym; non-null means dedicated to one branch. */
  branch_id: string | null;
  phone_number: string;
  phone_number_id: string | null;
  display_phone_number: string | null;
  label: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type CreateWhatsAppEndpointPayload = {
  gym_id: string;
  branch_id?: string | null;
  phone_number: string;
  phone_number_id?: string | null;
  display_phone_number?: string | null;
  label?: string | null;
  is_active?: boolean;
};

export type UpdateWhatsAppEndpointPayload = Partial<
  Omit<CreateWhatsAppEndpointPayload, "gym_id">
>;
