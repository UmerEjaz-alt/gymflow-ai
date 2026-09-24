import type { Branch } from "@/types/branch";
import type { Conversation } from "@/types/conversation";
import type { Trainer } from "@/types/trainer";

export type BookingType =
  "gym_visit" | "trial_session" | "pt_consultation" | "pt_session";

export type BookingStatus = "upcoming" | "completed" | "cancelled" | "no_show";

/** UI-only booking filter. Overdue bookings remain `upcoming` in storage. */
export type BookingStatusFilter = BookingStatus | "all" | "overdue";

export type BookingSource = "manual" | "whatsapp" | "sms";

export type BookingDuration = 30 | 45 | 60 | 90;

export type Booking = {
  id: string;
  gym_id: string;
  branch_id: string;
  conversation_id: string | null;
  trainer_id: string | null;
  customer_name: string;
  customer_phone: string | null;
  booking_type: BookingType;
  scheduled_at: string; // ISO UTC timestamptz string
  duration_minutes: number;
  status: BookingStatus;
  source: BookingSource;
  notes: string | null;
  cancelled_at: string | null;
  completed_at: string | null;
  no_show_at: string | null;
  created_at: string;
  updated_at: string;

  // Joined relations
  trainer?: Trainer | null;
  branch?: Branch | null;
  conversation?: Conversation | null;
};

export type CreateBookingPayload = {
  gym_id: string;
  branch_id: string;
  conversation_id?: string | null;
  trainer_id?: string | null;
  customer_name: string;
  customer_phone?: string | null;
  booking_type: BookingType;
  scheduled_at: string; // ISO UTC string
  duration_minutes: number;
  source?: BookingSource;
  notes?: string | null;
};

export type RescheduleBookingPayload = {
  scheduled_at: string;
  duration_minutes?: number;
};

export type UpdateBookingPayload = Partial<
  Omit<CreateBookingPayload, "gym_id" | "branch_id">
> & {
  status?: BookingStatus;
  cancelled_at?: string | null;
  completed_at?: string | null;
  no_show_at?: string | null;
};

export const BOOKING_TYPE_LABELS: Record<BookingType, string> = {
  gym_visit: "Gym Visit",
  trial_session: "Trial Session",
  pt_consultation: "PT Consultation",
  pt_session: "PT Session",
};

export const BOOKING_STATUS_LABELS: Record<BookingStatus, string> = {
  upcoming: "Upcoming",
  completed: "Completed",
  cancelled: "Cancelled",
  no_show: "No-show",
};

export const BOOKING_STATUS_FILTER_LABELS: Record<BookingStatusFilter, string> = {
  all: "All statuses",
  upcoming: "Upcoming",
  overdue: "Overdue",
  completed: "Completed",
  cancelled: "Cancelled",
  no_show: "No-show",
};

export const DEFAULT_DURATIONS: Record<BookingType, BookingDuration> = {
  gym_visit: 30,
  trial_session: 60,
  pt_consultation: 30,
  pt_session: 60,
};

export const ALLOWED_DURATIONS: BookingDuration[] = [30, 45, 60, 90];
