/** SMS destination owned by a gym, optionally dedicated to one branch. */
export type SmsEndpoint = {
  id: string;
  gym_id: string;
  branch_id: string | null;
  phone_number: string;
  provider: string;
  provider_number_id: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type CreateSmsEndpointPayload = {
  gym_id: string;
  branch_id?: string | null;
  phone_number: string;
  provider: string;
  provider_number_id?: string | null;
  is_active?: boolean;
};

export type UpdateSmsEndpointPayload = Partial<
  Omit<CreateSmsEndpointPayload, "gym_id">
>;
