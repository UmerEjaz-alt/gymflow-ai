import { resolveActiveBranch } from "@/lib/active-branch.server";
import {
  cancelBooking,
  createBooking,
  getBookingsForBranch,
  markBookingCompleted,
  markBookingNoShow,
  rescheduleBooking,
} from "@/services/booking.server";
import { getTrainers } from "@/services/trainer.server";
import { getMemberships } from "@/services/membership.server";
import { listConversations } from "@/services/conversation.server";
import { BookingsWorkspace } from "@/features/bookings/components/bookings-workspace";
import type { CreateBookingPayload, RescheduleBookingPayload } from "@/types/booking";
import {
  elapsedMs,
  logPerformance,
  startPerformanceTimer,
} from "@/lib/performance-log.server";

export const dynamic = "force-dynamic";

export default async function BookingsPage() {
  const totalStartedAt = startPerformanceTimer();
  const branchStartedAt = startPerformanceTimer();
  const resolved = await resolveActiveBranch();

  if (resolved.error || !resolved.gym || !resolved.branch) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-12">
        <div className="border-destructive/30 bg-destructive/10 text-destructive rounded-xl border p-6 text-sm">
          {resolved.error ?? "Create or select a branch before viewing bookings."}
        </div>
      </div>
    );
  }

  const gym = resolved.gym;
  const branch = resolved.branch;
  const timezone = branch.timezone || "Asia/Karachi";
  const branchMs = elapsedMs(branchStartedAt);

  // Load initial data for active branch in parallel
  const dataStartedAt = startPerformanceTimer();
  const [bookingsRes, trainersRes, membershipsRes, conversationsRes] =
    await Promise.all([
      getBookingsForBranch(gym.id, branch.id),
      getTrainers(gym.id, branch.id),
      getMemberships(gym.id, branch.id),
      listConversations(gym.id, undefined, branch.id),
    ]);
  const dataMs = elapsedMs(dataStartedAt);

  const bookings = bookingsRes.data ?? [];
  const trainers = (trainersRes.data ?? []).filter((t) => t.active);

  // Extract known customer options from memberships & conversations
  const customerMap = new Map<
    string,
    { id: string; name: string; phone: string; stage: string }
  >();

  // 1. Add members
  for (const m of membershipsRes.data ?? []) {
    if (m.conversation && m.conversation.customer_name) {
      customerMap.set(m.conversation.id, {
        id: m.conversation.id,
        name: m.conversation.customer_name,
        phone: m.conversation.customer_phone || "",
        stage: "Member",
      });
    }
  }

  // 2. Add conversation leads
  for (const c of conversationsRes.data ?? []) {
    if (c.customer_name && !customerMap.has(c.id)) {
      customerMap.set(c.id, {
        id: c.id,
        name: c.customer_name,
        phone: c.customer_phone || "",
        stage: c.lead_stage === "member" ? "Member" : "Lead",
      });
    }
  }

  const knownCustomers = Array.from(customerMap.values()).sort((a, b) =>
    a.name.localeCompare(b.name),
  );

  logPerformance("dashboard.bookings.load", {
    branch_resolution_ms: branchMs,
    data_queries_ms: dataMs,
    booking_count: bookings.length,
    trainer_count: trainersRes.data?.length ?? 0,
    membership_count: membershipsRes.data?.length ?? 0,
    conversation_count: conversationsRes.data?.length ?? 0,
    total_ms: elapsedMs(totalStartedAt),
  });

  // Server Actions bound to this page context
  async function handleCreateBooking(payload: CreateBookingPayload) {
    "use server";
    return createBooking(payload);
  }

  async function handleRescheduleBooking(
    id: string,
    payload: RescheduleBookingPayload,
  ) {
    "use server";
    return rescheduleBooking(id, payload);
  }

  async function handleCompleteBooking(id: string) {
    "use server";
    return markBookingCompleted(id);
  }

  async function handleNoShowBooking(id: string) {
    "use server";
    return markBookingNoShow(id);
  }

  async function handleCancelBooking(id: string) {
    "use server";
    return cancelBooking(id);
  }

  return (
    <div className="mx-auto w-full max-w-screen-2xl px-3 py-4 sm:px-5 sm:py-6 xl:px-6">
      <BookingsWorkspace
        gymId={gym.id}
        referenceTimeIso={new Date().toISOString()}
        activeBranch={{ ...branch, timezone }}
        trainers={trainers}
        initialBookings={bookings}
        knownCustomers={knownCustomers}
        onCreateBooking={handleCreateBooking}
        onRescheduleBooking={handleRescheduleBooking}
        onCompleteBooking={handleCompleteBooking}
        onNoShowBooking={handleNoShowBooking}
        onCancelBooking={handleCancelBooking}
      />
    </div>
  );
}
