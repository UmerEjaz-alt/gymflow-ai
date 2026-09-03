/** Full trainer row returned from Supabase. */
export type Trainer = {
  id: string;
  gym_id: string;
  branch_id: string;
  full_name: string;
  specialization: string | null;
  experience_years: number | null;
  availability: string | null;
  bio: string | null;
  profile_photo_url: string | null;
  phone: string | null;
  email: string | null;
  accepting_new_clients: boolean;
  active: boolean;
  created_at: string;
  updated_at: string;
};

/** Payload for creating a new trainer. */
export type CreateTrainerPayload = {
  gym_id: string;
  branch_id: string;
  full_name: string;
  specialization?: string | null;
  experience_years?: number | null;
  availability?: string | null;
  bio?: string | null;
  profile_photo_url?: string | null;
  phone?: string | null;
  email?: string | null;
  accepting_new_clients?: boolean;
  active?: boolean;
};

/** Payload for updating an existing trainer. All fields are optional. */
export type UpdateTrainerPayload = Partial<Omit<CreateTrainerPayload, "gym_id">>;
