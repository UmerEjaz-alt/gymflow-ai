"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { appNavigation } from "@/lib/navigation";
import { cn } from "@/lib/utils";

type AppSidebarProps = {
  collapsed: boolean;
  mobileOpen: boolean;
  onNavigate: () => void;
};

/** Reusable primary navigation rail with App Router-aware active links. */
export function AppSidebar({ collapsed, mobileOpen, onNavigate }: AppSidebarProps) {
  const pathname = usePathname();

  return (
    <aside
      aria-label="Primary navigation"
      className={cn(
        "border-border bg-card fixed inset-y-0 left-0 z-40 flex w-72 flex-col border-r px-3 py-4 transition-[transform,width] duration-200 lg:static lg:translate-x-0",
        collapsed ? "lg:w-20" : "lg:w-72",
        mobileOpen ? "translate-x-0 shadow-xl" : "-translate-x-full",
      )}
    >
      <div className="mb-8 flex h-9 items-center gap-3 px-2">
        <div className="bg-primary text-primary-foreground grid size-8 place-items-center rounded-lg text-sm font-bold">
          G
        </div>
        <span className={cn("font-semibold tracking-tight", collapsed && "lg:hidden")}>
          GymFlow AI
        </span>
      </div>

      <nav className="flex flex-1 flex-col gap-1">
        {appNavigation.map(({ href, icon: Icon, label }) => {
          const isActive = pathname === href;

          return (
            <Link
              aria-current={isActive ? "page" : undefined}
              className={cn(
                "text-muted-foreground hover:bg-accent hover:text-accent-foreground flex h-10 items-center gap-3 rounded-md px-3 text-sm font-medium transition-colors",
                isActive && "bg-accent text-accent-foreground",
                collapsed && "lg:justify-center lg:px-0",
              )}
              href={href}
              key={href}
              onClick={onNavigate}
              title={collapsed ? label : undefined}
            >
              <Icon aria-hidden className="size-4 shrink-0" />
              <span className={cn(collapsed && "lg:hidden")}>{label}</span>
            </Link>
          );
        })}
      </nav>

      <p className={cn("text-muted-foreground px-3 text-xs", collapsed && "lg:hidden")}>
        Gym operations, simplified.
      </p>
    </aside>
  );
}
