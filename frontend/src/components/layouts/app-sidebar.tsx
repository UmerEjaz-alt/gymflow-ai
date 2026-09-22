"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { appNavigation } from "@/lib/navigation";
import { cn } from "@/lib/utils";

type AppSidebarProps = {
  collapsed: boolean;
  gymLogoUrl?: string | null;
  gymName?: string | null;
  mobileOpen: boolean;
  onNavigate: () => void;
};

/** Reusable primary navigation rail with App Router-aware active links. */
export function AppSidebar({
  collapsed,
  gymLogoUrl,
  gymName,
  mobileOpen,
  onNavigate,
}: AppSidebarProps) {
  const pathname = usePathname();

  return (
    <aside
      aria-label="Primary navigation"
      className={cn(
        "border-border bg-card fixed inset-y-0 left-0 z-40 flex w-60 flex-col border-r px-2.5 py-3 transition-[transform,width] duration-200 xl:static xl:translate-x-0",
        collapsed ? "xl:w-16" : "xl:w-60",
        mobileOpen ? "translate-x-0 shadow-xl" : "-translate-x-full",
      )}
    >
      <div className="mb-6 flex h-9 items-center gap-3 px-2">
        <div className="bg-primary text-primary-foreground relative grid size-8 shrink-0 place-items-center overflow-hidden rounded-lg text-sm font-bold">
          G
          {gymLogoUrl ? (
            <span
              aria-hidden
              className="absolute inset-0 bg-cover bg-center"
              style={{ backgroundImage: `url("${gymLogoUrl}")` }}
            />
          ) : null}
        </div>
        <span className={cn("font-semibold tracking-tight", collapsed && "xl:hidden")}>
          {gymName ?? "Kroway"}
        </span>
      </div>

      <nav className="flex flex-1 flex-col gap-1">
        {appNavigation.map(({ href, icon: Icon, label }) => {
          const isActive = pathname === href;

          return (
            <Link
              aria-current={isActive ? "page" : undefined}
              className={cn(
                "text-muted-foreground hover:bg-accent hover:text-accent-foreground flex h-9 items-center gap-3 rounded-md px-3 text-[13px] font-medium transition-colors",
                isActive && "bg-accent text-accent-foreground",
                collapsed && "xl:justify-center xl:px-0",
              )}
              href={href}
              key={href}
              onClick={onNavigate}
              title={collapsed ? label : undefined}
            >
              <Icon aria-hidden className="size-4 shrink-0" />
              <span className={cn(collapsed && "xl:hidden")}>{label}</span>
            </Link>
          );
        })}
      </nav>

      <p className={cn("text-muted-foreground px-3 text-xs", collapsed && "xl:hidden")}>
        Gym operations, simplified.
      </p>
    </aside>
  );
}
