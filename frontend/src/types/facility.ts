export type Facility = {
  id: string;
  gym_id: string;
  branch_id: string;
  name: string;
  description: string | null;
  available: boolean;
  package_restrictions: string[];
  active: boolean;
  created_at: string;
  updated_at: string;
};

export type CreateFacilityPayload = {
  gym_id: string;
  branch_id: string;
  name: string;
  description?: string | null;
  available?: boolean;
  package_restrictions?: string[];
  active?: boolean;
};

export type UpdateFacilityPayload = Partial<Omit<CreateFacilityPayload, "gym_id">>;
