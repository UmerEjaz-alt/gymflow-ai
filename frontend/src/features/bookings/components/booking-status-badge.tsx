import { AlertCircle, CheckCircle2, Clock, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { BookingStatus, BookingType } from "@/types/booking";
import { BOOKING_STATUS_LABELS, BOOKING_TYPE_LABELS } from "@/types/booking";

type StatusBadgeProps = {
  status: BookingStatus;
  className?: string;
};

export function BookingStatusBadge({ status, className }: StatusBadgeProps) {
  switch (status) {
    case "upcoming":
      return (
        <span
          className={cn(
            "inline-flex items-center gap-1 rounded-full border border-blue-500/20 bg-blue-500/10 px-2.5 py-0.5 text-xs font-medium text-blue-700 dark:text-blue-400",
            className,
          )}
        >
          <Clock className="size-3 shrink-0" />
          {BOOKING_STATUS_LABELS.upcoming}
        </span>
      );
    case "completed":
      return (
        <span
          className={cn(
            "inline-flex items-center gap-1 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-0.5 text-xs font-medium text-emerald-700 dark:text-emerald-400",
            className,
          )}
        >
          <CheckCircle2 className="size-3 shrink-0" />
          {BOOKING_STATUS_LABELS.completed}
        </span>
      );
    case "cancelled":
      return (
        <span
          className={cn(
            "inline-flex items-center gap-1 rounded-full border border-zinc-500/20 bg-zinc-500/10 px-2.5 py-0.5 text-xs font-medium text-zinc-600 dark:text-zinc-400",
            className,
          )}
        >
          <XCircle className="size-3 shrink-0" />
          {BOOKING_STATUS_LABELS.cancelled}
        </span>
      );
    case "no_show":
      return (
        <span
          className={cn(
            "inline-flex items-center gap-1 rounded-full border border-amber-500/20 bg-amber-500/10 px-2.5 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-400",
            className,
          )}
        >
          <AlertCircle className="size-3 shrink-0" />
          {BOOKING_STATUS_LABELS.no_show}
        </span>
      );
  }
}

type TypeBadgeProps = {
  type: BookingType;
  trainerName?: string | null;
  className?: string;
};

export function BookingTypeBadge({ type, trainerName, className }: TypeBadgeProps) {
  const label = BOOKING_TYPE_LABELS[type] || type;
  const isPt = type === "pt_session" || type === "pt_consultation";

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium",
        isPt
          ? "border border-purple-500/20 bg-purple-500/10 text-purple-700 dark:text-purple-300"
          : type === "trial_session"
            ? "border border-cyan-500/20 bg-cyan-500/10 text-cyan-700 dark:text-cyan-300"
            : "bg-muted text-foreground/80 border-border border",
        className,
      )}
    >
      <span>{label}</span>
      {trainerName ? (
        <>
          <span className="opacity-40">·</span>
          <span className="font-semibold">{trainerName}</span>
        </>
      ) : null}
    </span>
  );
}
