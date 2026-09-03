import { CalendarDays, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type BookingsHeaderProps = {
  branchName: string;
  viewMode: "today" | "week";
  onViewModeChange: (view: "today" | "week") => void;
  onOpenNewBooking: () => void;
};

export function BookingsHeader({
  branchName,
  viewMode,
  onViewModeChange,
  onOpenNewBooking,
}: BookingsHeaderProps) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-3">
        <div className="bg-primary/10 text-primary grid size-9 place-items-center rounded-lg">
          <CalendarDays className="size-4.5" />
        </div>
        <div>
          <h1 className="text-foreground text-xl font-semibold tracking-tight">
            Bookings
          </h1>
          <p className="text-muted-foreground text-xs sm:text-sm">
            Manage visits, trials and training appointments at {branchName}.
          </p>
        </div>
      </div>

      <div className="flex items-center gap-2.5 self-start sm:self-auto">
        {/* Segmented View Switcher */}
        <div className="bg-muted inline-flex items-center rounded-lg p-0.5 text-xs font-medium">
          <button
            type="button"
            onClick={() => onViewModeChange("today")}
            className={cn(
              "cursor-pointer rounded-md px-3 py-1.5 transition-colors",
              viewMode === "today"
                ? "bg-card text-foreground font-semibold shadow-xs"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            Today
          </button>
          <button
            type="button"
            onClick={() => onViewModeChange("week")}
            className={cn(
              "cursor-pointer rounded-md px-3 py-1.5 transition-colors",
              viewMode === "week"
                ? "bg-card text-foreground font-semibold shadow-xs"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            Week
          </button>
        </div>

        {/* New Booking CTA */}
        <Button
          onClick={onOpenNewBooking}
          className="h-8.5 cursor-pointer gap-1.5 px-3 text-xs shadow-xs"
        >
          <Plus className="size-3.5" />
          <span>New booking</span>
        </Button>
      </div>
    </div>
  );
}
