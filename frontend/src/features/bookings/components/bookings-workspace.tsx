"use client";

import { useMemo, useState } from "react";
import { BookingsHeader } from "@/features/bookings/components/bookings-header";
import { BookingsSummaryKPIs } from "@/features/bookings/components/bookings-summary-kpis";
import { BookingsToolbar } from "@/features/bookings/components/bookings-toolbar";
import { TodayView } from "@/features/bookings/components/today-view";
import { WeekView } from "@/features/bookings/components/week-view";
import { NewBookingSheet } from "@/features/bookings/components/new-booking-sheet";
import { BookingDetailSheet } from "@/features/bookings/components/booking-detail-sheet";
import { RescheduleDialog } from "@/features/bookings/components/reschedule-dialog";
import type { Branch } from "@/types/branch";
import type {
  Booking,
  BookingStatusFilter,
  BookingType,
  CreateBookingPayload,
  RescheduleBookingPayload,
} from "@/types/booking";
import { BOOKING_STATUS_FILTER_LABELS } from "@/types/booking";
import type { Trainer } from "@/types/trainer";

type CustomerOption = {
  id: string;
  name: string;
  phone: string;
  stage: string;
};

type BookingsWorkspaceProps = {
  gymId: string;
  referenceTimeIso: string;
  activeBranch: Branch & { timezone: string };
  trainers: Trainer[];
  initialBookings: Booking[];
  knownCustomers: CustomerOption[];
  onCreateBooking: (
    payload: CreateBookingPayload,
  ) => Promise<{ data: Booking | null; error: string | null }>;
  onRescheduleBooking: (
    id: string,
    payload: RescheduleBookingPayload,
  ) => Promise<{ data: Booking | null; error: string | null }>;
  onCompleteBooking: (
    id: string,
  ) => Promise<{ data: Booking | null; error: string | null }>;
  onNoShowBooking: (
    id: string,
  ) => Promise<{ data: Booking | null; error: string | null }>;
  onCancelBooking: (
    id: string,
  ) => Promise<{ data: Booking | null; error: string | null }>;
};

export function BookingsWorkspace({
  gymId,
  referenceTimeIso,
  activeBranch,
  trainers,
  initialBookings,
  knownCustomers,
  onCreateBooking,
  onRescheduleBooking,
  onCompleteBooking,
  onNoShowBooking,
  onCancelBooking,
}: BookingsWorkspaceProps) {
  const timezone = activeBranch.timezone || "Asia/Karachi";

  const [bookings, setBookings] = useState<Booking[]>(initialBookings);
  const [viewMode, setViewMode] = useState<"today" | "week">("today");

  // Selected date anchor (starts at current date)
  const [selectedDate, setSelectedDate] = useState<Date>(() => new Date());

  // Filters
  const [statusFilter, setStatusFilter] = useState<BookingStatusFilter>("all");
  const [typeFilter, setTypeFilter] = useState<BookingType | "all">("all");
  const [trainerFilter, setTrainerFilter] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const isStatusResultsMode = statusFilter !== "all";

  // Modal / Sheet states
  const [newBookingOpen, setNewBookingOpen] = useState(false);
  const [newBookingDateIso, setNewBookingDateIso] = useState<string | undefined>(
    undefined,
  );
  const [detailBooking, setDetailBooking] = useState<Booking | null>(null);
  const [rescheduleBookingTarget, setRescheduleBookingTarget] =
    useState<Booking | null>(null);

  // Timezone-aware date string for today (YYYY-MM-DD)
  const todayIso = useMemo(() => {
    return new Date().toLocaleDateString("en-CA", { timeZone: timezone });
  }, [timezone]);

  // Selected date ISO string (YYYY-MM-DD)
  const selectedDateIso = useMemo(() => {
    return selectedDate.toLocaleDateString("en-CA", { timeZone: timezone });
  }, [selectedDate, timezone]);

  // Generate 7 days of the selected week (Monday to Sunday)
  const weekDays = useMemo(() => {
    // Determine day of week in branch timezone
    const current = new Date(selectedDate);
    const dayOfWeek = current.getDay(); // 0 = Sun, 1 = Mon ...
    const distanceToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;

    const monday = new Date(current);
    monday.setDate(current.getDate() + distanceToMonday);

    const days = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(monday);
      d.setDate(monday.getDate() + i);

      const dateIso = d.toLocaleDateString("en-CA", { timeZone: timezone });
      const dayNameShort = d
        .toLocaleDateString("en-US", {
          timeZone: timezone,
          weekday: "short",
        })
        .toUpperCase();
      const dayNameFull = d.toLocaleDateString("en-US", {
        timeZone: timezone,
        weekday: "long",
      });
      const dayNumber = Number(
        d.toLocaleDateString("en-US", { timeZone: timezone, day: "numeric" }),
      );
      const monthShort = d.toLocaleDateString("en-US", {
        timeZone: timezone,
        month: "short",
      });

      days.push({
        dateIso,
        dayNameShort,
        dayNameFull,
        dayNumber,
        monthShort,
        isToday: dateIso === todayIso,
      });
    }
    return days;
  }, [selectedDate, timezone, todayIso]);

  // Label for Date Navigator
  const dateLabel = useMemo(() => {
    if (viewMode === "today") {
      if (selectedDateIso === todayIso) return "Today";
      return selectedDate.toLocaleDateString("en-US", {
        timeZone: timezone,
        weekday: "short",
        month: "short",
        day: "numeric",
      });
    } else {
      const first = weekDays[0];
      const last = weekDays[6];
      return `${first.monthShort} ${first.dayNumber} – ${last.monthShort} ${last.dayNumber}`;
    }
  }, [viewMode, selectedDate, selectedDateIso, todayIso, timezone, weekDays]);

  const isCurrentDayOrWeek = useMemo(() => {
    if (viewMode === "today") {
      return selectedDateIso === todayIso;
    }
    return weekDays.some((d) => d.dateIso === todayIso);
  }, [viewMode, selectedDateIso, todayIso, weekDays]);

  // Date Navigation handlers
  function handlePrevDate() {
    setSelectedDate((prev) => {
      const next = new Date(prev);
      next.setDate(prev.getDate() - (viewMode === "today" ? 1 : 7));
      return next;
    });
  }

  function handleNextDate() {
    setSelectedDate((prev) => {
      const next = new Date(prev);
      next.setDate(prev.getDate() + (viewMode === "today" ? 1 : 7));
      return next;
    });
  }

  function handleTodayDate() {
    setSelectedDate(new Date());
  }

  // Filtered Bookings
  const filteredBookings = useMemo(() => {
    const referenceTime = new Date(referenceTimeIso).getTime();

    return bookings.filter((b) => {
      // 1. Status Filter
      if (statusFilter === "upcoming") {
        if (
          b.status !== "upcoming" ||
          new Date(b.scheduled_at).getTime() < referenceTime
        ) {
          return false;
        }
      } else if (statusFilter === "overdue") {
        if (
          b.status !== "upcoming" ||
          new Date(b.scheduled_at).getTime() >= referenceTime
        ) {
          return false;
        }
      } else if (statusFilter !== "all" && b.status !== statusFilter) {
        return false;
      }
      // 2. Type Filter
      if (typeFilter !== "all" && b.booking_type !== typeFilter) {
        return false;
      }
      // 3. Trainer Filter
      if (trainerFilter !== "all" && b.trainer_id !== trainerFilter) {
        return false;
      }
      // 4. Search Query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const matchesName = b.customer_name.toLowerCase().includes(q);
        const matchesPhone = b.customer_phone?.toLowerCase().includes(q);
        if (!matchesName && !matchesPhone) return false;
      }
      return true;
    });
  }, [
    bookings,
    statusFilter,
    typeFilter,
    trainerFilter,
    searchQuery,
    referenceTimeIso,
  ]);

  // Specific filtered list for Today View
  const todayViewBookings = useMemo(() => {
    return filteredBookings.filter((b) => {
      const bookingDateIso = new Date(b.scheduled_at).toLocaleDateString("en-CA", {
        timeZone: timezone,
      });
      return bookingDateIso === selectedDateIso;
    });
  }, [filteredBookings, timezone, selectedDateIso]);

  // Specific filtered list for Week View (all within week days)
  const weekViewBookings = useMemo(() => {
    const weekIsoSet = new Set(weekDays.map((d) => d.dateIso));
    return filteredBookings.filter((b) => {
      const bookingDateIso = new Date(b.scheduled_at).toLocaleDateString("en-CA", {
        timeZone: timezone,
      });
      return weekIsoSet.has(bookingDateIso);
    });
  }, [filteredBookings, timezone, weekDays]);

  const statusViewBookings = useMemo(() => {
    if (!isStatusResultsMode) return [];

    return [...filteredBookings].sort((left, right) => {
      const difference =
        new Date(left.scheduled_at).getTime() - new Date(right.scheduled_at).getTime();
      return statusFilter === "upcoming" ? difference : -difference;
    });
  }, [filteredBookings, isStatusResultsMode, statusFilter]);

  // Mutation local updates
  function handleBookingCreated(newBooking: Booking) {
    setBookings((prev) => [newBooking, ...prev]);
  }

  function handleBookingUpdated(updated: Booking) {
    setBookings((prev) => prev.map((b) => (b.id === updated.id ? updated : b)));
    if (detailBooking?.id === updated.id) {
      setDetailBooking(updated);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <BookingsHeader
        branchName={activeBranch.branch_name}
        viewMode={viewMode}
        onViewModeChange={(mode) => {
          setViewMode(mode);
          setStatusFilter("all");
        }}
        onOpenNewBooking={() => {
          setNewBookingDateIso(selectedDateIso);
          setNewBookingOpen(true);
        }}
      />

      {/* Summary KPI Pills */}
      <BookingsSummaryKPIs
        bookings={bookings}
        activeStatusFilter={statusFilter}
        onStatusFilterChange={setStatusFilter}
        todayDateIso={todayIso}
        timezone={timezone}
        referenceTimeIso={referenceTimeIso}
      />

      {/* Toolbar: Navigation, Filters, Search */}
      <BookingsToolbar
        viewMode={viewMode}
        dateLabel={dateLabel}
        resultsLabel={
          isStatusResultsMode
            ? `${BOOKING_STATUS_FILTER_LABELS[statusFilter]} bookings`
            : undefined
        }
        isCurrentDayOrWeek={isCurrentDayOrWeek}
        onPrevDate={handlePrevDate}
        onNextDate={handleNextDate}
        onTodayDate={handleTodayDate}
        statusFilter={statusFilter}
        onStatusFilterChange={setStatusFilter}
        typeFilter={typeFilter}
        onTypeFilterChange={setTypeFilter}
        trainerFilter={trainerFilter}
        onTrainerFilterChange={setTrainerFilter}
        trainers={trainers}
        searchQuery={searchQuery}
        onSearchQueryChange={setSearchQuery}
      />

      {/* Primary View */}
      {isStatusResultsMode ? (
        <TodayView
          bookings={statusViewBookings}
          timezone={timezone}
          showDate
          emptyDescription={`There are no ${BOOKING_STATUS_FILTER_LABELS[statusFilter].toLowerCase()} bookings matching your filters.`}
          onSelectBooking={(b) => setDetailBooking(b)}
          onOpenNewBooking={() => {
            setNewBookingDateIso(selectedDateIso);
            setNewBookingOpen(true);
          }}
        />
      ) : viewMode === "today" ? (
        <TodayView
          bookings={todayViewBookings}
          timezone={timezone}
          onSelectBooking={(b) => setDetailBooking(b)}
          onOpenNewBooking={() => {
            setNewBookingDateIso(selectedDateIso);
            setNewBookingOpen(true);
          }}
        />
      ) : (
        <WeekView
          bookings={weekViewBookings}
          weekDays={weekDays}
          timezone={timezone}
          onSelectBooking={(b) => setDetailBooking(b)}
          onOpenNewBookingWithDate={(dateIso) => {
            setNewBookingDateIso(dateIso);
            setNewBookingOpen(true);
          }}
        />
      )}

      {/* New Booking Sheet */}
      <NewBookingSheet
        open={newBookingOpen}
        onClose={() => {
          setNewBookingOpen(false);
          setNewBookingDateIso(undefined);
        }}
        gymId={gymId}
        branchId={activeBranch.id}
        branchName={activeBranch.branch_name}
        timezone={timezone}
        trainers={trainers}
        knownCustomers={knownCustomers}
        defaultDateIso={newBookingDateIso || selectedDateIso}
        onCreateBooking={onCreateBooking}
        onSuccess={handleBookingCreated}
      />

      {/* Booking Details Sheet */}
      <BookingDetailSheet
        open={Boolean(detailBooking)}
        onClose={() => setDetailBooking(null)}
        booking={detailBooking}
        timezone={timezone}
        onOpenReschedule={(b) => {
          setRescheduleBookingTarget(b);
        }}
        onCompleteBooking={onCompleteBooking}
        onNoShowBooking={onNoShowBooking}
        onCancelBooking={onCancelBooking}
        onBookingUpdated={handleBookingUpdated}
      />

      {/* Reschedule Dialog */}
      <RescheduleDialog
        open={Boolean(rescheduleBookingTarget)}
        onClose={() => setRescheduleBookingTarget(null)}
        booking={rescheduleBookingTarget}
        timezone={timezone}
        onReschedule={onRescheduleBooking}
        onSuccess={handleBookingUpdated}
      />
    </div>
  );
}
