import { AlertTriangle, Calendar, CheckCircle2, Clock, UserX } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Booking, BookingStatusFilter } from "@/types/booking";

type SummaryKPIsProps = {
  bookings: Booking[];
  activeStatusFilter: BookingStatusFilter;
  onStatusFilterChange: (status: BookingStatusFilter) => void;
  todayDateIso: string; // YYYY-MM-DD in branch timezone
  timezone: string;
  referenceTimeIso: string;
};

export function BookingsSummaryKPIs({
  bookings,
  activeStatusFilter,
  onStatusFilterChange,
  todayDateIso,
  timezone,
  referenceTimeIso,
}: SummaryKPIsProps) {
  // Compute counts
  const todayCount = bookings.filter((b) => {
    const d = new Date(b.scheduled_at).toLocaleDateString("en-CA", {
      timeZone: timezone,
    });
    return d === todayDateIso && b.status !== "cancelled";
  }).length;

  const referenceTime = new Date(referenceTimeIso).getTime();
  const upcomingCount = bookings.filter(
    (b) =>
      b.status === "upcoming" && new Date(b.scheduled_at).getTime() >= referenceTime,
  ).length;
  const overdueCount = bookings.filter(
    (b) =>
      b.status === "upcoming" && new Date(b.scheduled_at).getTime() < referenceTime,
  ).length;
  const completedCount = bookings.filter((b) => b.status === "completed").length;
  const noShowCount = bookings.filter((b) => b.status === "no_show").length;

  const kpis = [
    {
      id: "all" as const,
      label: "Today's Schedule",
      count: todayCount,
      icon: Calendar,
      activeColor: "border-primary/50 bg-primary/5",
      iconColor: "text-primary",
    },
    {
      id: "upcoming" as const,
      label: "Upcoming",
      count: upcomingCount,
      icon: Clock,
      activeColor: "border-blue-500/50 bg-blue-500/5",
      iconColor: "text-blue-500",
    },
    {
      id: "overdue" as const,
      label: "Overdue",
      count: overdueCount,
      icon: AlertTriangle,
      activeColor: "border-red-500/50 bg-red-500/5",
      iconColor: "text-red-500",
    },
    {
      id: "completed" as const,
      label: "Completed",
      count: completedCount,
      icon: CheckCircle2,
      activeColor: "border-emerald-500/50 bg-emerald-500/5",
      iconColor: "text-emerald-500",
    },
    {
      id: "no_show" as const,
      label: "No-show",
      count: noShowCount,
      icon: UserX,
      activeColor: "border-amber-500/50 bg-amber-500/5",
      iconColor: "text-amber-500",
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-5">
      {kpis.map((kpi) => {
        const Icon = kpi.icon;
        const isSelected = activeStatusFilter === kpi.id;

        return (
          <button
            key={kpi.id}
            type="button"
            onClick={() => onStatusFilterChange(isSelected ? "all" : kpi.id)}
            className={cn(
              "border-border bg-card hover:bg-accent/40 relative flex items-center justify-between rounded-xl border p-3 text-left transition-all",
              isSelected && kpi.activeColor,
            )}
          >
            <div className="min-w-0 flex-1">
              <span className="text-muted-foreground block truncate text-xs font-medium">
                {kpi.label}
              </span>
              <span className="text-foreground mt-0.5 block text-lg font-semibold tracking-tight">
                {kpi.count}
              </span>
            </div>
            <div
              className={cn(
                "bg-muted/80 ml-2.5 grid size-8 shrink-0 place-items-center rounded-lg",
                isSelected && "bg-background shadow-xs",
              )}
            >
              <Icon className={cn("size-4", kpi.iconColor)} />
            </div>
          </button>
        );
      })}
    </div>
  );
}
