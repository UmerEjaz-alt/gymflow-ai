"use client";

import {
  Building2,
  Calendar,
  CheckCircle2,
  Clock,
  Dumbbell,
  FileText,
  Phone,
  RotateCcw,
  User,
  UserX,
  XCircle,
} from "lucide-react";
import { useState } from "react";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Sheet } from "@/components/ui/sheet";
import { useToast } from "@/components/ui/toast";
import {
  BookingStatusBadge,
  BookingTypeBadge,
} from "@/features/bookings/components/booking-status-badge";
import type { Booking } from "@/types/booking";

type BookingDetailSheetProps = {
  open: boolean;
  onClose: () => void;
  booking: Booking | null;
  timezone: string;
  onOpenReschedule: (booking: Booking) => void;
  onCompleteBooking: (
    id: string,
  ) => Promise<{ data: Booking | null; error: string | null }>;
  onNoShowBooking: (
    id: string,
  ) => Promise<{ data: Booking | null; error: string | null }>;
  onCancelBooking: (
    id: string,
  ) => Promise<{ data: Booking | null; error: string | null }>;
  onBookingUpdated: (updated: Booking) => void;
};

export function BookingDetailSheet({
  open,
  onClose,
  booking,
  timezone,
  onOpenReschedule,
  onCompleteBooking,
  onNoShowBooking,
  onCancelBooking,
  onBookingUpdated,
}: BookingDetailSheetProps) {
  const { toast } = useToast();
  const [actionLoading, setActionLoading] = useState(false);
  const [confirmCancelOpen, setConfirmCancelOpen] = useState(false);

  if (!booking) return null;

  const start = new Date(booking.scheduled_at);
  const dateFormatted = start.toLocaleDateString("en-US", {
    timeZone: timezone,
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const timeFormatted = start.toLocaleTimeString("en-US", {
    timeZone: timezone,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });

  const end = new Date(start.getTime() + booking.duration_minutes * 60_000);
  const endTimeFormatted = end.toLocaleTimeString("en-US", {
    timeZone: timezone,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });

  async function handleMarkCompleted() {
    if (!booking) return;
    setActionLoading(true);
    try {
      const result = await onCompleteBooking(booking.id);
      if (result.error) {
        toast(result.error, "error");
        return;
      }
      if (result.data) {
        toast("Marked as successfully completed.");
        onBookingUpdated(result.data);
      }
    } finally {
      setActionLoading(false);
    }
  }

  async function handleMarkNoShow() {
    if (!booking) return;
    setActionLoading(true);
    try {
      const result = await onNoShowBooking(booking.id);
      if (result.error) {
        toast(result.error, "error");
        return;
      }
      if (result.data) {
        toast("Customer marked as no-show.");
        onBookingUpdated(result.data);
      }
    } finally {
      setActionLoading(false);
    }
  }

  async function handleConfirmCancel() {
    if (!booking) return;
    setActionLoading(true);
    try {
      const result = await onCancelBooking(booking.id);
      if (result.error) {
        toast(result.error, "error");
        return;
      }
      if (result.data) {
        toast("The appointment has been cancelled.");
        onBookingUpdated(result.data);
        setConfirmCancelOpen(false);
      }
    } finally {
      setActionLoading(false);
    }
  }

  const isUpcoming = booking.status === "upcoming";

  return (
    <>
      <Sheet
        open={open}
        onClose={onClose}
        title={
          <div className="flex items-center gap-2">
            <span className="text-foreground truncate font-semibold">
              {booking.customer_name}
            </span>
          </div>
        }
        description={
          <div className="mt-1 flex items-center gap-2">
            <BookingStatusBadge status={booking.status} />
            <BookingTypeBadge
              type={booking.booking_type}
              trainerName={booking.trainer?.full_name}
            />
          </div>
        }
        size="max-w-md"
      >
        <div className="flex flex-col gap-6 py-2">
          {/* Main Appointment Details Card */}
          <div className="border-border bg-card/60 flex flex-col gap-3.5 rounded-xl border p-4 text-xs shadow-2xs">
            <div className="flex items-start gap-3">
              <Calendar className="text-muted-foreground mt-0.5 size-4 shrink-0" />
              <div>
                <span className="text-muted-foreground block text-[11px] font-medium">
                  Date
                </span>
                <span className="text-foreground text-xs font-medium sm:text-sm">
                  {dateFormatted}
                </span>
              </div>
            </div>

            <div className="flex items-start gap-3">
              <Clock className="text-muted-foreground mt-0.5 size-4 shrink-0" />
              <div>
                <span className="text-muted-foreground block text-[11px] font-medium">
                  Time & Duration
                </span>
                <span className="text-foreground text-xs font-medium sm:text-sm">
                  {timeFormatted} – {endTimeFormatted} ({booking.duration_minutes} min)
                </span>
              </div>
            </div>

            {booking.trainer ? (
              <div className="flex items-start gap-3">
                <Dumbbell className="mt-0.5 size-4 shrink-0 text-purple-600 dark:text-purple-400" />
                <div>
                  <span className="text-muted-foreground block text-[11px] font-medium">
                    Assigned Trainer
                  </span>
                  <span className="text-foreground text-xs font-semibold sm:text-sm">
                    {booking.trainer.full_name}
                  </span>
                  {booking.trainer.specialization ? (
                    <span className="text-muted-foreground block text-[11px]">
                      {booking.trainer.specialization}
                    </span>
                  ) : null}
                </div>
              </div>
            ) : null}

            {booking.branch ? (
              <div className="flex items-start gap-3">
                <Building2 className="text-muted-foreground mt-0.5 size-4 shrink-0" />
                <div>
                  <span className="text-muted-foreground block text-[11px] font-medium">
                    Branch
                  </span>
                  <span className="text-foreground font-medium">
                    {booking.branch.branch_name}
                  </span>
                </div>
              </div>
            ) : null}
          </div>

          {/* Customer & Contact */}
          <div className="border-border bg-card/60 flex flex-col gap-3 rounded-xl border p-4 text-xs shadow-2xs">
            <span className="text-muted-foreground text-[11px] font-semibold tracking-wider uppercase">
              Customer Contact
            </span>

            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <User className="text-muted-foreground size-4" />
                <span className="text-foreground text-xs font-medium sm:text-sm">
                  {booking.customer_name}
                </span>
              </div>
              <span className="text-muted-foreground text-[11px]">
                via {booking.source === "whatsapp" ? "WhatsApp" : "Manual entry"}
              </span>
            </div>

            {booking.customer_phone ? (
              <div className="flex items-center gap-2.5">
                <Phone className="text-muted-foreground size-4" />
                <a
                  href={`tel:${booking.customer_phone}`}
                  className="text-primary text-xs font-medium hover:underline sm:text-sm"
                >
                  {booking.customer_phone}
                </a>
              </div>
            ) : (
              <span className="text-muted-foreground text-xs italic">
                No phone number provided
              </span>
            )}
          </div>

          {/* Notes */}
          {booking.notes ? (
            <div className="border-border bg-card/60 flex flex-col gap-2 rounded-xl border p-4 text-xs shadow-2xs">
              <div className="text-muted-foreground flex items-center gap-2">
                <FileText className="size-4" />
                <span className="text-[11px] font-semibold tracking-wider uppercase">
                  Notes
                </span>
              </div>
              <p className="text-foreground text-xs leading-relaxed">{booking.notes}</p>
            </div>
          ) : null}

          {/* Status-specific Timestamps / History */}
          <div className="text-muted-foreground/80 flex flex-col gap-1 px-1 text-[11px]">
            <span>
              Booked on{" "}
              {new Date(booking.created_at).toLocaleDateString("en-US", {
                timeZone: timezone,
                month: "short",
                day: "numeric",
                year: "numeric",
                hour: "numeric",
                minute: "2-digit",
              })}
            </span>
            {booking.completed_at ? (
              <span className="text-emerald-600 dark:text-emerald-400">
                Completed on{" "}
                {new Date(booking.completed_at).toLocaleDateString("en-US", {
                  timeZone: timezone,
                  month: "short",
                  day: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                })}
              </span>
            ) : null}
            {booking.cancelled_at ? (
              <span className="text-muted-foreground">
                Cancelled on{" "}
                {new Date(booking.cancelled_at).toLocaleDateString("en-US", {
                  timeZone: timezone,
                  month: "short",
                  day: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                })}
              </span>
            ) : null}
            {booking.no_show_at ? (
              <span className="text-amber-600 dark:text-amber-400">
                Marked no-show on{" "}
                {new Date(booking.no_show_at).toLocaleDateString("en-US", {
                  timeZone: timezone,
                  month: "short",
                  day: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                })}
              </span>
            ) : null}
          </div>

          {/* Action Bar for Upcoming Bookings */}
          {isUpcoming ? (
            <div className="border-border flex flex-col gap-2 border-t pt-4">
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => onOpenReschedule(booking)}
                  disabled={actionLoading}
                  className="border-border hover:bg-accent text-foreground inline-flex h-8.5 cursor-pointer items-center justify-center gap-1.5 rounded-md border px-3 text-xs font-medium transition-colors disabled:opacity-50"
                >
                  <RotateCcw className="size-3.5" />
                  <span>Reschedule</span>
                </button>
                <button
                  type="button"
                  onClick={handleMarkCompleted}
                  disabled={actionLoading}
                  className="inline-flex h-8.5 cursor-pointer items-center justify-center gap-1.5 rounded-md bg-emerald-600 px-3 text-xs font-medium text-white transition-colors hover:bg-emerald-700 disabled:opacity-50"
                >
                  <CheckCircle2 className="size-3.5" />
                  <span>Completed</span>
                </button>
              </div>

              <div className="mt-1 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={handleMarkNoShow}
                  disabled={actionLoading}
                  className="inline-flex h-8.5 cursor-pointer items-center justify-center gap-1.5 rounded-md border border-amber-500/30 px-3 text-xs font-medium text-amber-700 transition-colors hover:bg-amber-500/10 disabled:opacity-50 dark:text-amber-400"
                >
                  <UserX className="size-3.5" />
                  <span>No-show</span>
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmCancelOpen(true)}
                  disabled={actionLoading}
                  className="border-destructive/30 text-destructive hover:bg-destructive/10 inline-flex h-8.5 cursor-pointer items-center justify-center gap-1.5 rounded-md border px-3 text-xs font-medium transition-colors disabled:opacity-50"
                >
                  <XCircle className="size-3.5" />
                  <span>Cancel</span>
                </button>
              </div>
            </div>
          ) : null}
        </div>
      </Sheet>

      {/* Confirmation Dialog for Cancellation */}
      <ConfirmDialog
        open={confirmCancelOpen}
        onClose={() => setConfirmCancelOpen(false)}
        onConfirm={handleConfirmCancel}
        title="Cancel Appointment?"
        description={`Are you sure you want to cancel the booking for ${booking.customer_name}? The booking history will be retained.`}
        confirmLabel="Cancel Appointment"
        isConfirming={actionLoading}
      />
    </>
  );
}
