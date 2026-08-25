import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

/** A shared shadcn/ui-compatible text input primitive. */
export function Input({ className, type, ...props }: ComponentProps<"input">) {
  return (
    <input
      className={cn(
        "border-input bg-background placeholder:text-muted-foreground focus-visible:ring-ring flex h-9 w-full rounded-md border px-3 py-1 text-sm shadow-xs transition-colors outline-none focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      type={type}
      {...props}
    />
  );
}
