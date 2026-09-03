import { cn } from "@/lib/utils";

type BadgeVariant = "success" | "muted" | "default";

type BadgeProps = {
  children: React.ReactNode;
  variant?: BadgeVariant;
  className?: string;
};

const variantClasses: Record<BadgeVariant, string> = {
  success: "bg-green-500/10 text-green-700 dark:text-green-400",
  muted: "bg-muted text-muted-foreground",
  default: "bg-primary/10 text-primary",
};

/** Small status badge for labelling states like active/inactive. */
export function Badge({ children, variant = "default", className }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium",
        variantClasses[variant],
        className,
      )}
    >
      {children}
    </span>
  );
}
