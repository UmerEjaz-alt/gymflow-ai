import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

/** A shared shadcn/ui-compatible native select primitive. */
export function Select({ className, ...props }: ComponentProps<"select">) {
  return (
    <select
      className={cn(
        "border-input bg-background text-foreground focus-visible:ring-ring flex h-[var(--app-control-size,2.25rem)] w-full rounded-md border px-[var(--app-input-padding-x,0.75rem)] py-1 text-sm shadow-xs transition-colors outline-none focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}
