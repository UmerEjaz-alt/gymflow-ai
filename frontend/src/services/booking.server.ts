import { createServerSupabaseClient } from "@/lib/supabase/server";
import type {
  Booking,
  BookingStatus,
  BookingType,
  CreateBookingPayload,
  RescheduleBookingPayload,
} from "@/types/booking";

type ServiceResult<T> = { data: T; error: null } | { data: null; error: string };

/**
 * Atomically claims a booking mutation for one persisted inbound message.
 * The unique source_message_id constraint is the cross-instance idempotency
 * boundary; it is deliberately independent of customer text or timestamps.
 */
export async function claimBookingAction(params: {
  gymId: string;
  conversationId: string;
  sourceMessageId: string;
  actionType: "create" | "reschedule" | "cancel";
}): Promise<{ claimed: boolean; error: string | null }> {
  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.from("booking_action_executions").insert({
    gym_id: params.gymId,
    conversation_id: params.conversationId,
    source_message_id: params.sourceMessageId,
    action_type: params.actionType,
  });

  if (!error) return { claimed: true, error: null };
  if (error.code === "23505") return { claimed: false, error: null };
  return { claimed: false, error: error.message };
}

/** Links a successful mutation to its already-claimed execution ledger row. */
export async function completeBookingAction(
  sourceMessageId: string,
  bookingId: string,
): Promise<{ error: string | null }> {
  const supabase = await createServerSupabaseClient();
  const { error } = await supabase
    .from("booking_action_executions")
    .update({ booking_id: bookingId })
    .eq("source_message_id", sourceMessageId);
  return { error: error?.message ?? null };
}

type BookingRow = Booking & {
  trainer: Booking["trainer"] | Booking["trainer"][];
  branch: Booking["branch"] | Booking["branch"][];
  conversation: Booking["conversation"] | Booking["conversation"][];
};

function normalizeBooking(row: BookingRow): Booking {
  return {
    ...row,
    trainer: Array.isArray(row.trainer)
      ? (row.trainer[0] ?? null)
      : (row.trainer ?? null),
    branch: Array.isArray(row.branch) ? (row.branch[0] ?? null) : (row.branch ?? null),
    conversation: Array.isArray(row.conversation)
      ? (row.conversation[0] ?? null)
      : (row.conversation ?? null),
  };
}

/**
 * Returns all bookings for a given branch within a gym.
 * RLS ensures the caller must own the target gym.
 */
export async function getBookingsForBranch(
  gymId: string,
  branchId: string,
  options?: {
    startDate?: string;
    endDate?: string;
    status?: BookingStatus | "all";
    trainerId?: string;
    type?: BookingType | "all";
    query?: string;
  },
): Promise<ServiceResult<Booking[]>> {
  const supabase = await createServerSupabaseClient();

  let q = supabase
    .from("bookings")
    .select("*, trainer:trainers(*), branch:branches(*), conversation:conversations(*)")
    .eq("gym_id", gymId)
    .eq("branch_id", branchId)
    .order("scheduled_at", { ascending: true });

  if (options?.startDate) {
    q = q.gte("scheduled_at", options.startDate);
  }
  if (options?.endDate) {
    q = q.lte("scheduled_at", options.endDate);
  }
  if (options?.status && options.status !== "all") {
    q = q.eq("status", options.status);
  }
  if (options?.trainerId) {
    q = q.eq("trainer_id", options.trainerId);
  }
  if (options?.type && options.type !== "all") {
    q = q.eq("booking_type", options.type);
  }

  const { data, error } = await q;

  if (error) {
    return { data: null, error: error.message };
  }

  let bookings = ((data ?? []) as BookingRow[]).map(normalizeBooking);

  if (options?.query && options.query.trim()) {
    const term = options.query.toLowerCase().trim();
    bookings = bookings.filter(
      (b) =>
        b.customer_name.toLowerCase().includes(term) ||
        (b.customer_phone && b.customer_phone.toLowerCase().includes(term)),
    );
  }

  return { data: bookings, error: null };
}

/**
 * Returns bookings spanning a date range (UTC ISO strings) for calendar / agenda queries.
 */
export async function getBookingsForDateRange(
  gymId: string,
  branchId: string,
  startDate: string,
  endDate: string,
): Promise<ServiceResult<Booking[]>> {
  return getBookingsForBranch(gymId, branchId, { startDate, endDate });
}

/**
 * Returns a single booking by id, with joined trainer, branch, and conversation.
 */
export async function getBooking(id: string): Promise<ServiceResult<Booking | null>> {
  const supabase = await createServerSupabaseClient();

  const { data, error } = await supabase
    .from("bookings")
    .select("*, trainer:trainers(*), branch:branches(*), conversation:conversations(*)")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    return { data: null, error: error.message };
  }

  if (!data) {
    return { data: null, error: null };
  }

  return { data: normalizeBooking(data as BookingRow), error: null };
}

/**
 * Checks if a trainer has an overlapping upcoming booking.
 * Overlap formula: existing_start < new_end AND existing_end > new_start
 */
export async function checkTrainerAvailability(
  gymId: string,
  branchId: string,
  trainerId: string,
  startIso: string,
  durationMinutes: number,
  excludeBookingId?: string,
): Promise<{ available: boolean; conflictMessage?: string }> {
  const supabase = await createServerSupabaseClient();

  const newStartMs = new Date(startIso).getTime();
  const newEndMs = newStartMs + durationMinutes * 60_000;

  // Query trainer's upcoming bookings
  let query = supabase
    .from("bookings")
    .select("id, scheduled_at, duration_minutes, trainer:trainers(full_name)")
    .eq("gym_id", gymId)
    .eq("branch_id", branchId)
    .eq("trainer_id", trainerId)
    .eq("status", "upcoming");

  if (excludeBookingId) {
    query = query.neq("id", excludeBookingId);
  }

  const { data: upcomingBookings, error } = await query;
  if (error || !upcomingBookings) {
    return { available: true };
  }

  for (const item of upcomingBookings) {
    const existingStartMs = new Date(item.scheduled_at).getTime();
    const existingEndMs = existingStartMs + (item.duration_minutes || 60) * 60_000;

    const isOverlap = existingStartMs < newEndMs && existingEndMs > newStartMs;
    if (isOverlap) {
      const trainerName =
        (Array.isArray(item.trainer)
          ? item.trainer[0]?.full_name
          : (item.trainer as { full_name?: string } | null)?.full_name) ||
        "This trainer";
      return {
        available: false,
        conflictMessage: `${trainerName} already has an appointment scheduled during this time.`,
      };
    }
  }

  return { available: true };
}

/**
 * Creates a new booking with tenant verification and trainer conflict detection.
 */
export async function createBooking(
  payload: CreateBookingPayload,
): Promise<ServiceResult<Booking>> {
  const supabase = await createServerSupabaseClient();

  // 1. Basic validation
  if (!payload.customer_name?.trim()) {
    return { data: null, error: "Customer name is required." };
  }
  if (!payload.scheduled_at) {
    return { data: null, error: "Scheduled date and time are required." };
  }
  if (![30, 45, 60, 90].includes(payload.duration_minutes)) {
    return { data: null, error: "Duration must be 30, 45, 60, or 90 minutes." };
  }

  // 2. Trainer-specific availability check
  if (payload.trainer_id) {
    const availability = await checkTrainerAvailability(
      payload.gym_id,
      payload.branch_id,
      payload.trainer_id,
      payload.scheduled_at,
      payload.duration_minutes,
    );
    if (!availability.available) {
      return {
        data: null,
        error: availability.conflictMessage || "Trainer is not available at this time.",
      };
    }
  }

  // 3. Insert booking
  const { data, error } = await supabase
    .from("bookings")
    .insert({
      gym_id: payload.gym_id,
      branch_id: payload.branch_id,
      conversation_id: payload.conversation_id || null,
      trainer_id: payload.trainer_id || null,
      customer_name: payload.customer_name.trim(),
      customer_phone: payload.customer_phone?.trim() || null,
      booking_type: payload.booking_type,
      scheduled_at: payload.scheduled_at,
      duration_minutes: payload.duration_minutes,
      status: "upcoming",
      source: payload.source || "manual",
      notes: payload.notes?.trim() || null,
    })
    .select("*, trainer:trainers(*), branch:branches(*), conversation:conversations(*)")
    .single();

  if (error) {
    // Handle database exclusion or integrity errors gracefully
    if (
      error.code === "23P01" ||
      error.message.includes("bookings_no_overlapping_trainer_bookings")
    ) {
      return {
        data: null,
        error: "This trainer already has an overlapping booking at this time.",
      };
    }
    return { data: null, error: error.message };
  }

  return { data: normalizeBooking(data as BookingRow), error: null };
}

/**
 * Reschedules an upcoming booking.
 */
export async function rescheduleBooking(
  id: string,
  payload: RescheduleBookingPayload,
): Promise<ServiceResult<Booking>> {
  const supabase = await createServerSupabaseClient();

  // 1. Fetch current booking
  const existing = await getBooking(id);
  if (existing.error || !existing.data) {
    return { data: null, error: existing.error || "Booking not found." };
  }

  const current = existing.data;
  if (current.status !== "upcoming") {
    return {
      data: null,
      error: `Cannot reschedule a booking that is already ${current.status}.`,
    };
  }

  const duration = payload.duration_minutes ?? current.duration_minutes;

  // 2. Check trainer conflict if trainer is assigned
  if (current.trainer_id) {
    const availability = await checkTrainerAvailability(
      current.gym_id,
      current.branch_id,
      current.trainer_id,
      payload.scheduled_at,
      duration,
      current.id,
    );
    if (!availability.available) {
      return {
        data: null,
        error:
          availability.conflictMessage || "Trainer is not available at this new time.",
      };
    }
  }

  // 3. Update booking
  const { data, error } = await supabase
    .from("bookings")
    .update({
      scheduled_at: payload.scheduled_at,
      duration_minutes: duration,
    })
    .eq("id", id)
    .select("*, trainer:trainers(*), branch:branches(*), conversation:conversations(*)")
    .single();

  if (error) {
    if (
      error.code === "23P01" ||
      error.message.includes("bookings_no_overlapping_trainer_bookings")
    ) {
      return {
        data: null,
        error: "This trainer already has an overlapping booking at this time.",
      };
    }
    return { data: null, error: error.message };
  }

  return { data: normalizeBooking(data as BookingRow), error: null };
}

/**
 * Cancels an upcoming booking.
 */
export async function cancelBooking(id: string): Promise<ServiceResult<Booking>> {
  const supabase = await createServerSupabaseClient();

  const existing = await getBooking(id);
  if (existing.error || !existing.data) {
    return { data: null, error: existing.error || "Booking not found." };
  }

  if (existing.data.status !== "upcoming") {
    return {
      data: null,
      error: `Cannot cancel a booking that is already ${existing.data.status}.`,
    };
  }

  const { data, error } = await supabase
    .from("bookings")
    .update({
      status: "cancelled",
      cancelled_at: new Date().toISOString(),
    })
    .eq("id", id)
    .select("*, trainer:trainers(*), branch:branches(*), conversation:conversations(*)")
    .single();

  if (error) return { data: null, error: error.message };
  return { data: normalizeBooking(data as BookingRow), error: null };
}

/**
 * Marks an upcoming booking as completed.
 */
export async function markBookingCompleted(
  id: string,
): Promise<ServiceResult<Booking>> {
  const supabase = await createServerSupabaseClient();

  const existing = await getBooking(id);
  if (existing.error || !existing.data) {
    return { data: null, error: existing.error || "Booking not found." };
  }

  if (existing.data.status !== "upcoming") {
    return {
      data: null,
      error: `Cannot complete a booking that is already ${existing.data.status}.`,
    };
  }

  const { data, error } = await supabase
    .from("bookings")
    .update({
      status: "completed",
      completed_at: new Date().toISOString(),
    })
    .eq("id", id)
    .select("*, trainer:trainers(*), branch:branches(*), conversation:conversations(*)")
    .single();

  if (error) return { data: null, error: error.message };
  return { data: normalizeBooking(data as BookingRow), error: null };
}

/**
 * Marks an upcoming booking as no-show.
 */
export async function markBookingNoShow(id: string): Promise<ServiceResult<Booking>> {
  const supabase = await createServerSupabaseClient();

  const existing = await getBooking(id);
  if (existing.error || !existing.data) {
    return { data: null, error: existing.error || "Booking not found." };
  }

  if (existing.data.status !== "upcoming") {
    return {
      data: null,
      error: `Cannot mark no-show on a booking that is already ${existing.data.status}.`,
    };
  }

  const { data, error } = await supabase
    .from("bookings")
    .update({
      status: "no_show",
      no_show_at: new Date().toISOString(),
    })
    .eq("id", id)
    .select("*, trainer:trainers(*), branch:branches(*), conversation:conversations(*)")
    .single();

  if (error) return { data: null, error: error.message };
  return { data: normalizeBooking(data as BookingRow), error: null };
}

/**
 * Returns all upcoming bookings for a specific conversation/customer, ordered by scheduled_at ascending.
 */
export async function getUpcomingBookingsForConversation(
  gymId: string,
  branchId: string | null,
  conversationId: string,
): Promise<ServiceResult<Booking[]>> {
  const supabase = await createServerSupabaseClient();

  let q = supabase
    .from("bookings")
    .select("*, trainer:trainers(*), branch:branches(*), conversation:conversations(*)")
    .eq("gym_id", gymId)
    .eq("conversation_id", conversationId)
    .eq("status", "upcoming")
    .order("scheduled_at", { ascending: true });

  if (branchId) {
    q = q.eq("branch_id", branchId);
  }

  const { data, error } = await q;
  if (error) return { data: null, error: error.message };
  return { data: ((data ?? []) as BookingRow[]).map(normalizeBooking), error: null };
}
