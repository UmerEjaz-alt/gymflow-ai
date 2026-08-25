import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

/** A compact avatar container for user identity placeholders and profile images. */
export function Avatar({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "bg-muted text-muted-foreground flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-full text-xs font-semibold",
        className,
      )}
      {...props}
    />
  );
}
