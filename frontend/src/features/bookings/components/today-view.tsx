import { CalendarX, Phone } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  BookingStatusBadge,
  BookingTypeBadge,
} from "@/features/bookings/components/booking-status-badge";
import { cn } from "@/lib/utils";
import type { Booking } from "@/types/booking";

type TodayViewProps = {
  bookings: Booking[];
  timezone: string;
  onSelectBooking: (booking: Booking) => void;
  onOpenNewBooking: () => void;
  showDate?: boolean;
  emptyDescription?: string;
};

export function TodayView({
  bookings,
  timezone,
  onSelectBooking,
  onOpenNewBooking,
  showDate = false,
  emptyDescription = "There are no appointments matching your filters for this date.",
}: TodayViewProps) {
  if (bookings.length === 0) {
    return (
      <div className="border-border bg-card flex flex-col items-center justify-center rounded-xl border p-12 text-center shadow-xs">
        <div className="bg-muted text-muted-foreground mb-3 grid size-12 place-items-center rounded-full">
          <CalendarX className="size-6" />
        </div>
        <h3 className="text-foreground text-base font-semibold">
          No bookings scheduled
        </h3>
        <p className="text-muted-foreground mt-1 max-w-sm text-xs sm:text-sm">
          {emptyDescription}
        </p>
        <Button onClick={onOpenNewBooking} className="mt-5 h-8.5 px-3 text-xs">
          Create booking
        </Button>
      </div>
    );
  }

  return (
    <div className="border-border bg-card divide-border divide-y overflow-hidden rounded-xl border shadow-xs">
      {bookings.map((booking) => {
        const start = new Date(booking.scheduled_at);
        const timeFormatted = start.toLocaleTimeString("en-US", {
          timeZone: timezone,
          hour: "numeric",
          minute: "2-digit",
          hour12: true,
        });
        const dateFormatted = start.toLocaleDateString("en-US", {
          timeZone: timezone,
          weekday: "short",
          month: "short",
          day: "numeric",
        });

        const end = new Date(start.getTime() + booking.duration_minutes * 60_000);
        const endTimeFormatted = end.toLocaleTimeString("en-US", {
          timeZone: timezone,
          hour: "numeric",
          minute: "2-digit",
          hour12: true,
        });

        const trainerName = booking.trainer?.full_name || null;

        return (
          <button
            key={booking.id}
            type="button"
            onClick={() => onSelectBooking(booking)}
            className={cn(
              "hover:bg-accent/40 group flex w-full cursor-pointer flex-col gap-3 p-4 text-left transition-colors sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:p-4.5",
              booking.status === "cancelled" && "opacity-60",
            )}
          >
            {/* Left: Time & Customer */}
            <div className="flex min-w-0 items-start gap-4">
              {/* Time block */}
              <div className="bg-muted/70 group-hover:bg-background border-border/80 flex w-28 shrink-0 flex-col items-center justify-center rounded-lg border p-2 text-center transition-colors">
                {showDate ? (
                  <span className="text-muted-foreground mb-0.5 text-[10px] font-medium tracking-wide uppercase">
                    {dateFormatted}
                  </span>
                ) : null}
                <span className="text-foreground text-sm font-semibold tracking-tight">
                  {timeFormatted}
                </span>
                <span className="text-muted-foreground text-[11px]">
                  {booking.duration_minutes} min
                </span>
              </div>

              {/* Customer info */}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-foreground group-hover:text-primary truncate text-sm font-semibold transition-colors">
                    {booking.customer_name}
                  </span>
                  {booking.source === "whatsapp" ? (
                    <span
                      title="Booked via WhatsApp"
                      className="py-0.2 inline-flex items-center rounded-full border border-emerald-500/20 bg-emerald-500/10 px-1.5 text-[10px] font-medium text-emerald-600 dark:text-emerald-400"
                    >
                      WhatsApp
                    </span>
                  ) : null}
                </div>

                <div className="text-muted-foreground mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                  {booking.customer_phone ? (
                    <span className="inline-flex items-center gap-1">
                      <Phone className="size-3 shrink-0" />
                      <span>{booking.customer_phone}</span>
                    </span>
                  ) : null}
                  <span className="text-muted-foreground/60 text-[10px]">
                    to {endTimeFormatted}
                  </span>
                </div>

                {booking.notes ? (
                  <p className="text-muted-foreground/80 mt-1.5 line-clamp-1 text-xs italic">
                    &ldquo;{booking.notes}&rdquo;
                  </p>
                ) : null}
              </div>
            </div>

            {/* Right: Booking Type & Status */}
            <div className="flex shrink-0 items-center justify-between gap-3 self-end sm:justify-end sm:self-auto">
              <BookingTypeBadge type={booking.booking_type} trainerName={trainerName} />
              <BookingStatusBadge status={booking.status} />
            </div>
          </button>
        );
      })}
    </div>
  );
}
