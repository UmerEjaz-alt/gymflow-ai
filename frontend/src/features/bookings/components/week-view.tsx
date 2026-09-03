import { Plus } from "lucide-react";
import {
  BookingStatusBadge,
  BookingTypeBadge,
} from "@/features/bookings/components/booking-status-badge";
import { cn } from "@/lib/utils";
import type { Booking } from "@/types/booking";

type WeekViewProps = {
  bookings: Booking[];
  weekDays: {
    dateIso: string; // YYYY-MM-DD
    dayNameShort: string; // MON
    dayNameFull: string; // Monday
    dayNumber: number; // 24
    monthShort: string; // Oct
    isToday: boolean;
  }[];
  timezone: string;
  onSelectBooking: (booking: Booking) => void;
  onOpenNewBookingWithDate?: (dateIso: string) => void;
};

export function WeekView({
  bookings,
  weekDays,
  timezone,
  onSelectBooking,
  onOpenNewBookingWithDate,
}: WeekViewProps) {
  return (
    <div className="flex flex-col gap-4">
      {weekDays.map((day) => {
        // Find bookings for this day
        const dayBookings = bookings.filter((b) => {
          const d = new Date(b.scheduled_at).toLocaleDateString("en-CA", {
            timeZone: timezone,
          });
          return d === day.dateIso;
        });

        return (
          <div
            key={day.dateIso}
            className={cn(
              "border-border bg-card overflow-hidden rounded-xl border shadow-xs transition-colors",
              day.isToday && "border-primary/40 ring-primary/20 ring-1",
            )}
          >
            {/* Day Header */}
            <div
              className={cn(
                "border-border flex items-center justify-between border-b px-4 py-2.5 sm:px-5",
                day.isToday ? "bg-primary/5" : "bg-muted/40",
              )}
            >
              <div className="flex items-center gap-2.5">
                <span
                  className={cn(
                    "text-xs font-bold tracking-wider uppercase",
                    day.isToday ? "text-primary" : "text-foreground",
                  )}
                >
                  {day.dayNameShort}
                </span>
                <span className="text-muted-foreground text-xs">
                  {day.monthShort} {day.dayNumber}
                </span>
                {day.isToday ? (
                  <span className="bg-primary text-primary-foreground py-0.2 rounded-full px-2 text-[10px] font-semibold">
                    Today
                  </span>
                ) : null}
              </div>

              <div className="flex items-center gap-3">
                <span className="text-muted-foreground text-xs">
                  {dayBookings.length}{" "}
                  {dayBookings.length === 1 ? "booking" : "bookings"}
                </span>
                {onOpenNewBookingWithDate ? (
                  <button
                    type="button"
                    onClick={() => onOpenNewBookingWithDate(day.dateIso)}
                    title={`New booking for ${day.dayNameFull}`}
                    className="text-muted-foreground hover:text-foreground hover:bg-muted/80 grid size-6 place-items-center rounded-md transition-colors"
                  >
                    <Plus className="size-3.5" />
                  </button>
                ) : null}
              </div>
            </div>

            {/* Day Bookings List */}
            {dayBookings.length === 0 ? (
              <div className="text-muted-foreground/70 px-4 py-4 text-xs italic sm:px-5">
                No appointments scheduled for this day.
              </div>
            ) : (
              <div className="divide-border divide-y">
                {dayBookings.map((booking) => {
                  const start = new Date(booking.scheduled_at);
                  const timeFormatted = start.toLocaleTimeString("en-US", {
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
                        "hover:bg-accent/40 group flex w-full flex-col gap-2.5 p-3 text-left transition-colors sm:flex-row sm:items-center sm:justify-between sm:p-3.5",
                        booking.status === "cancelled" && "opacity-60",
                      )}
                    >
                      {/* Left: Time & Customer */}
                      <div className="flex min-w-0 items-center gap-3.5">
                        <span className="text-foreground w-20 shrink-0 text-xs font-medium">
                          {timeFormatted}
                        </span>

                        <div className="min-w-0 flex-1">
                          <span className="text-foreground group-hover:text-primary block truncate text-xs font-semibold sm:text-sm">
                            {booking.customer_name}
                          </span>
                          {booking.customer_phone ? (
                            <span className="text-muted-foreground block text-[11px]">
                              {booking.customer_phone}
                            </span>
                          ) : null}
                        </div>
                      </div>

                      {/* Right: Type & Status */}
                      <div className="flex shrink-0 items-center justify-between gap-2.5 self-end sm:self-auto">
                        <BookingTypeBadge
                          type={booking.booking_type}
                          trainerName={trainerName}
                        />
                        <BookingStatusBadge status={booking.status} />
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
