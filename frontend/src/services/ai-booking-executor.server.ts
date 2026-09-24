/**
 * AI Booking Executor
 *
 * Authoritative server-side executor for structured booking actions generated
 * by the AI conversation pipeline.
 *
 * Guarantees:
 * - Gemini never writes directly to the database.
 * - Gemini never invents booking IDs or availability.
 * - Dates and times are interpreted in the branch's IANA timezone.
 * - The booking service and database enforce atomic trainer conflict protection.
 * - Confirmations are delivered only after successful server/DB execution.
 */

import {
  cancelBooking,
  claimBookingAction,
  checkTrainerAvailability,
  completeBookingAction,
  createBooking,
  getUpcomingBookingsForConversation,
  rescheduleBooking,
} from "@/services/booking.server";
import { zonedLocalInputToIso } from "@/lib/zoned-datetime";
import type { AIBookingAction } from "@/types/understanding";
import type { Booking, BookingType, CreateBookingPayload } from "@/types/booking";
import { BOOKING_TYPE_LABELS, DEFAULT_DURATIONS } from "@/types/booking";
import type { Branch } from "@/types/branch";
import type { Conversation } from "@/types/conversation";
import type { ConversationMemory } from "@/types/conversation-memory";
import type { Gym } from "@/types/gym";
import type { ResolvedTurnContext } from "@/services/knowledge-layer.server";
import type { Trainer } from "@/types/trainer";

export type AIBookingExecutionResult = {
  executed: boolean;
  success: boolean;
  responseText: string;
  clearedPendingBooking: boolean;
  booking: Booking | null;
};

/**
 * Executes a structured booking action requested by the customer in a conversation.
 */
export async function executeAIBookingAction(params: {
  action: AIBookingAction;
  turn: ResolvedTurnContext;
  conversation: Conversation;
  gym: Gym;
  branch: Branch | null;
  allBranches: Branch[];
  trainers: Trainer[];
  customerMemory: ConversationMemory | null;
  sourceMessageId: string;
}): Promise<AIBookingExecutionResult> {
  const {
    action,
    turn,
    conversation,
    gym,
    branch,
    allBranches,
    trainers,
    customerMemory,
    sourceMessageId,
  } = params;

  // 1. Resolve Effective Branch
  const branchId =
    turn.effectiveBranchId ||
    conversation.branch_id ||
    branch?.id ||
    (allBranches.length === 1 ? allBranches[0]?.id : null);

  if (!branchId) {
    return {
      executed: true,
      success: false,
      responseText:
        "Which of our branches would you like to schedule your appointment at?",
      clearedPendingBooking: false,
      booking: null,
    };
  }

  const effectiveBranch = allBranches.find((b) => b.id === branchId) || branch;
  const timezone = effectiveBranch?.timezone || "Asia/Karachi";
  const branchName = effectiveBranch?.branch_name || "the gym";

  // 2. Resolve Trainer from the authoritative turn state first. The optional
  // action name is only a narrow exact-name fallback when no trainer entity
  // was already resolved for this turn.
  let resolvedTrainer: Trainer | null = null;
  const branchTrainers = trainers.filter((t) => t.branch_id === branchId && t.active);

  if (turn.entity?.type === "trainer") {
    resolvedTrainer = branchTrainers.find((t) => t.id === turn.entity!.id) || null;
    if (!resolvedTrainer) {
      return {
        executed: true,
        success: false,
        responseText:
          "I couldn't confirm that trainer for this branch. Which trainer would you like?",
        clearedPendingBooking: false,
        booking: null,
      };
    }
  } else if (action.trainer_name) {
    const normalizedName = normalizeTrainerName(action.trainer_name);
    const matches = branchTrainers.filter(
      (trainer) => normalizeTrainerName(trainer.full_name) === normalizedName,
    );
    if (matches.length === 1) {
      resolvedTrainer = matches[0]!;
    } else if (matches.length > 1) {
      const names = matches.map((t) => t.full_name).join(" or ");
      return {
        executed: true,
        success: false,
        responseText: `We have multiple trainers matching "${action.trainer_name}" (${names}). Which trainer would you like?`,
        clearedPendingBooking: false,
        booking: null,
      };
    } else {
      return {
        executed: true,
        success: false,
        responseText: `I couldn't identify trainer "${action.trainer_name}" at our ${branchName} branch. Which trainer would you like?`,
        clearedPendingBooking: false,
        booking: null,
      };
    }
  }

  // 3. Resolve Date & Time in Branch Timezone
  let scheduledAtUtc: string | null = null;
  let formattedDisplayTime: string | null = null;

  if (action.requested_date && action.requested_time) {
    const rawDate = action.requested_date.trim();
    let rawTime = action.requested_time.trim();

    // Standardize time (e.g. "7:00" -> "07:00")
    if (/^\d:\d{2}$/.test(rawTime)) {
      rawTime = "0" + rawTime;
    }

    const localDateTimeStr = `${rawDate}T${rawTime}`;
    scheduledAtUtc = zonedLocalInputToIso(localDateTimeStr, timezone);

    if (scheduledAtUtc) {
      // Validate not in the past
      if (new Date(scheduledAtUtc).getTime() < Date.now() - 5 * 60_000) {
        return {
          executed: true,
          success: false,
          responseText:
            "That date and time has already passed. What date and time would you prefer?",
          clearedPendingBooking: false,
          booking: null,
        };
      }

      formattedDisplayTime = formatFriendlyDateTime(scheduledAtUtc, timezone);
    }
  }

  // 4. Handle Action Types
  switch (action.action) {
    case "check_availability": {
      if (!scheduledAtUtc || !formattedDisplayTime) {
        return {
          executed: true,
          success: false,
          responseText: "What date and time would you like to check availability for?",
          clearedPendingBooking: false,
          booking: null,
        };
      }

      const duration = action.duration_minutes || 60;
      if (resolvedTrainer) {
        const check = await checkTrainerAvailability(
          gym.id,
          branchId,
          resolvedTrainer.id,
          scheduledAtUtc,
          duration,
        );
        if (check.available) {
          return {
            executed: true,
            success: true,
            responseText: `Yes, ${resolvedTrainer.full_name} is available on ${formattedDisplayTime} at our ${branchName} branch. Would you like me to book this session for you?`,
            clearedPendingBooking: false,
            booking: null,
          };
        } else {
          return {
            executed: true,
            success: true,
            responseText: `${resolvedTrainer.full_name} is already booked on ${formattedDisplayTime}. Would you like to try another time?`,
            clearedPendingBooking: false,
            booking: null,
          };
        }
      }

      return {
        executed: true,
        success: true,
        responseText: `Yes, ${formattedDisplayTime} is open at ${branchName}. Would you like me to book your visit?`,
        clearedPendingBooking: false,
        booking: null,
      };
    }

    case "create": {
      const bookingType: BookingType = action.booking_type || "gym_visit";
      const isPt = bookingType === "pt_session" || bookingType === "pt_consultation";

      if (isPt && !resolvedTrainer) {
        if (branchTrainers.length > 0) {
          const trainerList = branchTrainers.map((t) => t.full_name).join(", ");
          return {
            executed: true,
            success: false,
            responseText: `Which trainer would you like to book your ${BOOKING_TYPE_LABELS[bookingType]} with? Available trainers: ${trainerList}.`,
            clearedPendingBooking: false,
            booking: null,
          };
        }
      }

      if (!scheduledAtUtc || !formattedDisplayTime) {
        return {
          executed: true,
          success: false,
          responseText: `Sure! What date and time would you like for your ${BOOKING_TYPE_LABELS[bookingType]}?`,
          clearedPendingBooking: false,
          booking: null,
        };
      }

      const duration = action.duration_minutes || DEFAULT_DURATIONS[bookingType] || 30;
      const customerName =
        conversation.customer_name || customerMemory?.customer_name || "Customer";
      const bookingSource = conversation.source === "sms" ? "sms" : "whatsapp";

      const payload: CreateBookingPayload = {
        gym_id: gym.id,
        branch_id: branchId,
        conversation_id: conversation.id,
        trainer_id: resolvedTrainer ? resolvedTrainer.id : null,
        customer_name: customerName,
        customer_phone: conversation.customer_phone || null,
        booking_type: bookingType,
        scheduled_at: scheduledAtUtc,
        duration_minutes: duration,
        source: bookingSource,
        notes:
          bookingSource === "sms"
            ? "Booked via SMS conversation"
            : "Booked via WhatsApp conversation",
      };

      const claim = await claimBookingMutation(
        gym.id,
        conversation.id,
        sourceMessageId,
        "create",
      );
      if (claim) return claim;

      const result = await createBooking(payload);

      if (result.error) {
        if (
          result.error.toLowerCase().includes("overlapping") ||
          result.error.toLowerCase().includes("already has") ||
          result.error.toLowerCase().includes("conflict")
        ) {
          const tName = resolvedTrainer?.full_name || "This trainer";
          return {
            executed: true,
            success: false,
            responseText: `${tName} is already booked on ${formattedDisplayTime}. Would you like to choose another time?`,
            clearedPendingBooking: false,
            booking: null,
          };
        }

        return {
          executed: true,
          success: false,
          responseText: `We couldn't complete the booking: ${result.error}. Would you like to try a different time?`,
          clearedPendingBooking: false,
          booking: null,
        };
      }

      const typeLabel = BOOKING_TYPE_LABELS[bookingType];
      await completeBookingAction(sourceMessageId, result.data!.id);
      const withTrainer = resolvedTrainer ? ` with ${resolvedTrainer.full_name}` : "";

      return {
        executed: true,
        success: true,
        responseText: `Done! Your ${typeLabel}${withTrainer} is booked for ${formattedDisplayTime} at our ${branchName} branch. See you then!`,
        clearedPendingBooking: true,
        booking: result.data,
      };
    }

    case "reschedule": {
      const upcomingRes = await getUpcomingBookingsForConversation(
        gym.id,
        branchId,
        conversation.id,
      );

      const upcoming = upcomingRes.data || [];
      if (upcoming.length === 0) {
        return {
          executed: true,
          success: false,
          responseText:
            "I couldn't find any upcoming booking under your number to reschedule.",
          clearedPendingBooking: true,
          booking: null,
        };
      }

      if (upcoming.length > 1) {
        const list = upcoming
          .map(
            (b, i) =>
              `${i + 1}. ${BOOKING_TYPE_LABELS[b.booking_type]}${b.trainer ? ` with ${b.trainer.full_name}` : ""} on ${formatFriendlyDateTime(b.scheduled_at, timezone)}`,
          )
          .join("\n");
        return {
          executed: true,
          success: false,
          responseText: `You have multiple upcoming appointments:\n${list}\nWhich one would you like to reschedule?`,
          clearedPendingBooking: false,
          booking: null,
        };
      }

      const target = upcoming[0]!;

      if (!scheduledAtUtc || !formattedDisplayTime) {
        return {
          executed: true,
          success: false,
          responseText: `Sure! What new date and time would you like to move your ${BOOKING_TYPE_LABELS[target.booking_type]} to?`,
          clearedPendingBooking: false,
          booking: null,
        };
      }

      const claim = await claimBookingMutation(
        gym.id,
        conversation.id,
        sourceMessageId,
        "reschedule",
      );
      if (claim) return claim;

      const result = await rescheduleBooking(target.id, {
        scheduled_at: scheduledAtUtc,
        duration_minutes: action.duration_minutes || target.duration_minutes || 30,
      });

      if (result.error) {
        return {
          executed: true,
          success: false,
          responseText: `Could not reschedule: ${result.error}. Would you like to try another time?`,
          clearedPendingBooking: false,
          booking: null,
        };
      }

      await completeBookingAction(sourceMessageId, result.data!.id);

      return {
        executed: true,
        success: true,
        responseText: `Done! Your ${BOOKING_TYPE_LABELS[target.booking_type]} has been rescheduled to ${formattedDisplayTime}.`,
        clearedPendingBooking: true,
        booking: result.data,
      };
    }

    case "cancel": {
      const upcomingRes = await getUpcomingBookingsForConversation(
        gym.id,
        branchId,
        conversation.id,
      );

      const upcoming = upcomingRes.data || [];
      if (upcoming.length === 0) {
        return {
          executed: true,
          success: false,
          responseText:
            "I couldn't find any upcoming booking under your number to cancel.",
          clearedPendingBooking: true,
          booking: null,
        };
      }

      if (upcoming.length > 1) {
        const list = upcoming
          .map(
            (b, i) =>
              `${i + 1}. ${BOOKING_TYPE_LABELS[b.booking_type]}${b.trainer ? ` with ${b.trainer.full_name}` : ""} on ${formatFriendlyDateTime(b.scheduled_at, timezone)}`,
          )
          .join("\n");
        return {
          executed: true,
          success: false,
          responseText: `You have multiple upcoming appointments:\n${list}\nWhich one would you like to cancel?`,
          clearedPendingBooking: false,
          booking: null,
        };
      }

      const target = upcoming[0]!;
      const claim = await claimBookingMutation(
        gym.id,
        conversation.id,
        sourceMessageId,
        "cancel",
      );
      if (claim) return claim;
      const result = await cancelBooking(target.id);

      if (result.error) {
        return {
          executed: true,
          success: false,
          responseText: `Could not cancel the booking: ${result.error}.`,
          clearedPendingBooking: false,
          booking: null,
        };
      }

      await completeBookingAction(sourceMessageId, result.data!.id);

      const formatted = formatFriendlyDateTime(target.scheduled_at, timezone);
      return {
        executed: true,
        success: true,
        responseText: `Your ${BOOKING_TYPE_LABELS[target.booking_type]} on ${formatted} has been cancelled. Let us know whenever you'd like to book again!`,
        clearedPendingBooking: true,
        booking: result.data,
      };
    }

    default:
      return {
        executed: false,
        success: false,
        responseText: "",
        clearedPendingBooking: false,
        booking: null,
      };
  }
}

async function claimBookingMutation(
  gymId: string,
  conversationId: string,
  sourceMessageId: string,
  actionType: "create" | "reschedule" | "cancel",
): Promise<AIBookingExecutionResult | null> {
  const claim = await claimBookingAction({
    gymId,
    conversationId,
    sourceMessageId,
    actionType,
  });
  if (claim.error) {
    return {
      executed: true,
      success: false,
      responseText:
        "We couldn't safely process that booking request right now. Please try again.",
      clearedPendingBooking: false,
      booking: null,
    };
  }
  if (!claim.claimed) {
    return {
      executed: true,
      success: true,
      responseText: "This booking request has already been processed.",
      clearedPendingBooking: false,
      booking: null,
    };
  }
  return null;
}

function normalizeTrainerName(value: string): string {
  return value.trim().toLocaleLowerCase().replace(/\s+/g, " ");
}

/**
 * Formats a UTC ISO timestamp into a friendly branch-local string (e.g. "Sunday, Aug 30 at 7:00 PM").
 */
function formatFriendlyDateTime(isoUtc: string, timezone: string): string {
  try {
    const d = new Date(isoUtc);
    return d.toLocaleString("en-US", {
      timeZone: timezone,
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
  } catch {
    return isoUtc;
  }
}
