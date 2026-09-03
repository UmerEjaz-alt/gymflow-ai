import { ChevronLeft, ChevronRight, RotateCcw, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import type { BookingStatusFilter, BookingType } from "@/types/booking";
import {
  BOOKING_STATUS_FILTER_LABELS,
  BOOKING_STATUS_LABELS,
  BOOKING_TYPE_LABELS,
} from "@/types/booking";
import type { Trainer } from "@/types/trainer";

type BookingsToolbarProps = {
  viewMode: "today" | "week";
  dateLabel: string;
  resultsLabel?: string;
  isCurrentDayOrWeek: boolean;
  onPrevDate: () => void;
  onNextDate: () => void;
  onTodayDate: () => void;
  statusFilter: BookingStatusFilter;
  onStatusFilterChange: (status: BookingStatusFilter) => void;
  typeFilter: BookingType | "all";
  onTypeFilterChange: (type: BookingType | "all") => void;
  trainerFilter: string; // trainer id or "all"
  onTrainerFilterChange: (trainerId: string) => void;
  trainers: Trainer[];
  searchQuery: string;
  onSearchQueryChange: (q: string) => void;
};

export function BookingsToolbar({
  viewMode,
  dateLabel,
  resultsLabel,
  isCurrentDayOrWeek,
  onPrevDate,
  onNextDate,
  onTodayDate,
  statusFilter,
  onStatusFilterChange,
  typeFilter,
  onTypeFilterChange,
  trainerFilter,
  onTrainerFilterChange,
  trainers,
  searchQuery,
  onSearchQueryChange,
}: BookingsToolbarProps) {
  return (
    <div className="border-border bg-card flex flex-col gap-3 rounded-xl border p-3.5 shadow-xs sm:p-4">
      {/* Top row: Date Navigator and Search */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        {/* Date Navigator */}
        <div className="flex items-center gap-1.5">
          {resultsLabel ? (
            <div className="border-border bg-background text-foreground flex h-8 items-center rounded-lg border px-3 text-xs font-semibold tracking-tight sm:text-sm">
              {resultsLabel}
            </div>
          ) : (
            <div className="border-border bg-background flex items-center rounded-lg border p-0.5">
              <button
                type="button"
                onClick={onPrevDate}
                aria-label={viewMode === "today" ? "Previous day" : "Previous week"}
                className="text-muted-foreground hover:text-foreground hover:bg-muted grid size-7 cursor-pointer place-items-center rounded-md transition-colors"
              >
                <ChevronLeft className="size-4" />
              </button>
              <span className="text-foreground min-w-36 px-2 text-center text-xs font-semibold tracking-tight sm:text-sm">
                {dateLabel}
              </span>
              <button
                type="button"
                onClick={onNextDate}
                aria-label={viewMode === "today" ? "Next day" : "Next week"}
                className="text-muted-foreground hover:text-foreground hover:bg-muted grid size-7 cursor-pointer place-items-center rounded-md transition-colors"
              >
                <ChevronRight className="size-4" />
              </button>
            </div>
          )}

          {!resultsLabel && !isCurrentDayOrWeek ? (
            <button
              type="button"
              onClick={onTodayDate}
              className="border-border bg-background hover:bg-accent text-foreground inline-flex h-8 cursor-pointer items-center gap-1 rounded-lg border px-2.5 text-xs font-medium transition-colors"
            >
              <RotateCcw className="size-3" />
              <span>Current</span>
            </button>
          ) : null}
        </div>

        {/* Search */}
        <div className="relative flex-1 sm:max-w-xs">
          <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2" />
          <Input
            value={searchQuery}
            onChange={(e) => onSearchQueryChange(e.target.value)}
            placeholder="Search by name or phone..."
            className="h-8.5 pl-8.5 text-xs sm:text-sm"
          />
        </div>
      </div>

      {/* Bottom row: Filters */}
      <div className="border-border/60 flex flex-wrap items-center gap-2 border-t pt-1">
        <span className="text-muted-foreground mr-1 text-xs font-medium">Filters:</span>

        {/* Status Filter */}
        <Select
          value={statusFilter}
          onChange={(e) => onStatusFilterChange(e.target.value as BookingStatusFilter)}
          className="h-7.5 w-32 text-xs"
        >
          <option value="all">All statuses</option>
          <option value="upcoming">{BOOKING_STATUS_LABELS.upcoming}</option>
          <option value="overdue">{BOOKING_STATUS_FILTER_LABELS.overdue}</option>
          <option value="completed">{BOOKING_STATUS_LABELS.completed}</option>
          <option value="cancelled">{BOOKING_STATUS_LABELS.cancelled}</option>
          <option value="no_show">{BOOKING_STATUS_LABELS.no_show}</option>
        </Select>

        {/* Type Filter */}
        <Select
          value={typeFilter}
          onChange={(e) => onTypeFilterChange(e.target.value as BookingType | "all")}
          className="h-7.5 w-36 text-xs"
        >
          <option value="all">All types</option>
          <option value="gym_visit">{BOOKING_TYPE_LABELS.gym_visit}</option>
          <option value="trial_session">{BOOKING_TYPE_LABELS.trial_session}</option>
          <option value="pt_consultation">{BOOKING_TYPE_LABELS.pt_consultation}</option>
          <option value="pt_session">{BOOKING_TYPE_LABELS.pt_session}</option>
        </Select>

        {/* Trainer Filter */}
        {trainers.length > 0 ? (
          <Select
            value={trainerFilter}
            onChange={(e) => onTrainerFilterChange(e.target.value)}
            className="h-7.5 w-36 text-xs"
          >
            <option value="all">All trainers</option>
            {trainers.map((t) => (
              <option key={t.id} value={t.id}>
                {t.full_name}
              </option>
            ))}
          </Select>
        ) : null}

        {/* Reset filters if any are active */}
        {statusFilter !== "all" ||
        typeFilter !== "all" ||
        trainerFilter !== "all" ||
        searchQuery ? (
          <button
            type="button"
            onClick={() => {
              onStatusFilterChange("all");
              onTypeFilterChange("all");
              onTrainerFilterChange("all");
              onSearchQueryChange("");
            }}
            className="text-muted-foreground hover:text-foreground ml-auto cursor-pointer text-xs underline underline-offset-2"
          >
            Clear filters
          </button>
        ) : null}
      </div>
    </div>
  );
}
