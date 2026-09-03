/** Shape of a single day's opening hours entry. */
export type DayHours = {
  open: string; // "HH:MM" in 24-hour format, e.g. "08:00"
  close: string; // "HH:MM" in 24-hour format, e.g. "22:00"
  closed: boolean;
};

/** Opening hours keyed by ISO weekday name. */
export type OpeningHours = {
  monday: DayHours;
  tuesday: DayHours;
  wednesday: DayHours;
  thursday: DayHours;
  friday: DayHours;
  saturday: DayHours;
  sunday: DayHours;
};

export type FAQ = {
  question: string;
  answer: string;
};

/** Full gym profile row returned from Supabase. */
export type Gym = {
  id: string;
  owner_user_id: string;
  gym_name: string;
  gym_description: string | null;
  logo_url: string | null;
  address: string | null;
  city: string | null;
  phone: string | null;
  email: string | null;
  whatsapp_number: string | null;
  opening_hours: OpeningHours | null;
  general_policies: string | null;
  trial_policy: string | null;
  visit_policy: string | null;
  faqs: FAQ[] | null;
  ai_communication_style: string | null;
  created_at: string;
  updated_at: string;
};

/** Payload for creating a new gym profile. */
export type CreateGymPayload = {
  gym_name: string;
  gym_description?: string | null;
  logo_url?: string | null;
  address?: string | null;
  city?: string | null;
  phone?: string | null;
  email?: string | null;
  whatsapp_number?: string | null;
  opening_hours?: OpeningHours | null;
  general_policies?: string | null;
  trial_policy?: string | null;
  visit_policy?: string | null;
  faqs?: FAQ[] | null;
  ai_communication_style?: string | null;
};

/** Payload for updating an existing gym profile. All fields are optional. */
export type UpdateGymPayload = Partial<CreateGymPayload>;
