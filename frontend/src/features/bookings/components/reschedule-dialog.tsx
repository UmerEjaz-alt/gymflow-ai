"use client";

import { AlertCircle } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { isoToZonedLocalInput, zonedLocalInputToIso } from "@/lib/zoned-datetime";
import type {
  Booking,
  BookingDuration,
  RescheduleBookingPayload,
} from "@/types/booking";
import { ALLOWED_DURATIONS } from "@/types/booking";

type RescheduleDialogProps = {
  open: boolean;
  onClose: () => void;
  booking: Booking | null;
  timezone: string;
  onReschedule: (
    id: string,
    payload: RescheduleBookingPayload,
  ) => Promise<{ data: Booking | null; error: string | null }>;
  onSuccess: (updated: Booking) => void;
};

type RescheduleFormProps = {
  booking: Booking;
  timezone: string;
  onClose: () => void;
  onReschedule: (
    id: string,
    payload: RescheduleBookingPayload,
  ) => Promise<{ data: Booking | null; error: string | null }>;
  onSuccess: (updated: Booking) => void;
};

function RescheduleForm({
  booking,
  timezone,
  onClose,
  onReschedule,
  onSuccess,
}: RescheduleFormProps) {
  const { toast } = useToast();

  const currentLocal = isoToZonedLocalInput(booking.scheduled_at, timezone);
  const [date, setDate] = useState(currentLocal ? currentLocal.slice(0, 10) : "");
  const [time, setTime] = useState(currentLocal ? currentLocal.slice(11, 16) : "");
  const [durationMinutes, setDurationMinutes] = useState<BookingDuration>(
    (booking.duration_minutes as BookingDuration) || 30,
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    const localDateTimeStr = `${date}T${time}`;
    const newScheduledAtUtc = zonedLocalInputToIso(localDateTimeStr, timezone);
    if (!newScheduledAtUtc) {
      setError("Invalid date or time format.");
      return;
    }

    setLoading(true);

    try {
      const result = await onReschedule(booking.id, {
        scheduled_at: newScheduledAtUtc,
        duration_minutes: durationMinutes,
      });

      if (result.error) {
        setError(result.error);
        return;
      }

      if (result.data) {
        toast(`Appointment moved to ${date} at ${time}.`);
        onSuccess(result.data);
        onClose();
      }
    } catch {
      setError("Failed to reschedule booking.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-5 p-5 sm:p-6">
      {error ? (
        <div className="border-destructive/30 bg-destructive/10 text-destructive flex items-start gap-2 rounded-lg border p-3 text-xs">
          <AlertCircle className="mt-0.5 size-4 shrink-0" />
          <div className="flex-1">{error}</div>
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label
            htmlFor="reschedule-date"
            className="text-muted-foreground mb-1 block text-xs font-medium"
          >
            New Date ({timezone})
          </label>
          <Input
            id="reschedule-date"
            type="date"
            value={date}
            onChange={(e) => {
              setDate(e.target.value);
              setError(null);
            }}
            required
          />
        </div>
        <div>
          <label
            htmlFor="reschedule-time"
            className="text-muted-foreground mb-1 block text-xs font-medium"
          >
            New Time ({timezone})
          </label>
          <Input
            id="reschedule-time"
            type="time"
            value={time}
            onChange={(e) => {
              setTime(e.target.value);
              setError(null);
            }}
            required
          />
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <label className="text-muted-foreground block text-xs font-medium">
          Duration
        </label>
        <div className="flex items-center gap-2">
          {ALLOWED_DURATIONS.map((dur) => (
            <button
              key={dur}
              type="button"
              onClick={() => setDurationMinutes(dur)}
              className={`cursor-pointer rounded-lg border px-3 py-1.5 text-xs font-medium transition-all ${
                durationMinutes === dur
                  ? "border-primary bg-primary text-primary-foreground font-semibold"
                  : "border-border bg-card hover:bg-accent/40 text-foreground"
              }`}
            >
              {dur} min
            </button>
          ))}
        </div>
      </div>

      {booking.trainer ? (
        <p className="text-muted-foreground text-xs">
          Assigned Trainer:{" "}
          <strong className="text-foreground">{booking.trainer.full_name}</strong>
        </p>
      ) : null}

      <div className="border-border flex items-center justify-end gap-3 border-t pt-3">
        <button
          type="button"
          onClick={onClose}
          disabled={loading}
          className="border-border hover:bg-accent text-foreground inline-flex h-9 cursor-pointer items-center justify-center rounded-md border px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50"
        >
          Cancel
        </button>
        <Button type="submit" disabled={loading} className="cursor-pointer">
          {loading ? "Checking & saving..." : "Confirm reschedule"}
        </Button>
      </div>
    </form>
  );
}

export function RescheduleDialog({
  open,
  onClose,
  booking,
  timezone,
  onReschedule,
  onSuccess,
}: RescheduleDialogProps) {
  if (!booking || !open) return null;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Reschedule Appointment"
      description={`Rescheduling booking for ${booking.customer_name}`}
      size="max-w-md"
    >
      <RescheduleForm
        key={`${booking.id}-${booking.scheduled_at}`}
        booking={booking}
        timezone={timezone}
        onClose={onClose}
        onReschedule={onReschedule}
        onSuccess={onSuccess}
      />
    </Dialog>
  );
}
